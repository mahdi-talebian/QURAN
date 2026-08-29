#!/usr/bin/env python3
"""Assemble plain verse texts from the vendored QCF4 data.

`tests/` was written against a scratch `/tmp/quran.json` fixture that is not part
of this repository, so the suite failed on a clean checkout. This module rebuilds
the same structure from the vendored sources:

    vendor/quran-qcf4-data.tar.gz   (pages/NNN.json)   — or —
    assets/qcf4/pages/NNN.json      (after ./scripts/extract-local-assets.sh)

Shape, matching the old fixture:

    [{"id": 1, "verses": [{"id": 1, "text": "بِسْمِ ٱللَّهِ …"}, …]}, …]

Usage:
    python3 scripts/quran_text.py                 # print summary
    python3 scripts/quran_text.py --out FILE      # write the fixture as JSON
"""

from __future__ import annotations

import argparse
import io
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QCF_ARCHIVE = ROOT / "vendor" / "quran-qcf4-data.tar.gz"
EXTRACTED_PAGES = ROOT / "assets" / "qcf4" / "pages"


def page_sources() -> list[tuple[int, bytes]]:
    """Yield (page_number, json_bytes) for all 604 pages, in page order."""
    if EXTRACTED_PAGES.is_dir() and any(EXTRACTED_PAGES.glob("*.json")):
        return [
            (page, (EXTRACTED_PAGES / f"{page:03d}.json").read_bytes())
            for page in range(1, 605)
        ]

    if not QCF_ARCHIVE.is_file():
        raise FileNotFoundError(
            f"no QCF4 source found (looked for {EXTRACTED_PAGES} and {QCF_ARCHIVE})"
        )

    with tarfile.open(QCF_ARCHIVE, "r:gz") as archive:
        members = {m.name: m for m in archive.getmembers() if m.isfile()}
        out = []
        for page in range(1, 605):
            member = members.get(f"pages/{page:03d}.json")
            if member is None:
                raise FileNotFoundError(f"archive is missing pages/{page:03d}.json")
            handle = archive.extractfile(member)
            assert handle is not None
            out.append((page, handle.read()))
        return out


def verse_texts() -> dict[str, str]:
    """{"2:4": "…"} — verse text assembled from QCF4 word records in reading order."""
    parts: dict[str, list[str]] = {}
    for _, raw in page_sources():
        data = json.loads(raw.decode("utf-8"))
        for line in data.get("lines", []):
            for word in line.get("words", []):
                if word.get("type") != "word":
                    continue
                key = word.get("verse_key")
                if not key:
                    continue
                parts.setdefault(key, []).append(word.get("text", ""))

    return {key: " ".join(tokens) for key, tokens in parts.items()}


def surah_list(texts: dict[str, str] | None = None) -> list[dict]:
    """The fixture shape the tests consume, ordered by surah then ayah."""
    texts = verse_texts() if texts is None else texts
    grouped: dict[int, dict[int, str]] = {}
    for key, text in texts.items():
        surah, ayah = key.split(":")
        grouped.setdefault(int(surah), {})[int(ayah)] = text

    return [
        {
            "id": surah,
            "verses": [{"id": ayah, "text": verses[ayah]} for ayah in sorted(verses)],
        }
        for surah, verses in sorted(grouped.items())
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, help="write the fixture JSON here")
    args = parser.parse_args()

    surahs = surah_list()
    verses = sum(len(item["verses"]) for item in surahs)
    print(f"surahs: {len(surahs)}   verses: {verses}")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(surahs, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
