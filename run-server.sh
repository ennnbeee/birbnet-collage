#!/bin/bash
# Simple startup script for birbnet-collage-server

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if config file exists
if [ ! -f "config.yaml" ]; then
    echo "Warning: config.yaml not found, using defaults"
    echo "Copy config.yaml.example to config.yaml and customize it"
fi

# Run the server
exec ./birbnet-collage-server "$@"
