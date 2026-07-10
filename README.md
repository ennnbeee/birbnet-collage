# Kachō-e Collage Standalone

Extracted from the [AvianVisitors](https://github.com/Twarner491/AvianVisitors) project and [/AvianVisitors_standalone](https://github.com/PhracturedBlue/AvianVisitors_standalone)

## Deployment

On the Raspberry Pi you'll need to install `git` and `golang`.

### Clone the repo

You can then clone the repo to a suitable location, `home` is good enough.

```sh
git clone https://github.com/ennnbeee/birbnet-collage.git
```

### Build the Go proxy server

Traverse to the cloned repo server folder and build the server.

```sh
cd birbnet-collage/server
go build -o ../birbnet-collage-server .
```

### 2. Configure

From within the root of the repo copy and edit the config file.

```sh
cd ..
cp config.yaml.example config.yaml
```

Edit `config.yaml` file with the required details

```yaml
birdnet_go_url: "http://localhost:8080"  # Your BirdNET-Go backend
server:
  tcp_addr: "8081"  # Port to hose the BirdNet-Go collage on
auth:
  password: ""  # Optional authentication
```

### Test Run

Using config file:

```sh
./run-server.sh
# or directly:
./birbnet-collage-server -config config.yaml
```

### Production Deployment

See [CONFIGURATION.md](CONFIGURATION.md) for systemd service and other deployment options.

## Assets

The kachō-e illustrations are from the AvianVisitors project.
450+ bundled bird PNGs are in `assets/illustrations/` with 158 photo cutouts in `assets/cutouts/`.
Alpha masks (`masks.json`) and dimension data (`dims.json`) are loaded separately by the frontend.

## Image Generation Scripts

The `scripts/` directory contains tools for generating bird illustrations using Google Gemini.

Check the [README.md](scripts/README.md) for more information.

## Credits

- **AvianVisitors**: [Twarner491/AvianVisitors](https://github.com/Twarner491/AvianVisitors)
- **AvianVisitors_standalone**:[PhracturedBlue/AvianVisitors_standalone](https://github.com/PhracturedBlue/AvianVisitors_standalone)
- **BirdNET-Go**: [tphakala/birdnet-go](https://github.com/tphakala/birdnet-go)
- **BirdNET**: [Cornell Lab of Ornithology](https://birdnet.cornell.edu/)
