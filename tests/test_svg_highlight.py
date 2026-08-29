#!/usr/bin/env python3
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from waqf_norm import _close, _fold, normalize_ar, tokens

SVG = Path("/tmp/svgone/002.svg")


def svg_verse_words(path: Path, surah: int, ayah: int):
    text = path.read_text(encoding="utf-8")
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
        if not SVG.exists():
            raise unittest.SkipTest("sample SVG not extracted")
        cls.logical = svg_verse_words(SVG, 2, 4)

    def test_page2_ayah4_waqf_is_qablika(self):
        self.assertEqual(mark(self.logical, "من قبلک", True), "قبلك")

    def test_page2_ayah4_ibtida_is_akhirah(self):
        hit = mark(self.logical, "و بالاخره", False)
        self.assertTrue(hit)
        self.assertIn("اخر", hit.replace("آ", "ا"))


if __name__ == "__main__":
    unittest.main()
