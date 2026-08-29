#!/usr/bin/env python3
import re
import sys
import tarfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from waqf_norm import _close, _fold, normalize_ar, tokens

SVG = Path("/tmp/svgone/002.svg")
EXTRACTED = ROOT / "assets" / "mushaf-svg" / "002.svg"
ARCHIVE = ROOT / "vendor" / "mushafdatabase-svg-v1.01.tar.gz"


def sample_svg_text() -> str | None:
    """Page 002, from the scratch copy, the extracted assets or the archive."""
    for path in (SVG, EXTRACTED):
        if path.is_file():
            return path.read_text(encoding="utf-8")
    if ARCHIVE.is_file():
        with tarfile.open(ARCHIVE, "r:gz") as archive:
            handle = archive.extractfile("SVG V1.01/002.svg")
            return handle.read().decode("utf-8") if handle else None
    return None


def svg_verse_words(text: str, surah: int, ayah: int):
    words = []
    for match in re.finditer(r'<g id="(md-word-\d+)"([^>]*)>', text):
        attrs = match.group(2)

        def attr(name, blob=attrs):
            found = re.search(rf'data-{name}="([^"]*)"', blob)
            return found.group(1) if found else ""

        if int(attr("surah") or 0) != surah or int(attr("aya") or 0) != ayah:
            continue
        words.append({"hafs": attr("hafs"), "waw": attr("waw-alatf") == "true"})
    logical = []
    pending = ""
    for word in words:
        norm = normalize_ar(word["hafs"])
        if not norm:
            continue
        if word["waw"]:
            pending += norm
            continue
        logical.append(pending + norm)
        pending = ""
    return logical


def mark(logical, phrase, last):
    wanted = tokens(phrase)
    for i in range(len(logical) - len(wanted) + 1):
        if all(_close(logical[i + t], wanted[t]) for t in range(len(wanted))):
            return logical[i + len(wanted) - 1] if last else logical[i]
    anchor = next((t for t in (reversed(wanted) if last else wanted) if t != "و" and len(_fold(t)) >= 2), None)
    if not anchor:
        return None
    seq = reversed(list(enumerate(logical))) if last else enumerate(logical)
    for i, tok in seq:
        if _close(tok, anchor):
            return tok
    return None


class SvgHighlightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        text = sample_svg_text()
        if text is None:
            raise unittest.SkipTest("no SVG source available")
        cls.logical = svg_verse_words(text, 2, 4)

    def test_page2_ayah4_waqf_is_qablika(self):
        self.assertEqual(mark(self.logical, "من قبلک", True), "قبلك")

    def test_page2_ayah4_ibtida_is_akhirah(self):
        hit = mark(self.logical, "و بالاخره", False)
        self.assertTrue(hit)
        self.assertIn("اخر", hit.replace("آ", "ا"))


if __name__ == "__main__":
    unittest.main()
