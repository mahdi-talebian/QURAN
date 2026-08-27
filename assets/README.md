# Extracted application assets

This directory is intentionally empty in the Git working tree.

Run this from the project root to extract local, self-hosted assets from `vendor/`:

```bash
./scripts/extract-local-assets.sh
```

It will create:

```text
assets/
├── mushaf-svg/        # 604 SVG pages
├── qcf4/              # QCF4 page JSON and indexes
└── translations/      # qul-91-persian-wbw.json — QUL resource 91 (Persian word-by-word)
```

حالت پیش‌فرض `auto` پس از extraction به‌طور خودکار local files را ترجیح می‌دهد. برای production، `build-static.sh` خودش حالت را به `local` قطعی تبدیل می‌کند.
