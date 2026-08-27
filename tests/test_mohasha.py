#!/usr/bin/env python3
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from waqf_norm import phrase_in_verse  # noqa: E402

QURAN = Path("/tmp/quran.json")
DATA = ROOT / "assets" / "mohasha-waqf.json"


class MohashaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.quran = {}
        for surah in json.loads(QURAN.read_text(encoding="utf-8")):
            for ayah in surah["verses"]:
                cls.quran[f"{surah['id']}:{ayah['id']}"] = ayah["text"]
        cls.table = json.loads(DATA.read_text(encoding="utf-8"))
        cls.verses = cls.table["verses"]

    def test_minimum_coverage(self):
        self.assertGreaterEqual(len(self.verses), 400)
        surahs = {int(key.split(":")[0]) for key in self.verses}
        self.assertIn(2, surahs)
        self.assertGreaterEqual(len(surahs), 55)

    def test_baqarah_sample(self):
        entry = self.verses["2:4"]
        self.assertTrue(any("قبلك" in p for p in entry["waqf"]))
        self.assertTrue(any("اخره" in p or "آخره" in p for p in entry["ibtida"]))

    def test_every_phrase_exists_in_its_verse(self):
        failures = []
        for key, entry in self.verses.items():
            verse = self.quran.get(key)
            if verse is None:
                failures.append(f"missing verse {key}")
                continue
            for kind in ("waqf", "ibtida"):
                for phrase in entry.get(kind, []):
                    if not phrase_in_verse(phrase, verse):
                        failures.append(f"{key} {kind}: {phrase}")
        self.assertEqual(failures, [], "\n".join(failures[:40]))

    def test_each_entry_has_at_least_one_mark(self):
        empty = [key for key, entry in self.verses.items() if not entry.get("waqf") and not entry.get("ibtida")]
        self.assertEqual(empty, [])


if __name__ == "__main__":
    unittest.main()
