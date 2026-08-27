# Source asset manifest

This directory contains a compact, self-hosting bundle produced from shallow sparse clones of the upstream repositories on 2026-08-27.

## Included source archives

| Archive | Contents | Upstream repository | Pinned commit |
|---|---|---|---|
| `mushafdatabase-svg-v1.01.tar.gz` | All 604 files from `SVG V1.01/` | https://github.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG | `ae5786ab08597f8123575dec4e774f1eca195e0f` |
| `quran-qcf4-data.tar.gz` | `pages/` (604 JSON files), `index.json`, `verses.json`, `font-map.json`, `qbsml.json`, upstream README and licence | https://github.com/MohamadHajjRabee/quran-qcf4 | `5130511027e769f0a8f4eeb7f00f46bde3788d60` |

`SHA256SUMS` verifies both archives before extraction.

## Intentionally excluded

QCF4 `fonts/` and `fonts-woff2/` are not included. This app's canonical visual rendering uses the SVG source, so those fonts are unnecessary for the current architecture. The QCF4 data is included for semantic and interactive enrichment.

The upstream SVG repository also contains an older SVG version. Only `SVG V1.01`, the current source used by this project, is included.

## Extract for self-hosting

From the project root:

```bash
./scripts/extract-local-assets.sh
```

This expands approximately 397 MB under `assets/`. Then change `asset-mode.js` to:

```js
window.MUSHAF_ASSET_MODE = "local";
```

The static server will then serve all page assets directly from your own domain.

## Attribution and integrity

See the upstream repositories and their licence/usage information. Do not alter Quranic content in a way that misrepresents or compromises its integrity.
