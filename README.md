# Kachō-e Collage Standalone

A standalone bird-collage visualization for [BirdNET-Go](https://github.com/tphakala/birdnet-go).  
Extracted from the [AvianVisitors](https://github.com/Twarner491/AvianVisitors) project.

## Deployment

### 1. Build the Go proxy server

```sh
cd server
go build -o ../birdnet-collage-server .
```

### 2. Configure

Edit `config.js`:

```js
var BIRDNET_GO_URL = '';   // leave empty — the server proxies /api/*
var AUTH_SECRET = 'hunter2';  // must match SECRET on the server
```

### 3. Run

```sh
# Unix domain socket (for Cloudflare Tunnel etc.):
SECRET=hunter2 BIRDNET_GO_URL=http://localhost:8080 ./birdnet-collage-server

# Also expose TCP for local testing:
SECRET=hunter2 BIRDNET_GO_URL=http://localhost:8080 LISTEN_TCP=:8080 ./birdnet-collage-server
```

| Env var | Default | Purpose |
|---|---|---|
| `SOCKET_PATH` | `/tmp/birdnet-collage.sock` | Unix socket path |
| `BIRDNET_GO_URL` | `http://localhost:8080` | Backend BirdNET-Go base URL |
| `SECRET` | *(empty = no auth)* | Shared secret for API access |
| `STATIC_DIR` | `.` | Frontend static files directory |
| `LISTEN_TCP` | *(empty = off)* | Optional TCP `host:port` for testing |

### 4. Cloudflare Tunnel

```yaml
# config.yml
tunnel: your-tunnel
ingress:
  - hostname: birds.example.com
    service: unix:///tmp/birdnet-collage.sock
  - service: http_status:404
```

## Auth

When `SECRET` is set on the server, every `/api/*` request must carry the secret:

- **From JS (fetch)**: `X-Secret` header (added automatically by `config.js`)
- **From `<audio>` elements**: `?secret=...` query param (added automatically)
- **Direct curl**: `curl -H 'X-Secret: hunter2' ...`

Static files (HTML, CSS, JS, images) are served without auth — the secret only gates the BirdNET-Go API.

## Without the Go server (static only)

For local development without auth, you can use any HTTP server:

```sh
python3 -m http.server 8000
```

And point `config.js` directly at BirdNET-Go (may need CORS setup — see below).

## BirdNET-Go CORS

If connecting directly (no Go proxy), enable CORS in BirdNET-Go's `config.yaml`:

```yaml
webserver:
  cors:
    allowed_origins:
      - "http://localhost:8000"
```

## Assets

The kachō-e illustrations are from the AvianVisitors project.  
450+ bundled bird PNGs are in `assets/illustrations/` with 158 photo cutouts in `assets/cutouts/`.  
Alpha masks (`masks.json`) and dimension data (`dims.json`) are loaded separately by the frontend.

## Credits

- **AvianVisitors**: [Twarner491/AvianVisitors](https://github.com/Twarner491/AvianVisitors)
- **BirdNET-Go**: [tphakala/birdnet-go](https://github.com/tphakala/birdnet-go)
- **BirdNET**: [Cornell Lab of Ornithology](https://birdnet.cornell.edu/)
