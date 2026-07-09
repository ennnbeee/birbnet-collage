package main

import (
	"crypto/subtle"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"gopkg.in/yaml.v3"
)

type Config struct {
	BirdnetGoURL string `yaml:"birdnet_go_url"`
	StaticDir    string `yaml:"static_dir"`
	Auth         struct {
		Password  string `yaml:"password"`
		JWTSecret string `yaml:"jwt_secret"`
		JWTDebug  bool   `yaml:"jwt_debug"`
	} `yaml:"auth"`
	Server struct {
		SocketPath string `yaml:"socket_path"`
		TCPAddr    string `yaml:"tcp_addr"`
	} `yaml:"server"`
}

var (
	jwtSecret    []byte
	authPassword string
	jwtDebug     bool
)

func loadConfig(configPath string) (*Config, error) {
	// Set defaults
	cfg := &Config{
		BirdnetGoURL: "http://localhost:8080",
		StaticDir:    ".",
	}
	cfg.Server.SocketPath = "/tmp/birdnet-collage.sock"

	// Try to read config file
	data, err := os.ReadFile(configPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("error reading config file: %w", err)
		}
		log.Printf("Config file %s not found, using defaults and environment variables", configPath)
	} else {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("error parsing config file: %w", err)
		}
		log.Printf("Loaded configuration from %s", configPath)
	}

	// Environment variables override config file
	if v := os.Getenv("BIRDNET_GO_URL"); v != "" {
		cfg.BirdnetGoURL = v
	}
	if v := os.Getenv("STATIC_DIR"); v != "" {
		cfg.StaticDir = v
	}
	if v := os.Getenv("BASIC_AUTH_PASS"); v != "" {
		cfg.Auth.Password = v
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		cfg.Auth.JWTSecret = v
	}
	if v := os.Getenv("JWT_DEBUG"); v == "true" {
		cfg.Auth.JWTDebug = true
	}
	if v := os.Getenv("SOCKET_PATH"); v != "" {
		cfg.Server.SocketPath = v
	}
	if v := os.Getenv("LISTEN_TCP"); v != "" {
		cfg.Server.TCPAddr = v
	}

	// Normalize TCP address: if it's just a port number, prepend ":"
	if cfg.Server.TCPAddr != "" && !strings.Contains(cfg.Server.TCPAddr, ":") {
		cfg.Server.TCPAddr = ":" + cfg.Server.TCPAddr
	}

	return cfg, nil
}

func main() {
	configPath := flag.String("config", "config.yaml", "Path to configuration file")
	flag.Parse()

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Set up authentication
	authPassword = cfg.Auth.Password
	jwtDebug = cfg.Auth.JWTDebug
	secret := cfg.Auth.JWTSecret
	if secret == "" {
		secret = authPassword + "-jwt-secret"
	}
	jwtSecret = []byte(secret)

	absDir, err := filepath.Abs(cfg.StaticDir)
	if err != nil {
		log.Fatalf("Invalid static directory %q: %v", cfg.StaticDir, err)
	}

	target, err := url.Parse(cfg.BirdnetGoURL)
	if err != nil {
		log.Fatalf("Invalid BirdNET-Go URL %q: %v", cfg.BirdnetGoURL, err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	orig := proxy.Director
	proxy.Director = func(req *http.Request) {
		orig(req)
		req.Host = target.Host
	}

	mux := http.NewServeMux()

	// Login endpoint — no JWT required
	mux.HandleFunc("/api/login", func(w http.ResponseWriter, r *http.Request) {
		if authPassword == "" {
			http.Error(w, "auth not configured", http.StatusForbidden)
			return
		}
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if subtle.ConstantTimeCompare([]byte(body.Password), []byte(authPassword)) != 1 {
			if jwtDebug {
				log.Printf("[jwt] login REJECT: wrong password")
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if jwtDebug {
			log.Printf("[jwt] login ACCEPT")
		}
		now := time.Now()
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"sub": "user",
			"iat": now.Unix(),
			"exp": now.Add(7 * 24 * time.Hour).Unix(),
		})
		tokenStr, err := token.SignedString(jwtSecret)
		if err != nil {
			log.Printf("JWT signing error: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": tokenStr})
	})

	// API proxy — protected by JWT
	apiHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	})
	mux.Handle("/api/", jwtMiddleware(apiHandler))

	// Static files — no auth (frontend handles the locked UI)
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, filepath.Join(absDir, "index.html"))
			return
		}
		clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
		if strings.HasPrefix(clean, "..") {
			http.NotFound(w, r)
			return
		}
		p := filepath.Join(absDir, clean)
		if fi, err := os.Stat(p); err != nil || fi.IsDir() {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, p)
	}))

	var handler http.Handler = mux
	if authPassword != "" {
		log.Printf("JWT auth enabled")
	}

	// Ensure at least one listener is configured
	if cfg.Server.SocketPath == "" && cfg.Server.TCPAddr == "" {
		log.Fatalf("At least one listener must be configured (socket_path or tcp_addr)")
	}

	log.Printf("Serving static files from %s", absDir)
	log.Printf("Proxying /api/* to %s", cfg.BirdnetGoURL)

	// Unix socket listener (optional)
	if cfg.Server.SocketPath != "" {
		if err := os.Remove(cfg.Server.SocketPath); err != nil && !os.IsNotExist(err) {
			log.Printf("Warning: could not remove old socket %s: %v", cfg.Server.SocketPath, err)
		}
		socketDir := filepath.Dir(cfg.Server.SocketPath)
		if err := os.MkdirAll(socketDir, 0755); err != nil {
			log.Fatalf("Failed to create socket directory %s: %v", socketDir, err)
		}

		udsListener, err := net.Listen("unix", cfg.Server.SocketPath)
		if err != nil {
			log.Fatalf("Failed to listen on Unix socket %s: %v", cfg.Server.SocketPath, err)
		}
		if err := os.Chmod(cfg.Server.SocketPath, 0666); err != nil {
			log.Fatalf("Failed to chmod socket %s: %v", cfg.Server.SocketPath, err)
		}

		log.Printf("Listening on Unix socket: %s", cfg.Server.SocketPath)
		go func() {
			if err := http.Serve(udsListener, handler); err != nil {
				log.Fatalf("UDS server error: %v", err)
			}
		}()
	}

	// TCP listener (optional)
	if cfg.Server.TCPAddr != "" {
		tcpListener, err := net.Listen("tcp", cfg.Server.TCPAddr)
		if err != nil {
			log.Fatalf("Failed to listen on TCP %s: %v", cfg.Server.TCPAddr, err)
		}
		log.Printf("Listening on TCP: %s", cfg.Server.TCPAddr)
		go func() {
			if err := http.Serve(tcpListener, handler); err != nil {
				log.Fatalf("TCP server error: %v", err)
			}
		}()
	}

	select {}
}

func jwtMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authPassword == "" {
			next.ServeHTTP(w, r)
			return
		}
		tokenStr := ""
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			tokenStr = strings.TrimPrefix(auth, "Bearer ")
		} else {
			tokenStr = r.URL.Query().Get("token")
		}
		if jwtDebug {
			log.Printf("[jwt] %s %s: auth_header=%v token_query=%v token_len=%d",
				r.Method, r.URL.String(),
				strings.HasPrefix(auth, "Bearer "),
				r.URL.Query().Get("token") != "",
				len(tokenStr))
		}
		if tokenStr == "" {
			if jwtDebug {
				log.Printf("[jwt] REJECT: no token found")
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return jwtSecret, nil
		})
		if err != nil || !token.Valid {
			if jwtDebug {
				log.Printf("[jwt] REJECT: parse err=%v", err)
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if jwtDebug {
			log.Printf("[jwt] ACCEPT")
		}
		next.ServeHTTP(w, r)
	})
}
