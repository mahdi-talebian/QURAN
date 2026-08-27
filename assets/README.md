# Extracted application assets

This directory is intentionally empty in the Git working tree.

Run this from the project root to extract local, self-hosted assets from `vendor/`:

```bash
./scripts/extract-local-assets.sh
```

It will create:

```text
assets/
├── mushaf-svg/  # 604 SVG pages
└── qcf4/        # QCF4 page JSON and indexes
```

Then set `window.MUSHAF_ASSET_MODE = "local"` in `asset-mode.js`.
