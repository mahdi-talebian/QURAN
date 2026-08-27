#!/usr/bin/env bash
# Build a fully self-hosted static deployment directory.
# Usage: ./scripts/build-static.sh [output-directory]
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-$PROJECT_DIR/site}"

"$PROJECT_DIR/scripts/verify-vendored-assets.py"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Copy only browser-facing files; source archives and development docs stay out of deployment.
cp "$PROJECT_DIR/index.html" "$PROJECT_DIR/app.js" "$PROJECT_DIR/styles.css" "$PROJECT_DIR/asset-mode.js" "$OUTPUT_DIR/"
cp -R "$PROJECT_DIR/assets" "$OUTPUT_DIR/assets"

"$PROJECT_DIR/scripts/extract-local-assets.sh" "$OUTPUT_DIR/assets"

# The deployable build is always self-hosted, regardless of the development default.
sed -i 's/window\.MUSHAF_ASSET_MODE = "remote";/window.MUSHAF_ASSET_MODE = "local";/' "$OUTPUT_DIR/asset-mode.js"
touch "$OUTPUT_DIR/.nojekyll"

cat <<EOF

Static build complete: $OUTPUT_DIR
Serve this directory with any ordinary static web server.
EOF
