#!/usr/bin/env python3
"""Build assets/mohasha-waqf.json from the TSV dump and drop unmatched phrases."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from waqf_norm import phrase_in_verse  # noqa: E402

QURAN = Path("/tmp/quran.json")
TSV = ROOT / "assets" / "mohasha.tsv"
OUT = ROOT / "assets" / "mohasha-waqf.json"


def load_quran():
    data = json.loads(QURAN.read_text(encoding="utf-8"))
    verses = {}
    for surah in data:
        for ayah in surah["verses"]:
            verses[f"{surah['id']}:{ayah['id']}"] = ayah["text"]
    return verses


def split_phrases(cell: str) -> list[str]:
    return [p.strip() for p in cell.split("|") if p.strip()]


def main() -> int:
    quran = load_quran()
    verses = {}
    dropped = []
    for line in TSV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, waqf_cell, ibtida_cell = line.split("\t")
        surah, ayah = key.split(":")
        neighbors = [quran.get(key, "")]
        for delta in (-1, 1):
            neighbors.append(quran.get(f"{surah}:{int(ayah) + delta}", ""))
        window = " ".join(part for part in neighbors if part)
        waqf, ibtida = [], []
        for phrase in split_phrases(waqf_cell):
            if window and phrase_in_verse(phrase, window):
                waqf.append(phrase)
            else:
                dropped.append((key, "waqf", phrase))
        for phrase in split_phrases(ibtida_cell):
            if window and phrase_in_verse(phrase, window):
                ibtida.append(phrase)
            else:
                dropped.append((key, "ibtida", phrase))
        if waqf or ibtida:
            verses[key] = {"waqf": waqf, "ibtida": ibtida}

    OUT.write_text(
        json.dumps(
            {
                "source": "جدول وقف و ابتدا — سیدعلی حسینی (مصحف محشی)",
                "verses": verses,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(verses)} verses, dropped {len(dropped)} unmatched phrases")
    if dropped[:15]:
        print("sample dropped:")
        for row in dropped[:15]:
            print(" ", row)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
