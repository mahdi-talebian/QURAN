#!/usr/bin/env bash
# Self-hosted local development: extract local assets once, then serve the app.
# Usage: PORT=4173 ./scripts/start-local.sh
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"

if [[ ! -f "$PROJECT_DIR/assets/mushaf-svg/001.svg" || ! -f "$PROJECT_DIR/assets/qcf4/pages/001.json" ]]; then
  "$PROJECT_DIR/scripts/extract-local-assets.sh"
fi

printf '\nLocal self-hosted development is available at: http://localhost:%s\n' "$PORT"
printf 'Asset mode is auto: local files are preferred because they now exist.\n\n'
exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$PROJECT_DIR"
