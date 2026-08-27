# Shared Arabic normalization used by tests and the JSON builder.
import re
import unicodedata


def normalize_ar(value: str = "") -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = re.sub(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C-\u200F]", "", text)
    text = (
        text.replace("ٱ", "ا")
        .replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
        .replace("ة", "ه")
        .replace("ک", "ك")
        .replace("ی", "ي")
    )
    return re.sub(r"[^\u0621-\u063A\u0641-\u064A]", "", text)


def tokens(phrase: str) -> list[str]:
    out = []
    for part in (phrase or "").split():
        token = normalize_ar(part)
        if not token:
            continue
        if token.startswith("و") and len(token) > 2:
            out.append("و")
            out.append(token[1:])
        else:
            out.append(token)
    return out


def _fold(token: str) -> str:
    token = token.replace("ء", "").replace("ا", "")
    if token.startswith("و") and len(token) > 2:
        token = token[1:]
    return token


def _close(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b or a.endswith(b) or b.endswith(a):
        return True
    fa, fb = _fold(a), _fold(b)
    return fa == fb or fa.endswith(fb) or fb.endswith(fa)


def phrase_in_verse(phrase: str, verse: str) -> bool:
    needle = tokens(phrase)
    hay = tokens(verse)
    if not needle or not hay:
        return False
    n, h = len(needle), len(hay)
    for i in range(h - n + 1):
        if all(_close(hay[i + t], needle[t]) for t in range(n)):
            return True
    joined_h = "".join(_fold(t) for t in hay)
    joined_n = "".join(_fold(t) for t in needle)
    return bool(joined_n) and joined_n in joined_h
