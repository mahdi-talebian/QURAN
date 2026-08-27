#!/usr/bin/env bash
# Remove only extracted assets; vendored .tar.gz source archives stay intact.
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$PROJECT_DIR/assets/mushaf-svg" "$PROJECT_DIR/assets/qcf4"
echo "Extracted local assets removed. Vendor archives remain in vendor/."
