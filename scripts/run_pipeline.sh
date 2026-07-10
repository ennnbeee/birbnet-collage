#!/usr/bin/env bash
# AvianVisitors illustration pipeline runner
# Runs scripts a through d in sequence, stopping on any failure

set -e  # Exit immediately if any command fails

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "AvianVisitors Illustration Pipeline"
echo "=========================================="
echo ""

echo "[1/4] Running a_fetch_labels.py..."
python3 a_fetch_labels.py "$@"
echo "✓ Labels fetched successfully"
echo ""

echo "[2/4] Running b_generate_images.py..."
python3 b_generate_images.py --labels scripts/labels.txt --ebird-region GB "$@"
echo "✓ Images generated successfully"
echo ""

echo "[3/4] Running c_generate_cutout.py..."
python3 c_generate_cutout.py "$@"
echo "✓ Cutouts created successfully"
echo ""

echo "[4/4] Running d_generate_masks_dims.py..."
python3 d_generate_masks_dims.py "$@"
echo "✓ Masks and dimensions generated successfully"
echo ""

echo "=========================================="
echo "Pipeline completed successfully!"
echo "=========================================="
