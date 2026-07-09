#!/usr/bin/env python3
"""
Generate dims.json and masks.json from PNG illustrations.
Processes all PNG files in assets/illustrations/ and creates:
- dims.json: [width, height] for each bird
- masks.json: downsampled alpha masks for collision detection
"""

import json
import os
import base64
from pathlib import Path
from PIL import Image

# Configuration
ILLUSTRATIONS_DIR = Path("assets/illustrations")
DIMS_OUTPUT = Path("dims.json")
MASKS_OUTPUT = Path("masks.json")
GRID_STRIDE = 4  # Match the GRID_STRIDE in apt.js

def slug_from_filename(filename):
    """Convert filename to slug (remove extension and -2 suffix)."""
    name = filename.replace('.png', '')
    # Don't include pose variants (files ending in -2)
    if name.endswith('-2'):
        return None
    return name

def create_alpha_mask(image, stride=4):
    """
    Create a downsampled binary alpha mask from an image.
    Returns width, height (in grid units) and base64-encoded bitmap.
    """
    # Get image dimensions
    width, height = image.size
    
    # Calculate grid dimensions
    grid_w = (width + stride - 1) // stride
    grid_h = (height + stride - 1) // stride
    
    # Create binary mask (1 bit per grid cell)
    # Pack bits into bytes (8 bits per byte)
    num_bits = grid_w * grid_h
    num_bytes = (num_bits + 7) // 8
    mask_bytes = bytearray(num_bytes)
    
    # Convert to RGBA if needed
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    
    pixels = image.load()
    
    # Sample each grid cell and set bit if any pixel has alpha > threshold
    bit_index = 0
    for gy in range(grid_h):
        for gx in range(grid_w):
            # Sample the grid cell (check if any pixel is opaque)
            has_opaque = False
            for dy in range(stride):
                py = gy * stride + dy
                if py >= height:
                    break
                for dx in range(stride):
                    px = gx * stride + dx
                    if px >= width:
                        break
                    # Check alpha channel (index 3 in RGBA)
                    if pixels[px, py][3] > 127:  # threshold at 50%
                        has_opaque = True
                        break
                if has_opaque:
                    break
            
            # Set bit if opaque pixel found
            if has_opaque:
                byte_index = bit_index // 8
                bit_offset = bit_index % 8
                mask_bytes[byte_index] |= (1 << (7 - bit_offset))
            
            bit_index += 1
    
    # Base64 encode the mask
    mask_base64 = base64.b64encode(mask_bytes).decode('ascii')
    
    return grid_w, grid_h, mask_base64

def process_illustrations():
    """Process all illustrations and generate dims.json and masks.json."""
    dims = {}
    masks = {}
    
    print(f"Processing illustrations in {ILLUSTRATIONS_DIR}...")
    
    # Get all PNG files
    png_files = sorted(ILLUSTRATIONS_DIR.glob("*.png"))
    processed = 0
    skipped = 0
    
    for png_path in png_files:
        slug = slug_from_filename(png_path.name)
        if slug is None:
            skipped += 1
            continue  # Skip pose variants
        
        try:
            with Image.open(png_path) as img:
                width, height = img.size
                
                # Add to dims.json
                dims[slug] = [width, height]
                
                # Create and add mask to masks.json
                grid_w, grid_h, mask_bits = create_alpha_mask(img, GRID_STRIDE)
                masks[slug] = {
                    "w": grid_w,
                    "h": grid_h,
                    "bits": mask_bits
                }
                
                processed += 1
                if processed % 50 == 0:
                    print(f"  Processed {processed} birds...")
                    
        except Exception as e:
            print(f"  Error processing {png_path.name}: {e}")
    
    print(f"\nProcessed {processed} illustrations, skipped {skipped} pose variants")
    
    # Sort by keys for consistent output
    dims = dict(sorted(dims.items()))
    masks = dict(sorted(masks.items()))
    
    # Write dims.json
    print(f"Writing {DIMS_OUTPUT}...")
    with open(DIMS_OUTPUT, 'w') as f:
        json.dump(dims, f, indent=4)
    
    # Write masks.json
    print(f"Writing {MASKS_OUTPUT}...")
    with open(MASKS_OUTPUT, 'w') as f:
        json.dump(masks, f, indent=4)
    
    print(f"\n✓ Generated dims.json with {len(dims)} entries")
    print(f"✓ Generated masks.json with {len(masks)} entries")

if __name__ == "__main__":
    process_illustrations()
