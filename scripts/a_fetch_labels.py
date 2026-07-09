#!/usr/bin/env python3
"""Fetch species labels from BirdNET-Go API and save as labels.txt."""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None


def load_config(config_path: Path) -> str:
    """Load BirdNET-Go URL from config.yaml."""
    if not config_path.exists() or not yaml:
        return "http://localhost:8080"
    try:
        data = yaml.safe_load(config_path.read_text())
        return data.get("birdnet_go_url", "http://localhost:8080")
    except Exception:
        return "http://localhost:8080"


def fetch_species(base_url: str) -> list[tuple[str, str]]:
    """Fetch species list from BirdNET-Go /api/v2/analytics/species/summary endpoint.
    Returns list of (scientific_name, common_name) tuples.
    """
    url = f"{base_url.rstrip('/')}/api/v2/analytics/species/summary"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"Error fetching from {url}: {e}", file=sys.stderr)
        print("Note: Make sure BirdNET-Go is running and accessible", file=sys.stderr)
        sys.exit(1)
    
    # BirdNET-Go species summary returns an array of species with detections
    # Format: [{scientificName: "...", commonName: "...", count: N}, ...]
    species = []
    for item in data:
        if isinstance(item, dict):
            sci = item.get("scientificName") or item.get("scientific_name") or item.get("sciName")
            com = item.get("commonName") or item.get("common_name") or item.get("comName")
            if sci and com:
                species.append((sci, com))
    
    if not species:
        # Fallback: try legacy format
        print("Warning: No species found in summary, trying alternative parsing...", file=sys.stderr)
        for item in data:
            if isinstance(item, str) and "|" in item:
                parts = item.split("|", 1)
                if len(parts) == 2:
                    species.append((parts[0].strip(), parts[1].strip()))
    
    return species


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", help="BirdNET-Go base URL (or from config.yaml)")
    ap.add_argument("--config", type=Path, 
                    default=Path(__file__).resolve().parents[1] / "config.yaml",
                    help="Path to config.yaml (default: ../config.yaml)")
    ap.add_argument("--output", type=Path,
                    default=Path(__file__).resolve().parent / "labels.txt",
                    help="Output file (default: scripts/labels.txt)")
    args = ap.parse_args()
    
    base_url = args.url or load_config(args.config)
    print(f"Fetching species from {base_url}/api/species...")
    
    species = fetch_species(base_url)
    if not species:
        print("Error: No species found in API response", file=sys.stderr)
        return 1
    
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w") as f:
        for sci, com in species:
            f.write(f"{sci}|{com}\n")
    
    print(f"✓ Wrote {len(species)} species to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
