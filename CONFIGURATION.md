# BirdNET Collage Server - Improved Configuration

The server now supports configuration via a YAML file with environment variable overrides.

## Quick Start

1. **Copy the example config:**

   ```bash
   cp config.yaml.example config.yaml
   ```

2. **Edit config.yaml with your settings:**

   ```yaml
   birdnet_go_url: "http://birbpi:8080"
   server:
     tcp_addr: "8081"
   ```

3. **Run the server:**

   ```bash
   ./run-server.sh
   ```

## Configuration Options

The server reads configuration from `config.yaml` (default) or a file specified with `-config`:

```bash
./birbnet-collage-server -config /path/to/config.yaml
```

### Configuration File (config.yaml)

```yaml
# BirdNET-Go backend URL
birdnet_go_url: "http://localhost:8080"

# Directory containing static files
static_dir: "."

# Authentication settings
auth:
  password: ""          # Admin password (empty = no auth)
  jwt_secret: ""        # JWT secret (auto-generated if empty)
  jwt_debug: false      # Enable JWT debug logging

# Server listening options (at least one required)
server:
  socket_path: "/tmp/birdnet-collage.sock"  # Unix socket (empty = disabled)
  tcp_addr: ""          # TCP address (e.g., "8081" or "localhost:8081", empty = disabled)
```

### Listener Configuration

The server supports both Unix socket and TCP listeners. **At least one must be configured.**

**TCP-only (simple, direct access):**

```yaml
server:
  socket_path: ""      # Disabled
  tcp_addr: "8081"     # Listen on port 8081
```
Access at: `http://your-server:8081`

**Socket-only (for reverse proxy/tunnel):**

```yaml
server:
  socket_path: "/tmp/birdnet-collage.sock"
  tcp_addr: ""         # Disabled
```
Use with nginx, Caddy, or Cloudflare Tunnel.

**Both (flexibility):**

```yaml
server:
  socket_path: "/tmp/birdnet-collage.sock"
  tcp_addr: "8081"     # Debug access
```

Production traffic via socket, debug via TCP.

### Environment Variables

Environment variables override config file settings:

- `BIRDNET_GO_URL` - BirdNET-Go backend URL
- `STATIC_DIR` - Static files directory
- `BASIC_AUTH_PASS` - Authentication password
- `JWT_SECRET` - JWT signing secret
- `JWT_DEBUG` - Set to "true" to enable JWT debug logging
- `SOCKET_PATH` - Unix socket path
- `LISTEN_TCP` - TCP listening address

Example:

```bash
BIRDNET_GO_URL=http://birbpi:8080 LISTEN_TCP=:8081 ./birbnet-collage-server
```

## Deployment Options

### Option 1: Simple Script (Current)

Use the provided startup script:

```bash
./run-server.sh
```

### Option 2: systemd Service (Recommended for Linux)

1. **First, determine your setup:**
   - Find your username: `whoami`
   - Find your install path: `pwd` (while in the repo directory)
   - Common setups:
     - Raspberry Pi OS: user=`pi`, path=`/home/pi/birdnet-collage`
     - DietPi: user=`dietpi`, path=`/home/dietpi/birdnet-collage`
     - Custom: user=`yourname`, path=`/path/to/your/clone`

2. **Edit the service file** (`birdnet-collage.service`) to match your system:

   ```ini
   User=dietpi  # Change to your username (pi, dietpi, etc.)
   WorkingDirectory=/home/dietpi/birbnet-collage  # Change to your clone path
   ExecStart=/home/dietpi/birdnet-collage/birbnet-collage-server -config /home/dietpi/birdnet-collage/config.yaml
   ```

3. **Install and enable the service:**

   ```bash
   sudo cp birbnet-collage.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable birbnet-collage
   sudo systemctl start birbnet-collage
   ```

4. **Check status:**

   ```bash
   sudo systemctl status birbnet-collage
   sudo journalctl -u birbnet-collage -f  # Follow logs in real-time
   ```

5. **Service management commands:**

   ```bash
   sudo systemctl stop birbnet-collage     # Stop the service
   sudo systemctl restart birbnet-collage  # Restart the service
   sudo systemctl disable birbnet-collage  # Disable auto-start
   ```
