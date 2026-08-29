# Shared Arabic normalization used by tests and the JSON builder.
import re
import unicodedata


def normalize_ar(value: str = "") -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = (
        text.replace("\u06e5", "و")  # small high waw: داوۥد
        .replace("\u06e6", "و")
        .replace("\u06e7", "ي")  # small high yeh: ابرٰهۧم / النبيۧن
    )
    text = re.sub(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06E4\u06E8-\u06ED\u0640\u200C-\u200F]", "", text)
    text = (
        text.replace("ٱ", "ا")
        .replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
        .replace("ء", "")
        .replace("ة", "ه")
        .replace("ک", "ك")
        .replace("ی", "ي")
    )
    text = re.sub(r"[^\u0621-\u063A\u0641-\u064A]", "", text)
    text = re.sub(r"ي+", "ي", text)
    text = re.sub(r"و+", "و", text)
    return text


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
    token = token.replace("ا", "").replace("ي", "").replace("و", "")
    return token


def _close(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b or a.endswith(b) or b.endswith(a):
        return True
    fa, fb = _fold(a), _fold(b)
    if not fa or not fb:
        return a[-2:] == b[-2:] if len(a) >= 2 and len(b) >= 2 else False
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
    if joined_n and joined_n in joined_h:
        return True
    # Last content word is enough for waqf/ibtida labels that omit particles.
    last = next((t for t in reversed(needle) if t != "و" and len(_fold(t)) >= 2), None)
    if last:
        return any(_close(h, last) for h in hay)
    return False
