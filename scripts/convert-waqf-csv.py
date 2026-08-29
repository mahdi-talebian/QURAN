#!/usr/bin/env python3
"""Convert a CSV of book-based waqf/ibtida rulings into assets/data/waqf-overrides.json.

The app always loads the printed marks from assets/data/waqf-signs.json. This
file adds rulings from a book (for example منار الهدی فی بیان الوقف و الابتدا)
on top of them; see assets/data/README.md for the full schema.

CSV columns (UTF-8, header row required, BOM tolerated):

  waqf CSV    : verse,word,prev_word,type,ar,fa,reason,ibtida_word
  ibtida CSV  : verse,word,type,fa,note

Only `verse` is mandatory; every other column is optional and a row needs
either `word` (the printed mark's own position) or `prev_word` (the word before
the pause). Both use the Mushaf numbering of assets/data/waqf-signs.json, where
a printed mark counts as a position. Bad rows are reported by line and skipped,
never dropped silently.

Usage:
    ./scripts/convert-waqf-csv.py --waqf manar-waqf.csv \\
        --ibtida manar-ibtida.csv --source "منار الهدی (اشمونی)" \\
        --out assets/data/waqf-overrides.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "assets" / "data" / "waqf-overrides.json"

VERSE_KEY = re.compile(r"^\d+:\d+$")

# Canonical kinds, with the Arabic/Persian names a book usually uses.
TYPE_ALIASES = {
    "tam": "tam", "تام": "tam", "تامّ": "tam", "تامه": "tam",
    "kafi": "kafi", "کافی": "kafi", "كافي": "kafi", "كاف": "kafi", "کاف": "kafi",
    "hasan": "hasan", "حسن": "hasan",
    "lazim": "lazim", "لازم": "lazim", "واجب": "lazim", "م": "lazim",
    "jaiz": "jaiz", "جائز": "jaiz", "جایز": "jaiz", "ج": "jaiz",
    "qila": "qila", "قلی": "qila", "اولی": "qila",
    "sali": "sali", "صلی": "sali", "واصل": "sali",
    "muanaqa": "muanaqa", "معانقه": "muanaqa", "تعاوق": "muanaqa",
    "qabih": "qabih", "قبیح": "qabih", "قبيح": "qabih",
    "sajda": "sajda", "سجده": "sajda",
    "hizb": "hizb", "حزب": "hizb", "ربع": "hizb",
    "sakt": "sakt", "سکت": "sakt", "سكت": "sakt",
}


def display_path(path: Path) -> str:
    """Repo-relative when possible, absolute otherwise (for --out elsewhere)."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def normalize_type(value: str | None) -> str | None:
    if not value:
        return None
    key = value.strip().lower()
    return TYPE_ALIASES.get(key, key if re.fullmatch(r"[a-z]+", key) else None)


def read_rows(path: Path, required: tuple[str, ...]) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            fail(f"{path.name} is empty")
        header = [name.strip().lower() for name in reader.fieldnames]
        missing = [name for name in required if name not in header]
        if missing:
            fail(f"{path.name} is missing column(s): {', '.join(missing)}")
        reader.fieldnames = header
        return [
            {(key or "").strip().lower(): (value or "").strip() for key, value in row.items()}
            for row in reader
        ]


def to_word(value: str) -> int | None:
    try:
        word = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return word if word >= 1 else None


def convert_waqf(rows: list[dict], source: str) -> tuple[list[dict], list[str]]:
    output, warnings = [], []
    for number, row in enumerate(rows, start=2):
        verse = row.get("verse", "")
        word = to_word(row.get("word", ""))
        prev_word = to_word(row.get("prev_word", ""))
        kind = normalize_type(row.get("type"))

        if not VERSE_KEY.match(verse):
            warnings.append(f"waqf line {number}: bad verse key {verse!r} — skipped")
            continue
        if word is None and prev_word is None:
            warnings.append(f"waqf line {number}: needs word or prev_word — skipped")
            continue
        if row.get("type") and kind is None:
            warnings.append(f"waqf line {number}: unknown type {row['type']!r} — kept as-is")

        entry = {"verse": verse}
        if word:
            entry["word"] = word
        if prev_word:
            entry["prev_word"] = prev_word
        if kind:
            entry["type"] = kind
        if row.get("ar"):
            entry["ar"] = row["ar"]
        if row.get("fa"):
            entry["fa"] = row["fa"]
        if row.get("reason"):
            entry["reason"] = row["reason"]
        ibtida_word = to_word(row.get("ibtida_word", ""))
        if ibtida_word:
            entry["ibtida_word"] = ibtida_word
        output.append(entry)
    return output, warnings


def convert_ibtida(rows: list[dict], source: str) -> tuple[list[dict], list[str]]:
    output, warnings = [], []
    for number, row in enumerate(rows, start=2):
        verse = row.get("verse", "")
        word = to_word(row.get("word", ""))
        if not VERSE_KEY.match(verse):
            warnings.append(f"ibtida line {number}: bad verse key {verse!r} — skipped")
            continue
        if word is None:
            warnings.append(f"ibtida line {number}: bad word position {row.get('word')!r} — skipped")
            continue

        entry = {"verse": verse, "word": word, "fa": row.get("fa") or "ابتدا"}
        kind = normalize_type(row.get("type"))
        if kind:
            entry["type"] = kind
        if row.get("note"):
            entry["note"] = row["note"]
        output.append(entry)
    return output, warnings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--waqf", type=Path, help="CSV of pause rulings")
    parser.add_argument("--ibtida", type=Path, help="CSV of restart points")
    parser.add_argument("--source", default="book", help="source name shown in the UI")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.waqf and not args.ibtida:
        fail("give at least one of --waqf / --ibtida")

    payload = {"meta": {"source": args.source, "generated_by": "scripts/convert-waqf-csv.py"}}
    warnings: list[str] = []

    if args.waqf:
        rows = read_rows(args.waqf, ("verse",))
        entries, row_warnings = convert_waqf(rows, args.source)
        payload["waqf"] = entries
        warnings += row_warnings
        print(f"waqf rows   : {len(rows)} in, {len(entries)} kept")

    if args.ibtida:
        rows = read_rows(args.ibtida, ("verse", "word"))
        entries, row_warnings = convert_ibtida(rows, args.source)
        payload["ibtida"] = entries
        warnings += row_warnings
        print(f"ibtida rows : {len(rows)} in, {len(entries)} kept")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {display_path(args.out)}")

    for warning in warnings:
        print(f"  ! {warning}")


if __name__ == "__main__":
    main()
