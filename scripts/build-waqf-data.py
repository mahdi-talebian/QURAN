#!/usr/bin/env python3
"""Build the waqf/ibtida dataset from the vendored Mushaf SVG source.

The MushafDatabase SVG pages are the visual authority of this project, and they
already encode every printed pause mark twice:

  1. as a typed path inside a ligature group:
        <path id="md-path-007-01" data-type="waqf" data-waqf="waqf jaiz" .../>
  2. as a standalone word group whose text is only the mark:
        <g id="md-word-007" data-surah="024" data-aya="011"
           data-word-index-in-ayah="7" data-hafs="ۚ" .../>

Form (2) is what makes a mark addressable by verse and word position, so this
script reads it and produces a machine-readable index keyed by verse_key.

Output: assets/data/waqf-signs.json

Usage:
    ./scripts/build-waqf-data.py                 # from vendor archive or assets/
    ./scripts/build-waqf-data.py --check         # verify the committed JSON only
    ./scripts/build-waqf-data.py --out FILE      # write somewhere else
"""

from __future__ import annotations

import argparse
import json
import sys
import tarfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterator

ROOT = Path(__file__).resolve().parent.parent
VENDOR_SVG_ARCHIVE = ROOT / "vendor" / "mushafdatabase-svg-v1.01.tar.gz"
EXTRACTED_SVG_DIR = ROOT / "assets" / "mushaf-svg"
DEFAULT_OUTPUT = ROOT / "assets" / "data" / "waqf-signs.json"

# Unicode mark -> internal kind. The kind names follow the SVG's own
# data-waqf vocabulary (waqf lazim / jaiz / qila / sali / taanuq).
MARK_KINDS = {
    "\u06d8": "lazim",     # ۘ  waqf lazim  (م)
    "\u06da": "jaiz",      # ۚ  waqf jaiz   (ج)
    "\u06d7": "qila",      # ۗ  waqf qila   (قلی)
    "\u06d6": "sali",      # ۖ  waqf sali   (صلی)
    "\u06db": "muanaqa",   # ۛ  waqf taanuq (معانقه)
    "\u06de": "hizb",      # ۞  rub al-hizb
    "\u06e9": "sajda",     # ۩  sajda
}

# Cross-check table: the same page must report each kind the same number of
# times through the typed waqf paths and through the standalone mark groups.
TYPED_WAQF_EXPECTATION = {
    "waqf lazim": "lazim",
    "waqf jaiz": "jaiz",
    "waqf qila": "qila",
    "waqf sali": "sali",
    "waqf taanuq": "muanaqa",
}

LETTER_RANGES = [(0x0621, 0x063A), (0x0641, 0x064A), (0x0671, 0x06D3), (0x06D5, 0x06D5), (0x06FA, 0x06FC)]


def has_arabic_letter(text: str) -> bool:
    return any(any(low <= ord(char) <= high for low, high in LETTER_RANGES) for char in text)


def verse_key(surah: str | None, ayah: str | None) -> str | None:
    if not surah or not ayah:
        return None
    return f"{int(surah)}:{int(ayah)}"


def read_pages() -> Iterator[tuple[int, bytes]]:
    """Yield (page_number, svg_bytes) from the extracted assets or the archive."""
    if EXTRACTED_SVG_DIR.is_dir() and any(EXTRACTED_SVG_DIR.glob("*.svg")):
        for page in range(1, 605):
            path = EXTRACTED_SVG_DIR / f"{page:03d}.svg"
            if not path.is_file():
                fail(f"missing extracted SVG page: {path}")
            yield page, path.read_bytes()
        return

    if not VENDOR_SVG_ARCHIVE.is_file():
        fail(f"no SVG source found (looked for {EXTRACTED_SVG_DIR} and {VENDOR_SVG_ARCHIVE})")

    with tarfile.open(VENDOR_SVG_ARCHIVE, "r:gz") as archive:
        members = {member.name: member for member in archive.getmembers() if member.isfile()}
        for page in range(1, 605):
            name = f"SVG V1.01/{page:03d}.svg"
            member = members.get(name)
            if member is None:
                fail(f"archive is missing {name}")
            handle = archive.extractfile(member)
            if handle is None:
                fail(f"cannot read {name}")
            yield page, handle.read()


def display_path(path: Path) -> str:
    """Repo-relative when possible, absolute otherwise (for --out elsewhere)."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def word_records(svg_bytes: bytes, page: int) -> tuple[list[dict], dict[str, int]]:
    """Extract word groups in document order plus typed waqf path counts.

    Document order IS reading order here (top-to-bottom, right-to-left), and it
    must not be re-sorted: data-word-index-in-ayah restarts at 1 for every
    verse, so a (line, index) sort would interleave two verses sharing a line.
    """
    root = ET.fromstring(svg_bytes)
    groups = []
    for node in root.iter():
        node_id = node.attrib.get("id", "")
        if node_id.startswith("md-word-"):
            groups.append({
                "id": node_id,
                "surah": node.attrib.get("data-surah"),
                "ayah": node.attrib.get("data-aya"),
                "line": int(node.attrib.get("data-line-number", "0")),
                "index": int(node.attrib.get("data-word-index-in-ayah", "0")),
                "hafs": node.attrib.get("data-hafs", ""),
            })

    typed = {}
    for node in root.iter():
        kind = node.attrib.get("data-waqf")
        if kind:
            typed[kind] = typed.get(kind, 0) + 1

    # Confirm the document order we depend on: within one verse the word index
    # always increases and the line never goes backwards.
    previous = None
    for group in groups:
        if group["index"] == 0:
            fail(f"page {page}: {group['id']} has no data-word-index-in-ayah")
        if previous and verse_key(previous["surah"], previous["ayah"]) == verse_key(group["surah"], group["ayah"]):
            if group["index"] <= previous["index"]:
                fail(f"page {page}: {group['id']} breaks word order after {previous['id']}")
            if group["line"] < previous["line"]:
                fail(f"page {page}: {group['id']} jumps back a line after {previous['id']}")
        previous = group

    return groups, typed


def build_marks() -> tuple[dict, dict[str, int], dict[str, int]]:
    marks: dict[str, list[dict]] = {}
    kind_totals: dict[str, int] = {}
    typed_totals: dict[str, int] = {}

    for page, svg_bytes in read_pages():
        groups, typed = word_records(svg_bytes, page)
        for key, value in typed.items():
            typed_totals[key] = typed_totals.get(key, 0) + value

        for position, group in enumerate(groups):
            text = group["hafs"]
            # A mark group carries no letters at all; every real word does.
            if has_arabic_letter(text):
                continue

            mark_chars = [char for char in text if char in MARK_KINDS]
            if len(mark_chars) != 1:
                fail(
                    f"page {page}: {group['id']} is letterless but holds "
                    f"{len(mark_chars)} known marks ({text!r})"
                )

            mark = mark_chars[0]
            kind = MARK_KINDS[mark]
            kind_totals[kind] = kind_totals.get(kind, 0) + 1

            previous = groups[position - 1] if position > 0 else None
            following = groups[position + 1] if position + 1 < len(groups) else None
            key = verse_key(group["surah"], group["ayah"])
            if key is None:
                fail(f"page {page}: {group['id']} has no verse key")

            def neighbour(item, slot):
                """A neighbour is only useful when it is a real word."""
                if item is None or not has_arabic_letter(item["hafs"]):
                    return
                neighbour_key = verse_key(item["surah"], item["ayah"])
                yield f"{slot}_word", item["index"]
                yield f"{slot}_text", item["hafs"]
                if neighbour_key != key:
                    yield f"{slot}_key", neighbour_key

            record = {
                "page": page,
                "line": group["line"],
                "word": group["index"],
                "svg_id": group["id"],
                "mark": mark,
                "kind": kind,
            }
            record.update(dict(neighbour(previous, "prev")))
            record.update(dict(neighbour(following, "next")))
            marks.setdefault(key, []).append(record)

    for key in marks:
        marks[key].sort(key=lambda item: (item["page"], item["word"]))
        pair_muanaqa(key, marks[key])

    return marks, kind_totals, typed_totals


def pair_muanaqa(key: str, records: list[dict]) -> None:
    """Mark the two halves of every mu'anaqa (ۛ … ۛ) pair.

    Mu'anaqa always arrives as two marks around one or more words, so the
    marks of a verse can be paired in reading order: 1st with 2nd, and so on.
    """
    halves = [record for record in records if record["kind"] == "muanaqa"]
    for position, record in enumerate(halves):
        if position % 2:
            continue
        partner = halves[position + 1] if position + 1 < len(halves) else None
        pair_id = f"{key}:{record['word']}"
        record["pair"] = "a"
        record["pair_id"] = pair_id
        if partner is not None:
            partner["pair"] = "b"
            partner["pair_id"] = pair_id


def consistency(kind_totals: dict[str, int], typed_totals: dict[str, int]) -> None:
    """The typed waqf paths must agree with the standalone mark groups."""
    problems = []
    for typed_name, kind in TYPED_WAQF_EXPECTATION.items():
        typed = typed_totals.get(typed_name, 0)
        grouped = kind_totals.get(kind, 0)
        if typed != grouped:
            problems.append(f"{typed_name}={typed} but {kind} mark groups={grouped}")
    if problems:
        fail("waqf source disagreement: " + "; ".join(problems))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT), help="output JSON path")
    parser.add_argument("--check", action="store_true", help="compare against the committed JSON")
    args = parser.parse_args()

    marks, kind_totals, typed_totals = build_marks()
    consistency(kind_totals, typed_totals)

    payload = {
        "meta": {
            "name": "Madinah Mushaf pause marks (waqf / ibtida anchors)",
            "derived_from": "vendor/mushafdatabase-svg-v1.01.tar.gz (SVG V1.01)",
            "generated_by": "scripts/build-waqf-data.py",
            "key": "surah:ayah",
            "mark_counts": kind_totals,
            "marks": sum(kind_totals.values()),
            "verses_with_marks": len(marks),
            "word_index_note": (
                "word is the SVG data-word-index-in-ayah of the mark itself; it counts "
                "the mark, so it runs ahead of the QCF4 logical word position."
            ),
            "neighbour_note": (
                "prev_* / next_* describe the surrounding words in reading flow; "
                "prev_key / next_key appear only when that word belongs to another verse."
            ),
            "pair_note": "mu'anaqa marks carry pair (a|b) and a shared pair_id",
        },
        "marks": marks,
    }

    if args.check:
        target = Path(args.out)
        if not target.is_file():
            fail(f"{display_path(target)} does not exist; run without --check to build it")
        committed = json.loads(target.read_text(encoding="utf-8"))
        if committed.get("marks") != marks:
            fail("committed waqf-signs.json differs from the vendored SVG source; rebuild it")
        print("waqf-signs.json matches the vendored SVG source.")
        print(f"  marks            : {sum(kind_totals.values())}")
        print(f"  verses with mark : {len(marks)}")
        for kind in sorted(kind_totals):
            print(f"  {kind:<9}: {kind_totals[kind]}")
        return

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {display_path(output)}")
    print(f"  marks            : {sum(kind_totals.values())}")
    print(f"  verses with mark : {len(marks)}")
    for kind in sorted(kind_totals):
        print(f"  {kind:<9}: {kind_totals[kind]}")


if __name__ == "__main__":
    main()
