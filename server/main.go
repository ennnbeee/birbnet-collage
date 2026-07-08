package main

import (
	"crypto/subtle"
	"encoding/json"
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
)

var (
	jwtSecret    []byte
	authPassword string
	jwtDebug     bool
)

func main() {
	socketPath := getEnv("SOCKET_PATH", "/tmp/birdnet-collage.sock")
	backendURL := getEnv("BIRDNET_GO_URL", "http://localhost:8080")
	staticDir := getEnv("STATIC_DIR", ".")
	authPassword = getEnv("BASIC_AUTH_PASS", "")
	jwtDebug = getEnv("JWT_DEBUG", "") == "true"
	secret := getEnv("JWT_SECRET", "")

	if secret == "" {
		secret = authPassword + "-jwt-secret"
	}
	jwtSecret = []byte(secret)

	absDir, err := filepath.Abs(staticDir)
	if err != nil {
		log.Fatalf("Invalid STATIC_DIR %q: %v", staticDir, err)
	}

	target, err := url.Parse(backendURL)
	if err != nil {
		log.Fatalf("Invalid BIRDNET_GO_URL %q: %v", backendURL, err)
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
			if jwtDebug { log.Printf("[jwt] login REJECT: wrong password") }
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if jwtDebug { log.Printf("[jwt] login ACCEPT") }
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

	if err := os.Remove(socketPath); err != nil && !os.IsNotExist(err) {
		log.Printf("Warning: could not remove old socket %s: %v", socketPath, err)
	}
	socketDir := filepath.Dir(socketPath)
	if err := os.MkdirAll(socketDir, 0755); err != nil {
		log.Fatalf("Failed to create socket directory %s: %v", socketDir, err)
	}

	udsListener, err := net.Listen("unix", socketPath)
	if err != nil {
		log.Fatalf("Failed to listen on Unix socket %s: %v", socketPath, err)
	}
	if err := os.Chmod(socketPath, 0666); err != nil {
		log.Fatalf("Failed to chmod socket %s: %v", socketPath, err)
	}

	log.Printf("Serving static files from %s", absDir)
	log.Printf("Proxying /api/* to %s", backendURL)
	log.Printf("Listening on Unix socket: %s", socketPath)

	go func() {
		if err := http.Serve(udsListener, handler); err != nil {
			log.Fatalf("UDS server error: %v", err)
		}
	}()

	if tcpAddr := os.Getenv("LISTEN_TCP"); tcpAddr != "" {
		tcpListener, err := net.Listen("tcp", tcpAddr)
		if err != nil {
			log.Fatalf("Failed to listen on TCP %s: %v", tcpAddr, err)
		}
		log.Printf("Debug TCP listener on %s", tcpAddr)
		go func() {
			if err := http.Serve(tcpListener, handler); err != nil {
				log.Fatalf("TCP server error: %v", err)
			}
		}()
	}

	select {}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
			if jwtDebug { log.Printf("[jwt] REJECT: no token found") }
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
			if jwtDebug { log.Printf("[jwt] REJECT: parse err=%v", err) }
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if jwtDebug { log.Printf("[jwt] ACCEPT") }
		next.ServeHTTP(w, r)
	})
}
