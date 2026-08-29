#!/usr/bin/env python3
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from waqf_norm import phrase_in_verse

QURAN = Path("/tmp/quran.json")


class NormTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.quran = {}
        for surah in json.loads(QURAN.read_text(encoding="utf-8")):
            for ayah in surah["verses"]:
                cls.quran[f"{surah['id']}:{ayah['id']}"] = ayah["text"]

    def test_baqarah_4(self):
        verse = self.quran["2:4"]
        self.assertTrue(phrase_in_verse("من قبلك", verse))
        self.assertTrue(phrase_in_verse("و بالاخره", verse))

    def test_angels_spelling(self):
        self.assertTrue(phrase_in_verse("الملائكه", self.quran["2:31"]))

    def test_uthmani_variants(self):
        self.assertTrue(phrase_in_verse("شیئا", self.quran["2:48"]))
        self.assertTrue(phrase_in_verse("الی ابراهیم", self.quran["2:136"]))
        self.assertTrue(phrase_in_verse("و قتل داوود", self.quran["2:251"]))
        self.assertTrue(phrase_in_verse("و یقتلون النبیین", self.quran["3:21"]))
        self.assertTrue(phrase_in_verse("لاکفرن عنهم سیئاتهم", self.quran["3:195"]))


if __name__ == "__main__":
    unittest.main()
