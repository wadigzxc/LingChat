"""Build a deterministic public V1 parameter-only fixture using Python stdlib.
Usage: python examples/lighting-presets/rebuild-neutral.py --output <new-path>
The output must not exist; no application data is read or changed.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile


def build_archive():
    filters = dict(brightness=1.0, contrast=1.0, saturation=1.0, sepia=0.0,
                   glow_radius=0, glow_color="#ffaa33")
    ambient = dict(enabled=False, color="#ffffff", opacity=0.0)
    manifest = {
        "format": "linglight", "version": 1,
        "originId": "f30dbfb0-dc3e-4d8a-96a8-730ed9442267", "revision": 1,
        "metadata": {"name": "Portable Neutral", "description": "Rebuildable neutral user preset; no assets.",
                     "aliases": ["portable neutral"], "tags": ["neutral"], "category": "custom"},
        "lighting": {
            "schema_version": 2, "enabled": False, "master_intensity": 1.0,
            "link_character_background": True,
            "character": filters.copy(), "background": filters.copy(),
            "character_ambient": ambient.copy(), "background_ambient": ambient.copy(),
            "main_light": {"enabled": False, "shape": "radial", "target": "both", "x": 0.5, "y": 0.5,
                           "angle": 0.0, "radius": 0.8, "color_start": "#ffffff", "color_end": "#00000000",
                           "opacity": 0.0, "blend_mode": "normal"},
            "rim_light": {"enabled": False, "color": "#ffffff", "intensity": 0.0, "width": 0.0,
                          "softness": 0.0, "angle": 0.0, "offset": 0.0},
            "bloom": {"enabled": False, "target": "both", "color": "#ffffff", "radius": 0.0, "intensity": 0.0},
            "vignette": {"enabled": False, "color": "#000000", "intensity": 0.0, "radius": 0.8, "softness": 0.0},
            "asset_layers": [],
        },
        "assets": [], "futureLayers": [],
    }
    output = io.BytesIO()
    entry = zipfile.ZipInfo("manifest.json", (1980, 1, 1, 0, 0, 0))
    entry.create_system = 3
    entry.external_attr = 0o100644 << 16
    entry.compress_type = zipfile.ZIP_STORED
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(entry, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = build_archive()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as target:
        target.write(payload)
    print(f"{args.output}: {len(payload)} bytes, sha256={hashlib.sha256(payload).hexdigest()}")


if __name__ == "__main__":
    main()
