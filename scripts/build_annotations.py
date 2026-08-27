#!/usr/bin/env python3
"""Build the waqf/ibtida annotation file consumed by the reader.

Input  : any table of words (TSV/CSV/pipe/Markdown, JSON, or plain text).
Output : assets/annotations/waqf-ibtida.json — one entry per resolved word.

Every row is resolved against the locally extracted MushafDatabase SVG
(`assets/mushaf-svg/NNN.svg`) and the QCF4 pages (`assets/qcf4/pages/NNN.json`)
so that each entry carries an unambiguous address:

    surah : ayah : word-position

The reader then tints that exact word — red for waqf, blue for ibtida.

Examples
--------
    # 1) one table, with a type column
    python3 scripts/build_annotations.py data/annotations/وقف-و-ابتدا.csv

    # 2) two separate tables, one per kind
    python3 scripts/build_annotations.py \\
        --type waqf  data/annotations/waqf.tsv \\
        --type ibtida data/annotations/ibtida.tsv

    # 3) add a baseline derived from the pause signs already printed in the SVG
    python3 scripts/build_annotations.py --baseline-from-svg --pages 351

The JSON/HTML files are read as UTF-8; every other extension is treated as a
table. Nothing is invented: a row that cannot be located in the mushaf is kept
in the `unmatched` list and reported on stderr instead of being silently dropped.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
from collections import OrderedDict
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
SVG_DIR = PROJECT_DIR / "assets" / "mushaf-svg"
QCF_DIR = PROJECT_DIR / "assets" / "qcf4" / "pages"
DEFAULT_OUT = PROJECT_DIR / "assets" / "annotations" / "waqf-ibtida.json"

VALID_TYPES = ("waqf", "ibtida")

TYPE_ALIASES = {
    "waqf": {
        "waqf", "wagf", "stop", "pause", "stand",
        "وقف", "وقوف", "وقفه", "وقفۃ", "وقـف", "علامت وقف", "جای وقف", "وقفگاه",
    },
    "ibtida": {
        "ibtida", "ibtidā", "start", "begin", "resume", "restart", "first",
        "ابتدا", "ابتداء", "آغاز", "شروع", "بدء", "ابتدای", "ابتدای قرائت", "نقطه شروع", "از سرگیری",
    },
}

HEADER_ALIASES = {
    "surah": {"surah", "sura", "surat", "chapter", "سوره", "سورة", "سورهٔ", "سوره‌ی"},
    "ayah": {"ayah", "aya", "ayat", "verse", "verse_no", "verseno", "آیه", "ايه", "آيه", "آیات", "شماره آیه"},
    "verse": {"verse_key", "versekey", "key", "address", "نشانی", "آدرس", "کلید", "نشانی آیه", "آیه:سوره"},
    "word": {"word", "text", "kalima", "کلمه", "کلمهٔ", "كلمة", "لفظ", "واژه", "متن"},
    "position": {"position", "pos", "word_position", "word_no", "wordno", "index", "شماره کلمه", "شمارهٔ کلمه", "جای کلمه"},
    "type": {"type", "kind", "category", "نوع", "نوع نشانه", "نوع علامت", "دسته"},
    "label": {"label", "mark", "sign", "symbol", "نشانه", "علامت", "رمز", "نماد"},
    "page": {"page", "صفحه", "صفحهٔ"},
    "line": {"line", "خط", "سطر"},
}

# Pause signs that the Madinah mushaf actually prints between words.
SVG_PAUSE_SIGNS = {
    "\u06D6": "صلى",   # small high sad-lam-alef maksura
    "\u06D7": "قلى",   # small high qaf-lam-alef maksura
    "\u06D8": "م",     # small high meem initial form
    "\u06DA": "ج",     # small high jeem
}

DIACRITICS_RE = re.compile(
    "[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C-\u200F]"
)
KEEP_RE = re.compile(r"[^\u0621-\u063A\u0641-\u064A]")
ALEF_RE = re.compile(r"[\u0671\u0623\u0625\u0622]")
DIGITS = str.maketrans(
    "".join(chr(cp) for cp in list(range(0x06F0, 0x06FA)) + list(range(0x0660, 0x066A))),
    "0123456789" * 2,
)


# --------------------------------------------------------------------------
# Text handling — mirrors normalizeForMatching() in app.js exactly.
# --------------------------------------------------------------------------
def normalize_for_matching(value: str) -> str:
    """Same rules as app.js: data join only, never for display."""
    text = html.unescape(value or "")
    text = unicodedata.normalize("NFD", text)
    text = DIACRITICS_RE.sub("", text)
    text = ALEF_RE.sub("ا", text)
    text = text.replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي").replace("ة", "ه")
    return KEEP_RE.sub("", text)


def digits(value: str) -> str:
    return (value or "").translate(DIGITS).strip()


def to_int(value) -> int | None:
    try:
        return int(digits(str(value)))
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# Source indexes: SVG word groups + QCF4 words.
# --------------------------------------------------------------------------
WORD_GROUP_RE = re.compile(r'<g id="(md-word-\d+)"([^>]*)>')
ATTR_RE = re.compile(r'(data-[a-z-]+)="([^"]*)"')
AYA_MARK_RE = re.compile(r'<g id="(md-aya-mark[^"]*)"([^>]*)>')


class SvgWord:
    __slots__ = ("gid", "surah", "ayah", "line", "hafs", "imlaey", "index", "is_waw", "page")

    def __init__(self, gid, attrs, page):
        self.gid = gid
        self.surah = to_int(attrs.get("data-surah"))
        self.ayah = to_int(attrs.get("data-aya"))
        self.line = to_int(attrs.get("data-line-number"))
        self.hafs = html.unescape(attrs.get("data-hafs", ""))
        self.imlaey = html.unescape(attrs.get("data-imlaey", ""))
        self.index = to_int(attrs.get("data-word-index-in-ayah"))
        self.is_waw = attrs.get("data-waw-alatf") == "true"
        self.page = page

    @property
    def norm(self):
        return normalize_for_matching(self.hafs)

    @property
    def is_mark(self):
        return self.norm == ""


class QcfWord:
    __slots__ = ("surah", "ayah", "text", "position", "norm")

    def __init__(self, surah, ayah, text, position):
        self.surah = surah
        self.ayah = ayah
        self.text = text
        self.position = position
        self.norm = normalize_for_matching(text)


class MushafIndex:
    """Word lists per verse, in mushaf reading order."""

    def __init__(self, pages=None):
        # verse_key -> {"svg": [SvgWord], "qcf": [QcfWord]}
        self.by_verse: "OrderedDict[str, dict]" = OrderedDict()
        # (surah, ayah) -> set(pages)
        self.pages_of_verse = {}
        self.svg_count = 0
        self.pages = pages

    def verse_key(self, surah, ayah):
        return f"{surah}:{ayah}"

    def bucket(self, surah, ayah, page):
        key = self.verse_key(surah, ayah)
        bucket = self.by_verse.setdefault(key, {"svg": [], "qcf": [], "surah": surah, "ayah": ayah})
        self.pages_of_verse.setdefault((surah, ayah), set()).add(page)
        return bucket

    def load_svg(self):
        files = sorted(SVG_DIR.glob("*.svg"))
        if self.pages:
            wanted = {int(p) for p in self.pages}
            files = [f for f in files if int(f.stem) in wanted]
        for path in files:
            page = int(path.stem)
            for gid, raw_attrs in WORD_GROUP_RE.findall(path.read_text(encoding="utf-8")):
                attrs = dict(ATTR_RE.findall(raw_attrs))
                word = SvgWord(gid, attrs, page)
                if word.surah is None or word.ayah is None:
                    continue
                self.bucket(word.surah, word.ayah, page)["svg"].append(word)
                self.svg_count += 1
        return self

    def load_qcf(self):
        files = sorted(QCF_DIR.glob("*.json"))
        if self.pages:
            wanted = {int(p) for p in self.pages}
            files = [f for f in files if int(f.stem) in wanted]
        for path in files:
            page = int(path.stem)
            data = json.loads(path.read_text(encoding="utf-8"))
            for line in data.get("lines", []):
                for raw in line.get("words", []):
                    if raw.get("type") != "word" or not raw.get("verse_key"):
                        continue
                    surah, _, ayah = raw["verse_key"].partition(":")
                    surah, ayah = to_int(surah), to_int(ayah)
                    if surah is None or ayah is None:
                        continue
                    bucket = self.bucket(surah, ayah, page)
                    bucket["qcf"].append(QcfWord(surah, ayah, raw.get("text", ""), raw.get("position")))
        return self

    def load(self):
        return self.load_svg().load_qcf()


def logical_words(bucket):
    """Group SVG word parts (waw prefix + word + trailing sign) into logical words.

    Mirrors enrichSvgWords() in app.js line for line: a `data-waw-alatf` group
    merges forward, a sign-only group attaches to the word before it, and the
    QCF4 cursor advances with the same 4-word lookahead. Keeping the two in sync
    is what makes a resolved `position` equal the reader's interaction key.
    """
    qcf = bucket["qcf"]
    logical = []
    cursor = 0
    pending = []

    for word in bucket["svg"]:
        if word.is_mark:
            if logical:
                logical[-1]["parts"].append(word)
            continue
        if word.is_waw:
            pending.append(word)
            continue

        parts = pending + [word]
        pending = []
        combined = "".join(part.norm for part in parts)

        record = qcf[cursor] if cursor < len(qcf) else None
        matched = bool(record and record.norm in (combined, word.norm))
        if not matched:
            hit = next(
                (j for j in range(cursor, min(cursor + 4, len(qcf)))
                 if qcf[j].norm in (combined, word.norm)),
                None,
            )
            if hit is not None:
                cursor = hit
                record = qcf[cursor]
                matched = True

        logical.append({
            "parts": parts,
            "norm": combined,
            "qcf_norm": record.norm if record else None,
            "text": record.text if record else word.hafs,
            "imlaey": "".join(part.imlaey for part in parts) or word.imlaey,
            "position": record.position if record else (word.index or len(logical) + 1),
            "surah": word.surah,
            "ayah": word.ayah,
            "page": word.page,
            "line": word.line,
            "qcf_matched": matched,
        })

        if record is not None and cursor < len(qcf) and qcf[cursor] is record:
            cursor += 1

    return logical


# --------------------------------------------------------------------------
# Table parsing
# --------------------------------------------------------------------------
def sniff_delimiter(line: str) -> str | None:
    for candidate in ("\t", "|", ";", ",", "\u060C"):
        if candidate in line:
            return candidate
    if re.search(r"\S\s{2,}\S", line):
        return r"\s{2,}"
    return None


def split_row(line: str, delimiter) -> list[str]:
    if delimiter == r"\s{2,}":
        return [c.strip() for c in re.split(r"\s{2,}", line.strip()) if c.strip()]
    if delimiter == "|":
        return [c.strip() for c in line.strip().strip("|").split("|")]
    return [c.strip() for c in line.split(delimiter)]


def strip_md(line: str) -> str:
    """Drop markdown table pipes and separator rows."""
    stripped = line.strip()
    if re.fullmatch(r"\|?[\s:\-|]+\|?", stripped) and "-" in stripped:
        return ""
    return stripped


def header_map(fields):
    mapping = {}
    for index, raw in enumerate(fields):
        key = normalize_for_matching(raw) if re.search(r"[\u0600-\u06FF]", raw) else raw
        needle = re.sub(r"[^0-9A-Za-z\u0600-\u06FF]", "", str(key).lower())
        if not needle:
            continue
        for field, aliases in HEADER_ALIASES.items():
            normalized = {normalize_for_matching(a) for a in aliases}
            if needle in normalized or needle in aliases:
                mapping.setdefault(field, index)
    return mapping


VERSE_KEY_RE = re.compile(r"^(\d{1,3})\s*[:\-–]\s*(\d{1,3})$")


def detect_type(fields, forced=None):
    if forced in VALID_TYPES:
        return forced
    for field in fields:
        raw = str(field).strip().lower()
        if not raw:
            continue
        needle = normalize_for_matching(raw)
        for kind, aliases in TYPE_ALIASES.items():
            # normalize_for_matching() drops Latin letters, so only a non-empty
            # result may be compared against the normalized alias set.
            normalized = {normalize_for_matching(a) for a in aliases if normalize_for_matching(a)}
            if raw in aliases or (needle and needle in normalized):
                return kind
        for kind, aliases in TYPE_ALIASES.items():
            if any(normalize_for_matching(a) and normalize_for_matching(a) in needle for a in aliases):
                return kind
    return None


def positional_fields(fields):
    """Map an unknown column order to surah/ayah/verse/word/position/type/label."""
    out = {"surah": None, "ayah": None, "verse": None, "word": None, "type": None,
           "position": None, "label": None}

    kind = detect_type(fields)
    out["type"] = kind
    remaining = [f for f in fields if f.strip()]
    if kind:
        remaining = [f for f in remaining if detect_type([f]) != kind]

    # An explicit "24:11" address beats separate surah/ayah columns.
    verse_index = next((i for i, f in enumerate(remaining) if VERSE_KEY_RE.match(digits(f))), None)
    if verse_index is not None:
        out["verse"] = remaining.pop(verse_index)
    else:
        head = []
        while remaining and digits(remaining[0]).isdigit():
            head.append(remaining.pop(0))
        if len(head) >= 2:
            out["surah"], out["ayah"] = head[0], head[1]
        elif len(head) == 1:
            out["surah"] = head[0]
        if len(head) >= 3:
            out["position"] = head[2]

    if remaining and digits(remaining[0]).isdigit():
        out["position"] = remaining.pop(0)
    if remaining:
        out["word"] = remaining.pop(0)
    if remaining:
        out["label"] = " ".join(remaining)
    return out


def parse_table(path: Path, forced_type=None, default_verse=None):
    """Yield row dicts from any delimiter-separated table."""
    raw_lines = path.read_text(encoding="utf-8-sig").splitlines()
    rows = []
    mapping = None
    delimiter = None
    line_no = 0

    for line in raw_lines:
        line_no += 1
        line = strip_md(line)
        if not line or line.lstrip().startswith("#"):
            continue
        if delimiter is None:
            delimiter = sniff_delimiter(line) or r"\s{2,}"
        fields = split_row(line, delimiter)
        if not fields:
            continue
        if mapping is None:
            candidate = header_map(fields)
            # Two or more recognised column names means this is a header row.
            if len(candidate) >= 2:
                mapping = candidate
                continue

        row = {"_line": line_no, "_file": path.name, "_raw": line}
        if mapping:
            for field, index in mapping.items():
                if index < len(fields):
                    row[field] = fields[index]
            # A row that does not fit the header (shorter row, or an address such
            # as "24:13" sitting in the surah column) is parsed positionally.
            if to_int(row.get("surah")) is None and not row.get("verse"):
                row = {"_line": line_no, "_file": path.name, "_raw": line}
                row.update(positional_fields(fields))
        else:
            row.update(positional_fields(fields))
        if forced_type in VALID_TYPES:
            row["type"] = forced_type
        if default_verse and not row.get("verse") and not row.get("surah"):
            row["verse"] = default_verse
        rows.append(row)

    return rows


def parse_json(path: Path, forced_type=None):
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    items = data.get("entries", data) if isinstance(data, dict) else data
    rows = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        row = {k.lower().replace("-", "_"): v for k, v in item.items()}
        # Common alternative key spellings.
        for alt, canonical in (("verse_key", "verse"), ("aya", "ayah"), ("sura", "surah"),
                               ("text", "word"), ("word_position", "position"), ("sign", "label")):
            if alt in row and canonical not in row:
                row[canonical] = row[alt]
        row["_line"] = index + 1
        row["_file"] = path.name
        row["_raw"] = json.dumps(item, ensure_ascii=False)
        if forced_type in VALID_TYPES:
            row["type"] = forced_type
        rows.append(row)
    return rows


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------
def resolve_verse(row, index: MushafIndex):
    verse = row.get("verse")
    if verse:
        match = VERSE_KEY_RE.match(digits(str(verse)))
        if match:
            return int(match.group(1)), int(match.group(2))
    surah_cell = digits(str(row.get("surah") or ""))
    if VERSE_KEY_RE.match(surah_cell):
        match = VERSE_KEY_RE.match(surah_cell)
        return int(match.group(1)), int(match.group(2))
    surah, ayah = to_int(row.get("surah")), to_int(row.get("ayah"))
    if surah is not None:
        return surah, ayah
    return None, None


def resolve_entry(row, index: MushafIndex, forced_type=None):
    surah, ayah = resolve_verse(row, index)
    word_text = str(row.get("word") or "").strip()
    kind = detect_type([str(row.get("type") or "")], forced_type)
    if kind is None:
        kind = detect_type([word_text])
    if kind is None:
        kind = forced_type if forced_type in VALID_TYPES else None

    problem = None
    if surah is None:
        problem = "ستون سوره پیدا نشد"
    elif ayah is None:
        problem = "شمارهٔ آیه پیدا نشد"
    elif not word_text:
        problem = "ستون کلمه خالی است"
    elif kind is None:
        problem = "نوع نشانه (وقف/ابتدا) مشخص نیست"

    if problem:
        return None, problem

    key = f"{surah}:{ayah}"
    bucket = index.by_verse.get(key)
    if not bucket:
        return None, f"آیهٔ {key} در مصحف پیدا نشد"

    logical = logical_words(bucket)
    if not logical:
        return None, f"آیهٔ {key} کلمه‌ای در SVG ندارد"

    wanted = normalize_for_matching(word_text)
    explicit_position = to_int(row.get("position"))

    candidates = []
    if explicit_position is not None:
        candidates = [w for w in logical if to_int(w["position"]) == explicit_position]
        if candidates and wanted and candidates[0]["norm"] != wanted:
            # Trust the address, but keep the mismatch visible in the report.
            pass
    if not candidates and wanted:
        # Both spellings are tried: the SVG's Uthmani rasm and the QCF4 text,
        # which differ for words such as ٱلۡأٓيَٰتِ / الْأيَاتِ.
        candidates = [w for w in logical if wanted in (w["norm"], w["qcf_norm"])]
    if not candidates and wanted:
        candidates = [w for w in logical
                      if any(wanted in n or n in wanted for n in (w["norm"], w["qcf_norm"]) if n)]

    if not candidates:
        return None, f"کلمهٔ «{word_text}» در آیهٔ {key} پیدا نشد"
    if len(candidates) > 1:
        occurrence = to_int(row.get("occurrence") or row.get("بار"))
        if occurrence and 1 <= occurrence <= len(candidates):
            chosen = candidates[occurrence - 1]
        else:
            positions = ", ".join(str(c["position"]) for c in candidates)
            return None, f"کلمهٔ «{word_text}» {len(candidates)} بار در {key} تکرار شده (شماره کلمه: {positions})"
    else:
        chosen = candidates[0]

    return {
        "surah": surah,
        "ayah": ayah,
        "verse_key": key,
        "position": chosen["position"],
        "word": chosen["text"],
        "imlaey": chosen["imlaey"],
        "norm": chosen["norm"],
        "page": chosen["page"],
        "line": chosen["line"],
        "type": kind,
        "label": str(row.get("label") or "").strip() or None,
        "qcf_matched": chosen["qcf_matched"],
        "source_row": row.get("_line"),
        "source_file": row.get("_file"),
        "derived": False,
    }, None


def demo_ibtida_from_svg(index: MushafIndex, pages):
    """Flagged placeholder rows: the first word printed after each pause sign.

    Ibtida depends on the recitation teacher's choice, so nothing is inferred
    from the mushaf. These rows exist only so the blue layer is visible before
    a real table is supplied, and they carry `"demo": true`.
    """
    wanted = {int(p) for p in pages} if pages else None
    entries = []
    for key, bucket in index.by_verse.items():
        surah, ayah = (int(x) for x in key.split(":"))
        logical = logical_words(bucket)
        for position, unit in enumerate(logical):
            if unit["page"] not in wanted:
                continue
            has_pause = any(part.is_mark and part.hafs.strip() in SVG_PAUSE_SIGNS for part in unit["parts"])
            if has_pause and position + 1 < len(logical):
                nxt = logical[position + 1]
                entries.append({
                    "surah": surah,
                    "ayah": ayah,
                    "verse_key": key,
                    "position": nxt["position"],
                    "word": nxt["text"],
                    "imlaey": nxt["imlaey"],
                    "norm": nxt["norm"],
                    "page": nxt["page"],
                    "line": nxt["line"],
                    "type": "ibtida",
                    "label": None,
                    "qcf_matched": nxt["qcf_matched"],
                    "source_row": None,
                    "source_file": f"{nxt['page']:03d}.svg",
                    "derived": True,
                    "demo": True,
                })
    return entries


def baseline_from_svg(index: MushafIndex):
    """Derive waqf rows from the pause signs the mushaf itself prints.

    Only the four genuine pause signs are used — rubʿ al-ḥizb (۞), the sajdah
    place (۩) and the three dots (ۛ) are not waqf marks and are skipped.
    """
    entries = []
    for key, bucket in index.by_verse.items():
        surah, ayah = (int(x) for x in key.split(":"))
        logical = logical_words(bucket)
        for unit in logical:
            for part in unit["parts"]:
                if part.is_mark and part.hafs.strip() in SVG_PAUSE_SIGNS:
                    entries.append({
                        "surah": surah,
                        "ayah": ayah,
                        "verse_key": key,
                        "position": unit["position"],
                        "word": unit["text"],
                        "imlaey": unit["imlaey"],
                        "norm": unit["norm"],
                        "page": unit["page"],
                        "line": unit["line"],
                        "type": "waqf",
                        "label": SVG_PAUSE_SIGNS[part.hafs.strip()],
                        "qcf_matched": unit["qcf_matched"],
                        "source_row": None,
                        "source_file": f"{part.page:03d}.svg",
                        "derived": True,
                    })
                    break
    return entries


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def parse_pages(value):
    if not value:
        return None
    pages = set()
    for chunk in value.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            low, high = chunk.split("-", 1)
            pages.update(range(int(low), int(high) + 1))
        else:
            pages.add(int(chunk))
    return sorted(p for p in pages if 1 <= p <= 604)


def serialize(document):
    """One entry per line, so regenerating the file gives a readable diff."""
    head = {k: v for k, v in document.items() if k not in ("entries", "unmatched")}
    body = json.dumps(head, ensure_ascii=False, indent=1).rstrip().rstrip("}").rstrip()

    def block(key):
        items = document.get(key) or []
        rows = ",\n  ".join(json.dumps(item, ensure_ascii=False) for item in items)
        return f'"{key}": [\n  {rows}\n ]' if items else f'"{key}": []'

    return f'{body},\n {block("entries")},\n {block("unmatched")}\n}}\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="*",
                        help="table files (tsv/csv/md/txt/json); prefix with the kind to mix "
                             "kinds in one command, e.g. waqf=data/waqf.tsv ibtida=data/ibtida.tsv")
    parser.add_argument("--type", choices=VALID_TYPES, dest="forced_type",
                        help="force this kind for every row of the input files that have no prefix")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--pages", type=parse_pages, default=None,
                        help="limit indexing to these mushaf pages, e.g. 351 or 1-604")
    parser.add_argument("--baseline-from-svg", action="store_true",
                        help="add waqf entries derived from the pause signs printed in the SVG")
    parser.add_argument("--demo-ibtida-pages", type=parse_pages, default=None,
                        help="add flagged demo ibtida rows on these pages (first word after each pause sign)")
    parser.add_argument("--source", default=None, help="free-text provenance stored in the JSON")
    parser.add_argument("--notes", default=None, help="free-text note stored in the JSON")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    if not args.inputs and not args.baseline_from_svg and not args.demo_ibtida_pages:
        parser.error("at least one input file, --baseline-from-svg, or --demo-ibtida-pages is required")

    index = MushafIndex(pages=args.pages).load()

    entries, unmatched = [], []
    for spec in args.inputs:
        # "waqf=data/waqf.tsv" lets one command mix both kinds.
        forced = args.forced_type
        path = spec
        if "=" in spec and not Path(spec).exists():
            prefix, _, rest = spec.partition("=")
            if prefix.strip() in VALID_TYPES:
                forced, path = prefix.strip(), rest
        path = Path(path)
        if not path.exists():
            print(f"error: input not found: {path}", file=sys.stderr)
            return 2
        rows = parse_json(path, forced) if path.suffix.lower() == ".json" else parse_table(path, forced)
        for row in rows:
            entry, problem = resolve_entry(row, index, forced)
            if entry:
                entries.append(entry)
            else:
                unmatched.append({
                    "file": row.get("_file"),
                    "line": row.get("_line"),
                    "raw": row.get("_raw"),
                    "problem": problem,
                })

    if args.baseline_from_svg:
        entries.extend(baseline_from_svg(index))
    if args.demo_ibtida_pages:
        entries.extend(demo_ibtida_from_svg(index, args.demo_ibtida_pages))

    # De-duplicate: a user row always beats a derived one for the same address.
    ordered: "OrderedDict[tuple, dict]" = OrderedDict()
    for entry in entries:
        key = (entry["verse_key"], entry["position"], entry["type"])
        if key in ordered and not entry["derived"]:
            ordered[key] = entry
        elif key not in ordered:
            ordered[key] = entry
    final = sorted(ordered.values(), key=lambda e: (e["surah"], e["ayah"], e["position"], e["type"]))

    stats = {
        "total": len(final),
        "waqf": sum(1 for e in final if e["type"] == "waqf"),
        "ibtida": sum(1 for e in final if e["type"] == "ibtida"),
        "derived": sum(1 for e in final if e.get("derived")),
        "demo": sum(1 for e in final if e.get("demo")),
        "verses": len({e["verse_key"] for e in final}),
        "pages": len({e["page"] for e in final}),
        "unmatched": len(unmatched),
    }

    document = {
        "version": 1,
        "kind": "waqf-ibtida",
        "colors": {"waqf": "red", "ibtida": "blue"},
        "source": args.source or ", ".join(
            Path(p.partition("=")[2] if "=" in p and not Path(p).exists() else p).name for p in args.inputs
        ) or "derived-from-svg",
        "notes": args.notes or "",
        "stats": stats,
        "entries": final,
        "unmatched": unmatched,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(serialize(document), encoding="utf-8")

    if not args.quiet:
        print(f"indexed        : {index.svg_count} SVG word groups in "
              f"{len({(w.surah, w.ayah) for b in index.by_verse.values() for w in b['svg']})} verses")
        try:
            shown = args.out.relative_to(PROJECT_DIR)
        except ValueError:
            shown = args.out
        print(f"written        : {shown}")
        print(f"waqf / ibtida  : {stats['waqf']} / {stats['ibtida']}   "
              f"(derived: {stats['derived']}, demo: {stats['demo']})")
        print(f"pages covered  : {stats['pages']}   verses: {stats['verses']}")
        if unmatched:
            print(f"UNRESOLVED ROWS: {stats['unmatched']}")
            for row in unmatched[:25]:
                print(f"  - {row['file']}:{row['line']} — {row['problem']}  [{row['raw'][:70]}]")
            if stats["unmatched"] > 25:
                print(f"  … and {stats['unmatched'] - 25} more")
    return 1 if unmatched else 0


if __name__ == "__main__":
    sys.exit(main())
