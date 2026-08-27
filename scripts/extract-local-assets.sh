#!/usr/bin/env bash
# Extract the vendored source archives for fully self-hosted use.
# Run from any directory: ./scripts/extract-local-assets.sh
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$PROJECT_DIR/vendor"
# Optional first argument lets build scripts extract into a separate deploy directory.
ASSETS_DIR="${1:-$PROJECT_DIR/assets}"

cd "$VENDOR_DIR"
sha256sum -c SHA256SUMS

rm -rf "$ASSETS_DIR/mushaf-svg" "$ASSETS_DIR/qcf4"
mkdir -p "$ASSETS_DIR/mushaf-svg" "$ASSETS_DIR/qcf4"

tar -xzf "$VENDOR_DIR/mushafdatabase-svg-v1.01.tar.gz" \
  --strip-components=1 \
  -C "$ASSETS_DIR/mushaf-svg"

tar -xzf "$VENDOR_DIR/quran-qcf4-data.tar.gz" \
  -C "$ASSETS_DIR/qcf4"

svg_count="$(find "$ASSETS_DIR/mushaf-svg" -maxdepth 1 -type f -name '*.svg' | wc -l | tr -d ' ')"
qcf_count="$(find "$ASSETS_DIR/qcf4/pages" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')"

if [[ "$svg_count" != "604" || "$qcf_count" != "604" ]]; then
  echo "Asset validation failed: SVG=$svg_count, QCF4 pages=$qcf_count" >&2
  exit 1
fi

cat <<EOF

Local assets extracted successfully.
  SVG pages : $svg_count
  QCF4 pages: $qcf_count

asset-mode.js is in auto mode, so local files will now be preferred automatically.
Production builds force strict local mode with no upstream fallback.
EOF
