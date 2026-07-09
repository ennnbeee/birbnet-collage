# Kachō-e Collage Standalone

Extracted from the [AvianVisitors](https://github.com/Twarner491/AvianVisitors) project.

## Deployment

### Build the Go proxy server

```sh
cd server
go build -o ../birbnet-collage-server .
```

### 2. Configure

Copy and edit the config file:

```sh
cp config.yaml.example config.yaml
```

Edit `config.yaml`:

```yaml
birdnet_go_url: "http://localhost:8080"  # Your BirdNET-Go backend
server:
  tcp_addr: "8081"  # Port to hose the BirdNet-Go collage on
auth:
  password: ""  # Optional authentication
```

### Run

Using config file:

```sh
./run-server.sh
# or directly:
./birbnet-collage-server -config config.yaml
```

### Production Deployment

See [CONFIGURATION.md](CONFIGURATION.md) for systemd service, macOS launchd, and other deployment options.

## Assets

The kachō-e illustrations are from the AvianVisitors project.
450+ bundled bird PNGs are in `assets/illustrations/` with 158 photo cutouts in `assets/cutouts/`.
Alpha masks (`masks.json`) and dimension data (`dims.json`) are loaded separately by the frontend.

## Image Generation Scripts

The `scripts/` directory contains tools for generating bird illustrations using Google Gemini:

### Setup

Install Python dependencies in a virtual environment:

```sh
# Create virtual environment (if not already created)
python3 -m venv .venv

# Activate it (or use .venv/bin/python directly)
source .venv/bin/activate  # macOS/Linux
# or: .venv/Scripts/activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

**Note:** Always use `.venv/bin/python` instead of `python3` to run the scripts, or activate the virtual environment first.

**Shortcut:** Use `./scripts/python` as a wrapper:

```sh
# Instead of: .venv/bin/python scripts/fetch_labels.py
# Use: ./scripts/python scripts/fetch_labels.py
```

### API Keys

Scripts can read API keys from three sources (in priority order):

1. Command-line arguments (`--gemini-key`, `--ebird-key`)
2. Environment variables (`GEMINI_API_KEY`, `EBIRD_API_KEY`)
3. `config.yaml` file (add to the `api_keys` section)

Example config.yaml:

```yaml
api_keys:
  gemini_api_key: "your-key-here"
  ebird_api_key: "your-key-here"
```

### Get Species Labels

Before generating images, you need a species list. Get it from your BirdNET-Go instance:

Option 1: Fetch detected species via API (quickest)

```sh
# Automatically uses birdnet_go_url from config.yaml
.venv/bin/python scripts/a_fetch_labels.py

# Or specify URL directly
.venv/bin/python scripts/a_fetch_labels.py --url http://birbpi:8080
```

This creates `scripts/labels.txt` with **only species your BirdNET-Go has detected**.

Option 2: Download full model labels (all species)

For all 6,000+ species BirdNET supports worldwide:

```sh
curl -o scripts/labels.txt https://raw.githubusercontent.com/tphakala/birdnet-go/main/labels/labels_en.txt
```

Then filter by region using `--ebird-region` when generating images (see below).

Option 3: Download from GitHub

BirdNET-Go includes label files in its repository:

```sh
curl -o scripts/labels.txt https://raw.githubusercontent.com/tphakala/birdnet-go/main/labels/labels_en.txt
```

### Generate Illustrations

See `scripts/b_generate_images.py --help` for full options. The script will automatically use API keys from `config.yaml` if present:

```sh
# Generate all species from BirdNET-Pi labels
.venv/bin/python scripts/b_generate_images.py --labels ~/BirdNET-Pi/model/labels.txt

# Generate with eBird region filter
.venv/bin/python scripts/b_generate_images.py --labels scripts/labels.txt --ebird-region GB

# Re-render a single species
.venv/bin/python scripts/b_generate_images.py --species "Calypte anna|Anna's Hummingbird" --force
```

### Generate Cutouts

```sh
.venv/bin/python scripts/c_generate_cutout.py
```

### Generate Masks and Dims

```sh
.venv/bin/python scripts/d_generate_masks_dims.py
```

## Credits

- **AvianVisitors**: [Twarner491/AvianVisitors](https://github.com/Twarner491/AvianVisitors)
- **AvianVisitors_standalone**:[PhracturedBlue/AvianVisitors_standalone](https://github.com/PhracturedBlue/AvianVisitors_standalone)
- **BirdNET-Go**: [tphakala/birdnet-go](https://github.com/tphakala/birdnet-go)
- **BirdNET**: [Cornell Lab of Ornithology](https://birdnet.cornell.edu/)
