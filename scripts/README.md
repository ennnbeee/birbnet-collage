# Generating illustrations

The collage art is generated, not hand-drawn. The repo ships 498 kachō-e illustrations (249 species, a perched and a flight pose each). To restyle them or build a set for your own region, the pipeline is four scripts in this directory.

## Setup

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

## API Keys

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

## Pipeline

1. `a_fetch_labels.py` gets the labels from the specified birdnet-go server url.
2. `b_generate_images.py` renders each bird with Gemini 2.5 Flash Image, on a flat cream ground.
3. `c_generate_cutout.py` removes the ground with BiRefNet and crops to the bird.
4. `d_generate_masks_dims.py` rebuilds the collage silhouette masks inlined in `apt.js`.
5. `e_verify.py` (optional) runs an adversarial species-ID + anatomy check.

```bash
pip install -r requirements.txt

# 1. get labels
# Automatically uses birdnet_go_url from config.yaml
python3 scripts/a_fetch_labels.py


# 2. generate (cream ground) for your region's species
python3 scripts/b_generate_images.py --labels scripts/labels.txt --ebird-region GB

# 3. cut the ground off and crop
python3 scripts/c_generate_cutout.py

# 4. rebuild the collage masks, then bump SKETCH_VERSION + IMG_VERSION in apt.js
python3 scripts/generate_masks_dims.py
```

`--labels` takes any `Sci|Com` per-line file (BirdNET-Pi's `labels.txt` works directly). `--ebird-region` filters to species actually seen in your region
(needs `EBIRD_API_KEY`). Re-render one bird with `--species "Calypte anna|Anna's Hummingbird" --force`.

## Why a cream ground

The image model can't cut a clean transparent background on its own: it leaves holes and fringes, worst on pale birds. Rendering on a flat, consistent cream ground gives a known color that BiRefNet removes cleanly, and the steady ground also holds the painting style together across the whole set. `cutout.py` is the step that makes the backgrounds transparent.

## The prompt

`prompt.template.md` is the kachō-e prompt, sent verbatim per request with `{sci_name}`, `{com_name}`, and `{pose}` substituted. Edit it to change the
style. `pregen.py` attaches up to three reference images per request:

- **Anatomy** (IMAGE 1): a Wikipedia photo of the target species, auto-fetched  and cached in `assets/references/`. Anchors identity and markings. Drop your
  own `references/<slug>.jpg` to override.
- **Anti-reference** (IMAGE 2, optional): a photo of a look-alike the model drifts toward, captioned with what NOT to copy. Wired for blue corvids (vs  Blue Jay) and swallows (vs Barn Swallow); add more in the `ANTI_REFS` table and place photos at `references/_anti_<key>.jpg`.
- **Style** (IMAGE 3, optional): a real Edo-period kachō-e print whose painting technique is borrowed. The genus-to-print mapping is in `pregen.py`'s `STYLE_REFS`. The prints are not bundled (they are someone else's art); put your own in `assets/references/styles/`. The Koson and Yoshida prints used originally are easy to find on the public web by the filenames in `STYLE_REFS`.

All three degrade gracefully: a missing reference is simply not attached.

## Hard species

`species-notes.json` holds one-line diagnostic addenda for species the model gets wrong. Each note names the field marks that matter and the look-alikes to avoid, and is appended to the prompt for that species. Add entries as you find drift; they carry forward to every future regeneration of that bird.

## Verifying

`verify.py` sends each illustration back through Gemini Vision without telling it the target species, then checks the guess, the wing/leg/tail counts, and whether a stray perch crept in. It catches drift a quick eyeball misses.

```bash
python3 scripts/e_verify.py --labels labels.txt              # whole library -> verify-results.csv
python3 scripts/e_verify.py --labels labels.txt calypte-anna
```

## What actually goes wrong

- **Sticks.** Perched raptors often come back gripping a twig the prompt forbade. Generate 2-3 and keep the clean one.
- **Species drift.** The model collapses an uncommon species toward a common  look-alike (a swift becomes a swallow). Fixes, in order: a sharper `species-notes.json` note with anti-feature language; an anti-reference; a different style print; a one-off `--species` regen.
- **Matched pair.** The perched and flight poses must read as the same individual. Review them side by side before locking.

## Detailed Usage

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
python3 scripts/b_generate_images.py --labels ~/BirdNET-Pi/model/labels.txt

# Generate with eBird region filter
python3 scripts/b_generate_images.py --labels scripts/labels.txt --ebird-region GB

# Re-render a single species
python3 scripts/b_generate_images.py --species "Calypte anna|Anna's Hummingbird" --force
```

### Generate Cutouts

```sh
python3 scripts/c_generate_cutout.py
```

### Generate Masks and Dims

```sh
python3 scripts/d_generate_masks_dims.py
```
