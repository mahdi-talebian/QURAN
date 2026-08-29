/*
 * Unit tests for the waqf/ibtida layer (waqf.js) and the generated dataset.
 * Run: npm test   (node --test)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  WAQF_KINDS,
  annotateWords,
  buildIndex,
  hasArabicLetter,
  ibtidaFor,
  kindFromMark,
  kindFromSvgWaqf,
  markAtWord,
  marksForVerse,
  mergeOverrides,
  pairPartner,
} from "../waqf.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  readFileSync(join(here, "..", "assets", "data", "waqf-signs.json"), "utf-8"),
);
const index = buildIndex(dataset);
const OVERRIDE_SOURCE = "منار الهدی (نمونه)";

/* --- generated dataset: shape and totals ---------------------------------- */

test("dataset totals match the vendored SVG source", () => {
  const totals = Object.values(dataset.marks)
    .flat()
    .reduce((sum, entry) => ({ ...sum, [entry.kind]: (sum[entry.kind] || 0) + 1 }), {});

  assert.equal(Object.values(totals).reduce((a, b) => a + b, 0), 4486);
  assert.equal(Object.keys(dataset.marks).length, 2690);
  assert.deepEqual(totals, {
    jaiz: 2083,
    sali: 1651,
    qila: 511,
    hizb: 199,
    lazim: 21,
    sajda: 15,
    muanaqa: 6,
  });
  assert.deepEqual(dataset.meta.mark_counts, totals);
  assert.equal(dataset.meta.marks, 4486);
});

test("every entry is internally consistent", () => {
  for (const [verseKey, entries] of Object.entries(dataset.marks)) {
    assert.match(verseKey, /^\d+:\d+$/);
    for (const entry of entries) {
      assert.ok(entry.kind in WAQF_KINDS, `unknown kind ${entry.kind} in ${verseKey}`);
      assert.equal(entry.mark, WAQF_KINDS[entry.kind].mark, `wrong glyph in ${verseKey}`);
      assert.equal(kindFromMark(entry.mark), entry.kind);
      assert.match(entry.svg_id, /^md-word-\d{3}$/);
      assert.ok(entry.page >= 1 && entry.page <= 604);
      assert.ok(entry.line >= 1 && entry.line <= 15);
      assert.ok(Number.isInteger(entry.word) && entry.word >= 1);
      // A neighbour is either a real word of this verse or of an adjacent one.
      if (entry.prev_text) assert.ok(hasArabicLetter(entry.prev_text));
      if (entry.next_text) assert.ok(hasArabicLetter(entry.next_text));
      if (entry.prev_key) assert.match(entry.prev_key, /^\d+:\d+$/);
    }
    const words = entries.map((entry) => entry.word);
    assert.deepEqual(words, [...words].sort((a, b) => a - b), `${verseKey} is not in reading order`);
  }
});

/* --- lookups --------------------------------------------------------------- */

test("buildIndex keys marks by verse and sorts them", () => {
  const kursi = marksForVerse(index, "2:255");
  assert.equal(kursi.length, 8);
  assert.deepEqual(kursi.map((entry) => entry.word), [8, 15, 24, 32, 40, 50, 56, 61]);
  assert.equal(markAtWord(index, "2:255", 24).kind, "qila");
  assert.equal(markAtWord(index, "2:255", 9), null);
  assert.deepEqual(marksForVerse(index, "114:6"), []);
});

test("17:110 keeps the reading order across the verse boundary on page 293", () => {
  const sali = markAtWord(index, "17:110", 7);   // ۖ after ٱلرَّحۡمَٰنَ
  const sajda = markAtWord(index, "17:109", 8);  // ۩ after خُشُوعٗا
  assert.equal(sali.kind, "sali");
  assert.equal(sali.svg_id, "md-word-073");
  // The word before the ۖ is word 6 of 17:110, in the same verse — not the last
  // word of 17:109. Sorting by (line, index) used to interleave the two verses.
  assert.equal(sali.prev_word, 6);
  assert.equal(sali.prev_key, undefined);
  assert.notEqual(sali.prev_text, sajda.prev_text);
  assert.equal(sali.next_word, 8);

  assert.equal(sajda.kind, "sajda");
  assert.equal(sajda.svg_id, "md-word-065");
  assert.equal(sajda.prev_word, 7);
  assert.ok(hasArabicLetter(sajda.prev_text));
});

test("mu'anaqa halves share a pair id, including the two-word gap in 5:26", () => {
  const first = markAtWord(index, "2:2", 5);
  const partner = pairPartner(index, first);
  assert.equal(first.pair, "a");
  assert.equal(partner.pair, "b");
  assert.equal(first.pair_id, partner.pair_id);

  const wide = markAtWord(index, "5:26", 5);
  assert.equal(pairPartner(index, wide).word, 8);
  assert.equal(pairPartner(index, wide).prev_text, "سَنَةٗ");
});

test("ibtida resumes after the mark, but a lazim mark repeats its own word", () => {
  const jaiz = markAtWord(index, "17:110", 14);
  assert.deepEqual(
    { mode: ibtidaFor(index, jaiz).mode, word: ibtidaFor(index, jaiz).word, text: ibtidaFor(index, jaiz).text },
    { mode: "next", word: 15, text: "وَ" },
  );

  // 5:73 — وَلَا تَقُولُوا۟ ثَلَٰثَةٞ ۘ : stopping is obligatory.
  const lazim = markAtWord(index, "5:73", 9);
  assert.equal(lazim.kind, "lazim");
  const restart = ibtidaFor(index, lazim);
  assert.equal(restart.mode, "include-prev");
  assert.equal(restart.text, "ثَلَٰثَةٖ");

  // For the first half of a mu'anaqa the resume point is after the second half.
  const muanaqa = ibtidaFor(index, markAtWord(index, "2:2", 5));
  assert.equal(muanaqa.mode, "next");
  assert.equal(muanaqa.word, 8);
  assert.equal(muanaqa.text, "هُدٗى");
});

/* --- annotation ------------------------------------------------------------ */

test("annotateWords marks punctuation groups and tags the word before them", () => {
  // Page 293 lines 5-6, reduced to the groups around the sajda and the ۖ.
  const records = [
    { id: "md-word-064", verseKey: "17:109", wordIndex: 7, hafs: "خُشُوعٗا" },
    { id: "md-word-065", verseKey: "17:109", wordIndex: 8, hafs: "۩" },
    { id: "md-word-067", verseKey: "17:110", wordIndex: 1, hafs: "قُلِ" },
    { id: "md-word-072", verseKey: "17:110", wordIndex: 6, hafs: "ٱلرَّحۡمَٰنَ" },
    { id: "md-word-073", verseKey: "17:110", wordIndex: 7, hafs: "ۖ", svgWaqf: "waqf sali" },
    { id: "md-word-074", verseKey: "17:110", wordIndex: 8, hafs: "أَيّٗا" },
  ];

  const annotated = annotateWords(records, index);

  assert.equal(annotated.get("md-word-065").role, "mark");
  assert.equal(annotated.get("md-word-065").kind, "sajda");
  assert.equal(annotated.get("md-word-064").waqfAfter.kind, "sajda");

  assert.equal(annotated.get("md-word-073").role, "mark");
  assert.equal(annotated.get("md-word-073").kind, "sali");
  assert.equal(annotated.get("md-word-072").waqfAfter.kind, "sali");
  assert.equal(annotated.get("md-word-072").waqfAfter.entry, markAtWord(index, "17:110", 7));
  assert.equal(annotated.get("md-word-072").waqfAfter.entry.prev_word, 6);

  // A plain word with no mark after it stays clean.
  assert.equal(annotated.get("md-word-074").waqfAfter, null);
  assert.equal(annotated.get("md-word-067").role, "word");
});

test("annotateWords falls back to the SVG data-waqf vocabulary without the dataset", () => {
  const annotated = annotateWords(
    [
      { id: "md-word-001", verseKey: "2:11", wordIndex: 6, hafs: "مِّنكُمۡ" },
      { id: "md-word-002", verseKey: "2:11", wordIndex: 7, hafs: "ۚ", svgWaqf: "waqf jaiz" },
    ],
    buildIndex({ marks: {} }),
  );

  assert.equal(annotated.get("md-word-002").kind, "jaiz");
  assert.equal(annotated.get("md-word-001").waqfAfter.kind, "jaiz");
  assert.equal(annotated.get("md-word-001").waqfAfter.entry, null);
});

/* --- overrides (book-based rulings, e.g. Manar al-Huda) -------------------- */

test("mergeOverrides adds verdicts, book-only marks and ibtida points", () => {
  const overrides = {
    meta: { source: OVERRIDE_SOURCE },
    waqf: [
      { verse: "17:110", word: 7, type: "kafi", ar: "کاف", fa: "وقف کافی", reason: "تمام‌شدنِ جمله" },
      { verse: "1:5", word: 5, type: "tam", fa: "وقف تام", ibtida_word: 6 },
      { verse: "bad-key", word: 3, type: "tam" },
      { verse: "1:1", word: "x", type: "tam" },
    ],
    ibtida: [{ verse: "1:5", word: 6, fa: "ابتدای تام", note: "پس از وقف تام" }],
  };

  const merged = mergeOverrides(index, overrides);

  const verdict = markAtWord(merged, "17:110", 7);
  assert.equal(verdict.kind, "sali", "the printed mark keeps its own kind");
  assert.equal(verdict.verdict.fa, "وقف کافی");
  assert.equal(verdict.verdict.source, OVERRIDE_SOURCE);
  assert.equal(ibtidaFor(merged, verdict).mode, "next", "no ibtida_word => normal resume");

  const bookOnly = markAtWord(merged, "1:5", 5);
  assert.equal(bookOnly.source, "override");
  assert.equal(bookOnly.verdict.type, "tam");
  assert.equal(ibtidaFor(merged, bookOnly).word, 6);

  assert.equal(marksForVerse(merged, "bad-key").length, 0);
  assert.equal(marksForVerse(merged, "1:1").length, 0);

  const ibtida = merged.verseIbtida.get("1:5");
  assert.equal(ibtida.length, 1);
  assert.equal(ibtida[0].fa, "ابتدای تام");

  // The base index is not mutated.
  assert.equal(markAtWord(index, "17:110", 7).verdict, undefined);
  assert.equal(index.verseIbtida.size, 0);
});

test("mergeOverrides tolerates a missing overrides file", () => {
  const merged = mergeOverrides(index, null);
  assert.equal(marksForVerse(merged, "2:2").length, 2);
  assert.equal(merged.meta.overrides, null);
});

/* --- override matching by prev_word + the shipped example file ------------- */

test("mergeOverrides can anchor a ruling on the word before the pause", () => {
  const merged = mergeOverrides(index, {
    meta: { source: "نمونه" },
    waqf: [{ verse: "5:73", prev_word: 8, type: "lazim", fa: "وقف لازم", ibtida_word: 9 }],
  });

  const lazim = markAtWord(merged, "5:73", 9);
  assert.equal(lazim.source, "mushaf");
  assert.equal(lazim.verdict.fa, "وقف لازم");

  const restart = ibtidaFor(merged, lazim);
  assert.equal(restart.mode, "override");
  assert.equal(restart.word, 9);
});

test("the shipped overrides example merges into the real dataset", () => {
  const example = JSON.parse(
    readFileSync(join(here, "..", "assets", "data", "waqf-overrides.example.json"), "utf-8"),
  );
  const merged = mergeOverrides(index, example);

  // Every waqf row of the example lands on a printed mark of the same verse.
  for (const row of example.waqf) {
    const entry = marksForVerse(merged, row.verse).find((item) => item.verdict?.fa);
    assert.ok(entry, `${row.verse}: example ruling matched nothing`);
    assert.equal(entry.source, "mushaf");
  }

  assert.equal(markAtWord(merged, "17:110", 7).verdict.fa, "وصل اولی");
  assert.equal(markAtWord(merged, "5:73", 9).verdict.ar, "م");
  assert.equal(markAtWord(merged, "2:2", 5).verdict.type, "muanaqa");
  assert.equal(merged.verseIbtida.get("1:1")[0].type, "tam");
});

/* --- UI wiring: app.js must not query ids that index.html does not declare -- */

test("every element id used by app.js exists in index.html", () => {
  const app = readFileSync(join(here, "..", "app.js"), "utf-8");
  const html = readFileSync(join(here, "..", "index.html"), "utf-8");
  const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));

  const used = [...app.matchAll(/querySelector\("#([a-z0-9-]+)"\)/g)].map((match) => match[1]);
  assert.ok(used.length > 20, `expected the full ui map, found ${used.length} selectors`);

  const missing = used.filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], "index.html is missing these ids");

  // The waqf UI in particular is what this change adds.
  for (const id of [
    "toggle-waqf", "waqf-panel", "waqf-badge", "waqf-name", "waqf-rule", "waqf-verdict",
    "waqf-ibtida", "waqf-ibtida-text", "waqf-ibtida-note", "waqf-strip", "waqf-strip-label",
    "waqf-legend", "waqf-legend-grid", "waqf-status",
  ]) {
    assert.ok(used.includes(id), `app.js no longer wires #${id}`);
    assert.ok(declared.has(id), `index.html no longer declares #${id}`);
  }
});

test("a mis-numbered prev_word still lands on the mark instead of duplicating it", () => {
  const merged = mergeOverrides(index, {
    waqf: [{ verse: "5:73", prev_word: 9, type: "lazim", fa: "وقف لازم" }],
  });

  const marks = marksForVerse(merged, "5:73");
  assert.equal(marks.length, 2, "the verse has a lazim and a jaiz mark; neither may be duplicated");
  assert.deepEqual(marks.map((entry) => entry.word), [9, 17]);
  assert.ok(marks.every((entry) => entry.source === "mushaf"), "no book-only entry was created");
  assert.equal(markAtWord(merged, "5:73", 9).verdict.fa, "وقف لازم");
  assert.equal(markAtWord(merged, "5:73", 17).verdict, undefined);
});
