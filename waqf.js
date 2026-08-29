/*
 * Waqf & Ibtida layer — pure logic, no DOM access (unit-tested in scripts/waqf.test.mjs).
 *
 * Base data: assets/data/waqf-signs.json, generated from the vendored Mushaf SVG
 * by scripts/build-waqf-data.py. Every printed pause mark of the Madinah Mushaf
 * is a standalone <g id="md-word-*"> whose text is only the mark, so each mark
 * is addressable as  surah:ayah + data-word-index-in-ayah.
 *
 * Optional data: assets/data/waqf-overrides.json — book-based rulings (for
 * example Manar al-Huda by al-Ushmuni) merged on top of the printed marks.
 * Schema is documented in assets/data/README.md.
 */

export const WAQF_KINDS = {
  lazim: {
    mark: "ۘ",
    glyph: "م",
    name: "وقف لازم",
    rule: "باید ایستاد؛ اگر بی‌درنگ به کلمهٔ بعد وصل شود، معنا به‌هم می‌خورد.",
    restart: "include-prev",
    pause: true,
  },
  jaiz: {
    mark: "ۚ",
    glyph: "ج",
    name: "وقف جائز",
    rule: "ایستادن و رد شدن یکسان است؛ معنا با هر دو درست می‌ماند.",
    restart: "next",
    pause: true,
  },
  qila: {
    mark: "ۗ",
    glyph: "قلی",
    name: "وقف اولی",
    rule: "ایستادن بهتر از رد شدن است (قِفْ اَولی).",
    restart: "next",
    pause: true,
  },
  sali: {
    mark: "ۖ",
    glyph: "صلی",
    name: "وصل اولی",
    rule: "رد شدن بهتر از ایستادن است (صِلْ اَولی)؛ اگر ایستادی، زود ادامه بده.",
    restart: "next",
    pause: true,
  },
  muanaqa: {
    mark: "ۛ",
    glyph: "ۛۛ",
    name: "معانقه (تعاوق)",
    rule: "فقط روی یکی از دو نشان بایست؛ نه هر دو و نه هیچ‌کدام.",
    restart: "next",
    pause: true,
  },
  hizb: {
    mark: "۞",
    glyph: "۞",
    name: "ربعِ حزب",
    rule: "نشانِ بخش‌بندی مصحف است، نه حکمِ وقف.",
    restart: "here",
    pause: false,
  },
  sajda: {
    mark: "۩",
    glyph: "۩",
    name: "سجدهٔ تلاوت",
    rule: "پس از این کلمه سجدهٔ تلاوت مستحب است.",
    restart: "next",
    pause: false,
  },
};

// Mark glyph -> kind, and the SVG's own data-waqf vocabulary -> kind.
const MARK_TO_KIND = new Map(Object.entries(WAQF_KINDS).map(([kind, meta]) => [meta.mark, kind]));

const SVG_WAQF_TO_KIND = {
  "waqf lazim": "lazim",
  "waqf jaiz": "jaiz",
  "waqf qila": "qila",
  "waqf sali": "sali",
  "waqf taanuq": "muanaqa",
};

const LETTER_RANGES = [
  [0x0621, 0x063a], [0x0641, 0x064a], [0x0671, 0x06d3], [0x06d5, 0x06d5], [0x06fa, 0x06fc],
];

/* A mark group holds no letters at all; every real word holds at least one. */
export function hasArabicLetter(text = "") {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (LETTER_RANGES.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

export function kindFromMark(mark = "") {
  return MARK_TO_KIND.get(mark) || null;
}

export function kindFromSvgWaqf(value = "") {
  return SVG_WAQF_TO_KIND[value] || null;
}

export function kindMeta(kind) {
  return WAQF_KINDS[kind] || null;
}

export function emptyIndex(meta = {}) {
  return { verseMarks: new Map(), verseIbtida: new Map(), meta };
}

/* dataset = parsed assets/data/waqf-signs.json */
export function buildIndex(dataset) {
  const index = emptyIndex(dataset?.meta || {});
  const marks = dataset?.marks;
  if (!marks) return index;

  for (const [verseKey, entries] of Object.entries(marks)) {
    index.verseMarks.set(
      verseKey,
      entries
        .map((entry) => ({ ...entry, verseKey, source: "mushaf" }))
        .sort((a, b) => a.word - b.word),
    );
  }
  return index;
}

/*
 * overrides = parsed assets/data/waqf-overrides.json:
 *   { waqf:   [ { verse, word, prev_word, type, ar, fa, reason, ibtida_word } ],
 *     ibtida: [ { verse, word, fa, note } ] }
 *
 * Every `word` value uses the Mushaf's own numbering (the `word` field of
 * waqf-signs.json, where a printed mark counts as a position). A waqf row may
 * name `prev_word` instead when the transcriber identified the word before the
 * pause rather than the pause itself.
 *
 * A row that matches a printed mark adds a verdict to it; a row that matches
 * nothing becomes its own entry, so book-only rulings still show up.
 */
export function mergeOverrides(index, overrides) {
  const merged = {
    verseMarks: new Map(index.verseMarks),
    verseIbtida: new Map(index.verseIbtida),
    meta: { ...index.meta, overrides: overrides?.meta || null },
  };

  for (const row of overrides?.waqf || []) {
    const verseKey = String(row.verse || "").trim();
    const word = Number.parseInt(row.word, 10);
    const prevWord = Number.parseInt(row.prev_word, 10);
    const anchored = Number.isInteger(word) || Number.isInteger(prevWord);
    if (!/^\d+:\d+$/.test(verseKey) || !anchored) continue;

    const verdict = {
      type: row.type || null,
      ar: row.ar || null,
      fa: row.fa || null,
      reason: row.reason || null,
      ibtidaWord: Number.isInteger(Number.parseInt(row.ibtida_word, 10))
        ? Number.parseInt(row.ibtida_word, 10)
        : null,
      source: overrides?.meta?.source || "override",
    };

    const entries = (merged.verseMarks.get(verseKey) || []).map((entry) => ({ ...entry }));
    // Exact anchor first; a prev_word that names no mark falls back to the mark
    // standing at that position, so a mis-numbered row cannot duplicate a mark.
    const match = entries.find((entry) => entry.word === word)
      || entries.find((entry) => entry.prev_word === prevWord)
      || (!Number.isInteger(word) ? entries.find((entry) => entry.word === prevWord) : null);
    if (match) {
      match.verdict = verdict;
    } else {
      entries.push({
        verseKey,
        word: Number.isInteger(word) ? word : prevWord,
        kind: verdict.type || "verdict",
        mark: null,
        source: "override",
        verdict,
      });
    }
    entries.sort((a, b) => a.word - b.word);
    merged.verseMarks.set(verseKey, entries);
  }

  for (const row of overrides?.ibtida || []) {
    const verseKey = String(row.verse || "").trim();
    const word = Number.parseInt(row.word, 10);
    if (!/^\d+:\d+$/.test(verseKey) || !Number.isInteger(word)) continue;

    const list = merged.verseIbtida.get(verseKey) || [];
    list.push({
      verseKey,
      word,
      fa: row.fa || "ابتدا",
      note: row.note || null,
      type: row.type || null,
      source: overrides?.meta?.source || "override",
    });
    merged.verseIbtida.set(verseKey, list.sort((a, b) => a.word - b.word));
  }

  return merged;
}

export function marksForVerse(index, verseKey) {
  return index?.verseMarks?.get(verseKey) || [];
}

export function ibtidaForVerse(index, verseKey) {
  return index?.verseIbtida?.get(verseKey) || [];
}

export function markAtWord(index, verseKey, wordIndex) {
  return marksForVerse(index, verseKey).find((entry) => entry.word === wordIndex) || null;
}

export function pairPartner(index, entry) {
  if (!entry?.pair_id) return null;
  return marksForVerse(index, entry.verseKey).find(
    (other) => other.pair_id === entry.pair_id && other !== entry,
  ) || null;
}

/*
 * Where to resume after stopping here.
 *   include-prev = repeat the preceding word so the meaning stays whole
 *   next         = continue with the following word
 *   here         = this point itself is the restart anchor
 */
export function ibtidaFor(index, entry) {
  if (!entry) return null;
  const meta = kindMeta(entry.kind) || { restart: "next", name: entry.kind };
  const verdict = entry.verdict;

  if (verdict?.ibtidaWord) {
    return {
      mode: "override",
      word: verdict.ibtidaWord,
      text: null,
      label: verdict.fa || verdict.type || "ابتدا",
      note: verdict.reason || null,
      source: verdict.source,
    };
  }

  if (meta.restart === "include-prev") {
    return {
      mode: "include-prev",
      word: entry.prev_word ?? null,
      text: entry.prev_text ?? null,
      label: "از همین کلمه (یا یک کلمه پیش‌تر) دوباره بخوان",
      note: null,
      source: entry.source,
    };
  }

  if (entry.kind === "muanaqa" && entry.pair === "a") {
    const partner = pairPartner(index, entry);
    return {
      mode: "next",
      word: partner?.next_word ?? null,
      text: partner?.next_text ?? null,
      label: "پس از ایستادن روی یکی از دو نشان، از اینجا ادامه بده",
      note: null,
      source: entry.source,
    };
  }

  return {
    mode: meta.restart,
    word: entry.next_word ?? null,
    text: entry.next_text ?? null,
    label: meta.pause ? "از کلمهٔ پس از نشان ادامه بده" : "از همین‌جا ادامه بده",
    note: null,
    source: entry.source,
  };
}

/*
 * Walk the SVG word groups in reading order and say what each one is:
 * a mark, or a word (optionally carrying the mark printed right after it).
 *
 * records: [{ id, verseKey, wordIndex, hafs, svgWaqf }]
 * returns: Map<id, { role, kind, entry, waqfAfter }>
 */
export function annotateWords(records, index) {
  const annotated = new Map();
  let lastWordId = null;

  for (const record of records) {
    const entry = markAtWord(index, record.verseKey, record.wordIndex);

    if (!hasArabicLetter(record.hafs)) {
      const kind = entry?.kind || kindFromMark(String(record.hafs).trim()) || kindFromSvgWaqf(record.svgWaqf);
      annotated.set(record.id, { role: "mark", kind, entry });
      // The mark belongs to the word before it, so that word reports it too.
      const previous = lastWordId ? annotated.get(lastWordId) : null;
      if (previous) previous.waqfAfter = { kind, entry };
      continue;
    }

    annotated.set(record.id, { role: "word", kind: null, entry: null, waqfAfter: null });
    lastWordId = record.id;
  }

  return annotated;
}

/* Inspector strip: everything a verse offers for stopping and restarting. */
export function describeVerse(index, verseKey) {
  return {
    marks: marksForVerse(index, verseKey),
    ibtida: ibtidaForVerse(index, verseKey),
  };
}

export function kindLegend() {
  return Object.entries(WAQF_KINDS).map(([kind, meta]) => ({ kind, ...meta }));
}
