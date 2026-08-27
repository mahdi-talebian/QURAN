#!/usr/bin/env python3
"""Validate the two vendored source archives without extracting them to disk."""

from __future__ import annotations

import hashlib
import io
import json
import sys
import tarfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"
SVG_ARCHIVE = VENDOR / "mushafdatabase-svg-v1.01.tar.gz"
QCF_ARCHIVE = VENDOR / "quran-qcf4-data.tar.gz"
SUMS = VENDOR / "SHA256SUMS"


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_checksums() -> None:
    expected = {}
    for line in SUMS.read_text(encoding="utf-8").splitlines():
        digest, filename = line.split(maxsplit=1)
        expected[filename.strip()] = digest

    for archive in (SVG_ARCHIVE, QCF_ARCHIVE):
        actual = sha256(archive)
        if expected.get(archive.name) != actual:
            fail(f"checksum mismatch for {archive.name}")


def svg_page_data(member: tarfile.TarInfo, archive: tarfile.TarFile, expected_page: int):
    handle = archive.extractfile(member)
    if handle is None:
        fail(f"cannot read {member.name}")

    try:
        root = ET.parse(handle).getroot()
    except ET.ParseError as error:
        fail(f"invalid XML in {member.name}: {error}")

    if root.attrib.get("id") != f"Mushaf_Page_{expected_page:03d}":
        fail(f"unexpected root id in {member.name}")

    page_group = next((node for node in root.iter() if node.attrib.get("id") == "md-page"), None)
    if page_group is None or int(page_group.attrib.get("data-page-number", "0")) != expected_page:
        fail(f"unexpected page metadata in {member.name}")

    line_ids = {
        node.attrib.get("id")
        for node in root.iter()
        if node.attrib.get("id", "").startswith("md-line-")
    }
    if len(line_ids) != 15:
        fail(f"{member.name} has {len(line_ids)} line groups; expected 15")

    words = [
        node for node in root.iter()
        if node.attrib.get("id", "").startswith("md-word-")
    ]
    if not words:
        fail(f"{member.name} has no word groups")

    verse_keys = set()
    for word in words:
        surah = word.attrib.get("data-surah")
        ayah = word.attrib.get("data-aya")
        if surah and ayah:
            verse_keys.add(f"{int(surah)}:{int(ayah)}")

    return verse_keys, len(words)


def qcf_page_data(member: tarfile.TarInfo, archive: tarfile.TarFile, expected_page: int):
    handle = archive.extractfile(member)
    if handle is None:
        fail(f"cannot read {member.name}")

    try:
        data = json.load(io.TextIOWrapper(handle, encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"invalid JSON in {member.name}: {error}")

    if data.get("page") != expected_page:
        fail(f"unexpected page number in {member.name}")
    line_count = len(data.get("lines", []))
    # QCF4 stores the centered opening pages as their 8 visible lines;
    # the SVG source preserves all 15 physical slots, including blanks.
    expected_line_count = 8 if expected_page in (1, 2) else 15
    if line_count != expected_line_count:
        fail(f"{member.name} has {line_count} lines; expected {expected_line_count}")

    verse_keys = {
        word["verse_key"]
        for line in data["lines"]
        for word in line.get("words", [])
        if word.get("type") == "word" and word.get("verse_key")
    }
    return verse_keys


def main() -> None:
    for required in (SVG_ARCHIVE, QCF_ARCHIVE, SUMS):
        if not required.is_file():
            fail(f"missing required file: {required.relative_to(ROOT)}")

    verify_checksums()

    with tarfile.open(SVG_ARCHIVE, "r:gz") as svg_tar, tarfile.open(QCF_ARCHIVE, "r:gz") as qcf_tar:
        svg_members = {member.name: member for member in svg_tar.getmembers() if member.isfile()}
        qcf_members = {member.name: member for member in qcf_tar.getmembers() if member.isfile()}

        expected_svg = {f"SVG V1.01/{page:03d}.svg" for page in range(1, 605)}
        expected_qcf = {f"pages/{page:03d}.json" for page in range(1, 605)}

        if not expected_svg.issubset(svg_members):
            fail("SVG archive is missing one or more canonical pages")
        if not expected_qcf.issubset(qcf_members):
            fail("QCF4 archive is missing one or more canonical JSON pages")

        svg_word_total = 0
        for page in range(1, 605):
            svg_verses, word_count = svg_page_data(svg_members[f"SVG V1.01/{page:03d}.svg"], svg_tar, page)
            qcf_verses = qcf_page_data(qcf_members[f"pages/{page:03d}.json"], qcf_tar, page)
            svg_word_total += word_count

            # Both sources must describe the same verses on the same printed page.
            if svg_verses != qcf_verses:
                fail(
                    f"verse set mismatch on page {page}: "
                    f"SVG={sorted(svg_verses)} QCF4={sorted(qcf_verses)}"
                )

    print("Vendored asset verification passed.")
    print("  SVG pages : 604")
    print("  QCF pages : 604")
    print(f"  SVG word groups: {svg_word_total}")


if __name__ == "__main__":
    main()
