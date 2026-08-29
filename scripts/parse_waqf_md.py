#!/usr/bin/env python3
"""Parse جدول_وقف_و_ابتدا.md into assets/mohasha.tsv."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MD = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/waqf.md")
OUT = ROOT / "assets" / "mohasha.tsv"

SURAH = {
    "بقره": 2,
    "آل عمران": 3,
    "نساء": 4,
    "مائده": 5,
    "انعام": 6,
    "اعراف": 7,
    "انفال": 8,
    "توبه": 9,
    "یونس": 10,
    "يونس": 10,
    "هود": 11,
    "یوسف": 12,
    "يوسف": 12,
    "رعد": 13,
    "ابراهیم": 14,
    "ابراهيم": 14,
    "حجر": 15,
    "نحل": 16,
    "اسراء": 17,
    "کهف": 18,
    "كهف": 18,
    "مریم": 19,
    "مريم": 19,
    "طه": 20,
    "انبیاء": 21,
    "انبياء": 21,
    "حج": 22,
    "مومنون": 23,
    "مؤمنون": 23,
    "نور": 24,
    "فرقان": 25,
    "شعراء": 26,
    "نمل": 27,
    "قصص": 28,
    "عنکبوت": 29,
    "عنكبوت": 29,
    "روم": 30,
    "لقمان": 31,
    "سجده": 32,
    "احزاب": 33,
    "سبأ": 34,
    "سبا": 34,
    "فاطر": 35,
    "یس": 36,
    "يس": 36,
    "صافات": 37,
    "ص": 38,
    "زمر": 39,
    "غافر": 40,
    "فصلت": 41,
    "شوري": 42,
    "شوری": 42,
    "شورى": 42,
    "زخرف": 43,
    "دخان": 44,
    "جاثیه": 45,
    "جاثيه": 45,
    "احقاف": 46,
    "محمد": 47,
    "فتح": 48,
    "حجرات": 49,
    "ق": 50,
    "ذاریات": 51,
    "طور": 52,
    "نجم": 53,
    "قمر": 54,
    "رحمن": 55,
    "واقعه": 56,
    "حدید": 57,
    "حديد": 57,
    "مجادله": 58,
    "حشر": 59,
    "ممتحنه": 60,
    "صف": 61,
    "جمعه": 62,
    "منافقون": 63,
    "تغابن": 64,
    "طلاق": 65,
    "تحریم": 66,
    "تحريم": 66,
    "ملک": 67,
    "قلم": 68,
    "حاقه": 69,
    "معارج": 70,
    "نوح": 71,
    "جن": 72,
    "مزمل": 73,
    "مدثر": 74,
    "قیامه": 75,
    "انسان": 76,
    "مرسلات": 77,
    "نبأ": 78,
    "نازعات": 79,
    "عبس": 80,
    "تکویر": 81,
    "انفطار": 82,
    "مطففین": 83,
    "انشقاق": 84,
    "بروج": 85,
    "طارق": 86,
    "اعلی": 87,
    "غاشیه": 88,
    "فجر": 89,
    "بلد": 90,
    "شمس": 91,
    "لیل": 92,
    "ضحی": 93,
    "شرح": 94,
    "تین": 95,
    "علق": 96,
    "قدر": 97,
    "بینه": 98,
    "زلزله": 99,
    "عادیات": 100,
    "قارعه": 101,
    "تکاثر": 102,
    "عصر": 103,
    "همزه": 104,
    "فیل": 105,
    "قریش": 106,
    "ماعون": 107,
    "کوثر": 108,
    "کافرون": 109,
    "نصر": 110,
    "مسد": 111,
    "اخلاص": 112,
    "فلق": 113,
    "ناس": 114,
}

ARABIC_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
LABEL = re.compile(
    r"^(اولویت(?:\s+اول|\s+دوم|\s+سوم|\s+یکسان)?|اولويت.*|مورد(?:\s+اول|\s+دوم|\s+سوم|\s+چهارم)?|ورد(?:\s+اول|\s+دوم)?|اضطراري|اضطراری|اجتناب ناپذیر|مکث کوتاه)\s*[:：]?\s*",
    re.I,
)


def arabic_int(value: str) -> int | None:
    text = value.translate(ARABIC_DIGITS).strip()
    text = re.sub(r"[^\d]", "", text)
    return int(text) if text.isdigit() else None


def ayah_ids(cell: str) -> list[int]:
    cell = cell.translate(ARABIC_DIGITS)
    nums = [int(n) for n in re.findall(r"\d+", cell)]
    return nums or []


TYPOS = {
    "برخا": "برزخا",
    "ولداالله": "ولد الله",
}


def phrases(cell: str) -> list[str]:
    cell = cell.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    quoted = re.findall(r"[«»\"“”]([^«»\"“”]+)[«»\"“”]", cell)
    if quoted and re.search(r"متعلق|یادداشت|پایان آیه", cell):
        cell = "\n".join(quoted)
    out = []
    for raw in re.split(r"[\n|;]+", cell):
        piece = LABEL.sub("", raw).strip()
        piece = re.sub(r"[\(（].*?[\)）]", " ", piece)
        piece = re.sub(r"(اضطراري|اضطراری|اجتناب ناپذیر|مکث کوتاه).*$", "", piece)
        piece = re.sub(r"^\(+|\)+$", "", piece).strip()
        piece = re.sub(r"^(اول|دوم|سوم|چهارم)\s*[:：]?\s*", "", piece).strip()
        piece = re.sub(r"^[»«\"“”]+|[»«\"“”]+$", "", piece).strip()
        piece = re.sub(r"تا پایان آیه.*$", "", piece).strip()
        piece = re.sub(r"\s+", " ", piece)
        for src, dst in TYPOS.items():
            piece = piece.replace(src, dst)
        if re.search(r"متعلق|یادداشت", piece):
            continue
        if piece and piece not in {"رمز", "نام وقف", "توضیح"}:
            out.append(piece)
    return out


def main() -> int:
    lines = MD.read_text(encoding="utf-8").splitlines()
    rows = []
    unknown = set()
    for line in lines:
        if not line.startswith("|") or line.startswith("|:"):
            continue
        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) < 5 or parts[0] in {"جزء", "رمز"}:
            continue
        surah_name = parts[1]
        sid = SURAH.get(surah_name)
        if not sid:
            unknown.add(surah_name)
            continue
        ayas = ayah_ids(parts[2])
        waqf = phrases(parts[3])
        ibtida = phrases(parts[4])
        if not ayas or (not waqf and not ibtida):
            continue
        for ayah in ayas:
            rows.append((f"{sid}:{ayah}", "|".join(waqf), "|".join(ibtida)))

    OUT.write_text(
        "# key\twaqf\tibtida\n" + "\n".join("\t".join(row) for row in rows) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(rows)} rows to {OUT}")
    if unknown:
        print("unknown surahs:", unknown)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
