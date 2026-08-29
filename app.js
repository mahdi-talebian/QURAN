/*
 * Mushaf Touch — proof of concept
 *
 * Render source: MushafDatabase SVG (visual authority)
 * Metadata source: QCF4 JSON (interaction/enrichment layer)
 *
 * Important: QCF4 glyphs/fonts are deliberately NOT drawn on top of the SVG.
 * The SVG keeps the printed Madinah page visually faithful; QCF4 enriches it.
 */

import {
  annotateWords,
  buildIndex,
  describeVerse,
  ibtidaFor,
  kindLegend,
  kindMeta,
  mergeOverrides,
} from "./waqf.js";

const VALID_ASSET_MODES = new Set(["local", "remote", "auto"]);
const requestedAssetMode = window.MUSHAF_ASSET_MODE || "auto";
const ASSET_MODE = VALID_ASSET_MODES.has(requestedAssetMode) ? requestedAssetMode : "auto";
const LOCAL_ASSET_ROOT = new URL("./assets/", import.meta.url).href.replace(/\/$/, "");

// import.meta.url keeps local asset paths correct even when deployed under a sub-path.
const SOURCES = {
  local: {
    svg: `${LOCAL_ASSET_ROOT}/mushaf-svg`,
    qcf: `${LOCAL_ASSET_ROOT}/qcf4/pages`,
  },
  remote: {
    svg: "https://raw.githubusercontent.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/main/SVG%20V1.01",
    qcf: "https://raw.githubusercontent.com/MohamadHajjRabee/quran-qcf4/main/pages",
  },
  sourcePages: {
    local: {
      svg: `${LOCAL_ASSET_ROOT}/mushaf-svg`,
      qcf: `${LOCAL_ASSET_ROOT}/qcf4/pages`,
    },
    remote: {
      svg: "https://github.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/blob/main/SVG%20V1.01",
      qcf: "https://github.com/MohamadHajjRabee/quran-qcf4/blob/main/pages",
    },
  },
};

const state = {
  page: 351,
  svg: null,
  qcfPage: null,
  words: [],
  ayaMarks: [],
  selectedKey: null,
  selectedWord: null,
  translations: null,
  waqfIndex: null,
  waqfAnnotations: new Map(),
  sourceOrigins: { svg: ASSET_MODE === "remote" ? "remote" : "local", qcf: ASSET_MODE === "remote" ? "remote" : "local" },
  requestNumber: 0,
};

// QUL resource 91 — Persian word-by-word translation, keyed "surah:ayah:word".
const WORD_TRANSLATIONS_URL = new URL("./assets/translations/qul-91-persian-wbw.json", import.meta.url).href;

// Waqf/ibtida: printed pause marks generated from the Mushaf SVG, plus an
// optional override file for book-based rulings (see assets/data/README.md).
const WAQF_DATA_URL = new URL("./assets/data/waqf-signs.json", import.meta.url).href;
const WAQF_OVERRIDES_URL = new URL("./assets/data/waqf-overrides.json", import.meta.url).href;


const ui = {
  pageHost: document.querySelector("#mushaf-page"),
  stage: document.querySelector("#mushaf-stage"),
  loading: document.querySelector("#loading-card"),
  connection: document.querySelector("#connection-state"),
  connectionText: document.querySelector("#connection-state span:last-child"),
  input: document.querySelector("#page-number"),
  previous: document.querySelector("#previous-page"),
  next: document.querySelector("#next-page"),
  targetToggle: document.querySelector("#toggle-targets"),
  waqfToggle: document.querySelector("#toggle-waqf"),
  resetSelection: document.querySelector("#reset-selection"),
  empty: document.querySelector("#empty-state"),
  details: document.querySelector("#word-details"),
  pageBadge: document.querySelector("#page-badge"),
  selectedWord: document.querySelector("#selected-word"),
  plainWord: document.querySelector("#plain-word"),
  verseKey: document.querySelector("#verse-key"),
  lineNumber: document.querySelector("#line-number"),
  wordPosition: document.querySelector("#word-position"),
  svgId: document.querySelector("#svg-id"),
  wordTranslation: document.querySelector("#word-translation"),
  verseWbw: document.querySelector("#verse-wbw"),
  waqfPanel: document.querySelector("#waqf-panel"),
  waqfBadge: document.querySelector("#waqf-badge"),
  waqfName: document.querySelector("#waqf-name"),
  waqfRule: document.querySelector("#waqf-rule"),
  waqfVerdict: document.querySelector("#waqf-verdict"),
  waqfIbtida: document.querySelector("#waqf-ibtida"),
  waqfIbtidaText: document.querySelector("#waqf-ibtida-text"),
  waqfIbtidaNote: document.querySelector("#waqf-ibtida-note"),
  waqfStrip: document.querySelector("#waqf-strip"),
  waqfStripLabel: document.querySelector("#waqf-strip-label"),
  waqfLegend: document.querySelector("#waqf-legend"),
  waqfLegendGrid: document.querySelector("#waqf-legend-grid"),
  waqfStatus: document.querySelector("#waqf-status"),
  qcfStatus: document.querySelector("#qcf-status"),
  svgSource: document.querySelector("#svg-source"),
  qcfSource: document.querySelector("#qcf-source"),
  errorTemplate: document.querySelector("#error-template"),
};

function pageFile(page) {
  return String(page).padStart(3, "0");
}

function asPersianNumber(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
}

function toInteger(value) {
  return Number.parseInt(String(value), 10);
}

function validPage(value) {
  const page = toInteger(value);
  return Number.isInteger(page) && page >= 1 && page <= 604;
}

function setConnection(kind, message) {
  ui.connection.className = `connection-state ${kind}`;
  ui.connectionText.textContent = message;
}

function decodeEntities(value = "") {
  const textArea = document.createElement("textarea");
  textArea.innerHTML = value;
  return textArea.value;
}

/* Normalize just enough for a data join — never use this to display Quran text. */
function normalizeForMatching(value = "") {
  return decodeEntities(value)
    .normalize("NFD")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C-\u200F]/g, "")
    .replace(/[ٱأإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0621-\u063A\u0641-\u064A]/g, "");
}

function isVisualPunctuation(value) {
  return normalizeForMatching(value).length === 0;
}

function createQcfVerseIndex(qcfPage) {
  const byVerse = new Map();
  if (!qcfPage?.lines) return byVerse;

  qcfPage.lines.flatMap((line) => line.words || []).forEach((word) => {
    if (word.type !== "word" || !word.verse_key) return;

    const record = {
      ...word,
      normalized: normalizeForMatching(word.text),
    };

    if (!byVerse.has(word.verse_key)) byVerse.set(word.verse_key, []);
    byVerse.get(word.verse_key).push(record);
  });

  return byVerse;
}

function verseKeyFromSvgWord(word) {
  return `${toInteger(word.dataset.surah)}:${toInteger(word.dataset.aya)}`;
}

function setInteractionData(element, interactionKey, qcfRecord, matched) {
  element.dataset.interactionKey = interactionKey;
  element.dataset.qcfMatched = String(Boolean(matched));

  if (qcfRecord) {
    element.dataset.qcfPosition = String(qcfRecord.position);
    element.dataset.qcfText = decodeEntities(qcfRecord.text);
  }
}

/*
 * SVG decomposes a few visual items differently from QCF4:
 * - some waqf marks are their own md-word group;
 * - waw al-atf may be a separate graphic group.
 *
 * We keep SVG groups untouched and assign them a shared interaction key.
 * This preserves the original artwork while making touch actions logical.
 */
function enrichSvgWords(svgRoot, qcfPage) {
  const qcfByVerse = createQcfVerseIndex(qcfPage);
  const svgWords = Array.from(svgRoot.querySelectorAll('g[id^="md-word-"]'));
  const grouped = new Map();

  svgWords.forEach((word) => {
    const verseKey = verseKeyFromSvgWord(word);
    word.dataset.verseKey = verseKey;
    if (!grouped.has(verseKey)) grouped.set(verseKey, []);
    grouped.get(verseKey).push(word);
  });

  let totalMatched = 0;
  let totalLogicalWords = 0;

  grouped.forEach((svgVerseWords, verseKey) => {
    const qcfWords = qcfByVerse.get(verseKey) || [];
    let qcfCursor = 0;
    let lastInteraction = null;
    let pendingPrefix = [];

    svgVerseWords.forEach((svgWord, svgIndex) => {
      const rawText = svgWord.dataset.hafs || "";
      const normalized = normalizeForMatching(rawText);

      // Waqf graphics are tappable too, but select the preceding logical word.
      if (isVisualPunctuation(rawText)) {
        if (lastInteraction) {
          setInteractionData(
            svgWord,
            lastInteraction.key,
            lastInteraction.record,
            lastInteraction.matched,
          );
        } else {
          svgWord.dataset.interactionKey = `svg:${state.page}:${svgIndex}`;
          svgWord.dataset.qcfMatched = "false";
        }
        return;
      }

      // In this SVG specification, the conjunction waw can be an independent group.
      if (svgWord.dataset.wawAlatf === "true") {
        pendingPrefix.push(svgWord);
        return;
      }

      const prefixText = pendingPrefix
        .map((prefix) => normalizeForMatching(prefix.dataset.hafs || ""))
        .join("");
      const combined = `${prefixText}${normalized}`;

      let qcfRecord = qcfWords[qcfCursor];
      let matched = Boolean(qcfRecord && (qcfRecord.normalized === combined || qcfRecord.normalized === normalized));

      // Small lookahead makes matching resilient to graphical pause marks.
      if (!matched) {
        const matchAt = qcfWords.slice(qcfCursor, qcfCursor + 4).findIndex((candidate) => (
          candidate.normalized === combined || candidate.normalized === normalized
        ));
        if (matchAt !== -1) {
          qcfCursor += matchAt;
          qcfRecord = qcfWords[qcfCursor];
          matched = true;
        }
      }

      // The SVG remains fully usable even if a future source revision needs a mapping adjustment.
      if (!qcfRecord) {
        qcfRecord = {
          position: svgWord.dataset.wordIndexInAyah || "—",
          text: rawText,
          normalized,
        };
      }

      const semanticPosition = qcfRecord.position || svgWord.dataset.wordIndexInAyah || svgIndex + 1;
      const interactionKey = `${verseKey}:${semanticPosition}`;

      [...pendingPrefix, svgWord].forEach((part) => {
        setInteractionData(part, interactionKey, qcfRecord, matched);
      });

      lastInteraction = { key: interactionKey, record: qcfRecord, matched };
      pendingPrefix = [];
      totalLogicalWords += 1;
      if (matched) totalMatched += 1;

      if (qcfWords[qcfCursor] === qcfRecord) qcfCursor += 1;
    });

    // Defensive fallback for a conjunction at the end of an unexpected source line.
    pendingPrefix.forEach((part) => {
      if (lastInteraction) {
        setInteractionData(part, lastInteraction.key, lastInteraction.record, lastInteraction.matched);
      }
    });
  });

  state.words = svgWords;
  attachAyaMarks(svgRoot);
  return { totalMatched, totalLogicalWords, qcfAvailable: qcfByVerse.size > 0 };
}

/*
 * Aya marks (۝) carry data-surah/data-aya, so each mark knows its verse.
 * They act as a "select the whole verse" control.
 */
function attachAyaMarks(svgRoot) {
  state.ayaMarks = Array.from(svgRoot.querySelectorAll('g[id^="md-aya-mark"]'));
  state.ayaMarks.forEach((mark) => {
    if (mark.dataset.surah && mark.dataset.aya) {
      mark.dataset.verseKey = verseKeyFromSvgWord(mark);
    }
  });
}

function installTouchHitAreas(svgRoot) {
  // A transparent rectangle enlarges tiny diacritics/short words for finger taps.
  requestAnimationFrame(() => {
    svgRoot.querySelectorAll('g[id^="md-word-"], g[id^="md-aya-mark"]').forEach((word) => {
      if (word.querySelector(":scope > .touch-hitbox")) return;

      try {
        const box = word.getBBox();
        if (!box.width || !box.height) return;

        const hitbox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        hitbox.classList.add("touch-hitbox");
        hitbox.setAttribute("x", String(box.x - 1.8));
        hitbox.setAttribute("y", String(box.y - 2.4));
        hitbox.setAttribute("width", String(box.width + 3.6));
        hitbox.setAttribute("height", String(box.height + 4.8));
        hitbox.setAttribute("fill", "transparent");
        hitbox.setAttribute("pointer-events", "all");
        hitbox.setAttribute("aria-hidden", "true");
        word.insertBefore(hitbox, word.firstChild);
      } catch {
        // getBBox can fail only for an invalid/invisible SVG fragment; the paths remain clickable.
      }
    });
  });
}

function clearSelection() {
  state.selectedKey = null;
  state.selectedWord = null;
  state.words.forEach((word) => word.classList.remove("is-active-word", "is-active-verse"));
  state.ayaMarks.forEach((mark) => mark.classList.remove("is-active-mark"));
  if (ui.waqfPanel) ui.waqfPanel.hidden = true;
  if (ui.waqfStrip) ui.waqfStrip.hidden = true;
  if (ui.waqfStripLabel) ui.waqfStripLabel.hidden = true;
  ui.resetSelection.disabled = true;
  ui.details.hidden = true;
  ui.empty.hidden = false;
}

/* --- QUL 91: Persian word-by-word translation (single lazy fetch) --- */
function loadWordTranslations() {
  return fetch(WORD_TRANSLATIONS_URL, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`Translation request failed: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      state.translations = data;
      if (state.selectedWord) selectWord(state.selectedWord, { keepVerseHighlight: true });
    })
    .catch((error) => {
      state.translations = {};
      console.warn("QUL 91 translations unavailable:", error);
    });
}

function wordTranslation(verseKey, position) {
  if (!state.translations) return "در حال بارگذاریٔ ترجمه…";
  return state.translations[`${verseKey}:${position}`] || "—";
}

function renderVerseTranslations(verseKey, activePosition) {
  if (!state.translations) return;
  const prefix = `${verseKey}:`;
  const chips = Object.entries(state.translations)
    .filter(([key, value]) => key.startsWith(prefix) && Number.isInteger(toInteger(key.slice(prefix.length))) && !/^\d+$/.test(value.trim()))
    .map(([key, value]) => ({ position: toInteger(key.slice(prefix.length)), value }))
    .sort((a, b) => a.position - b.position)
    .map(({ position, value }) => {
      const chip = document.createElement("span");
      chip.className = "wbw-chip";
      if (position === activePosition) chip.classList.add("is-active");
      chip.textContent = value;
      return chip;
    });

  ui.verseWbw.replaceChildren(...chips);
  ui.verseWbw.hidden = chips.length === 0;
}


/* --- Waqf & Ibtida: the Mushaf's own pause marks, plus optional rulings --- */
async function loadWaqfData() {
  try {
    const response = await fetch(WAQF_DATA_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Waqf request failed: ${response.status}`);
    const dataset = await response.json();

    // The override file is optional: a missing file is a normal condition.
    let overrides = null;
    try {
      const overrideResponse = await fetch(WAQF_OVERRIDES_URL, { cache: "force-cache" });
      if (overrideResponse.ok) overrides = await overrideResponse.json();
    } catch (error) {
      console.warn("Waqf overrides unavailable:", error);
    }

    state.waqfIndex = mergeOverrides(buildIndex(dataset), overrides);
    const total = dataset.meta?.marks || 0;
    setWaqfStatus(
      "success",
      overrides
        ? `${asPersianNumber(total)} نشانٔ وقف + احکامِ ${overrides.meta?.source || "منبع خارجی"}`
        : `${asPersianNumber(total)} نشانٔ وقف از SVG مصحف خوانده شد`,
    );

    applyWaqfAnnotations();
    if (state.selectedWord) selectWord(state.selectedWord, { keepVerseHighlight: true });
  } catch (error) {
    state.waqfIndex = null;
    console.warn("Waqf data unavailable:", error);
    setWaqfStatus("warning", "دادهٔ وقف در دسترس نیست");
  }
}

function setWaqfStatus(kind, message) {
  if (!ui.waqfStatus) return;
  ui.waqfStatus.hidden = false;
  ui.waqfStatus.className = `waqf-status ${kind}`;
  ui.waqfStatus.textContent = message;
}

/* Every SVG word group, in reading order, reduced to what waqf.js needs. */
function waqfRecords() {
  return state.words.map((word) => ({
    id: word.id,
    verseKey: word.dataset.verseKey || verseKeyFromSvgWord(word),
    wordIndex: toInteger(word.dataset.wordIndexInAyah),
    hafs: word.dataset.hafs || "",
    svgWaqf: word.querySelector("[data-waqf]")?.dataset.waqf || "",
  }));
}

function applyWaqfAnnotations() {
  state.waqfAnnotations = annotateWords(waqfRecords(), state.waqfIndex);

  state.words.forEach((word) => {
    const info = state.waqfAnnotations.get(word.id);
    if (!info) return;

    word.classList.toggle("is-waqf-mark", info.role === "mark");
    if (info.kind) word.dataset.waqfKind = info.kind;
    else delete word.dataset.waqfKind;

    const meta = info.role === "mark" ? kindMeta(info.kind) : null;
    if (meta) word.setAttribute("aria-label", `${meta.name} — ${word.dataset.verseKey || ""}`);
  });
}

function renderWaqf(word) {
  const info = state.waqfAnnotations.get(word.id);
  const entry = info?.entry || info?.waqfAfter?.entry || null;
  const kind = entry?.kind || info?.kind || info?.waqfAfter?.kind || null;

  if (!kind) {
    ui.waqfPanel.hidden = true;
    return;
  }

  const meta = kindMeta(kind);
  const restart = ibtidaFor(state.waqfIndex, entry);
  const verdict = entry?.verdict;

  ui.waqfPanel.hidden = false;
  ui.waqfPanel.dataset.waqfKind = kind;
  // A book-only ruling has no printed glyph, so fall back to its own label.
  ui.waqfBadge.textContent = meta?.mark || entry?.mark || verdict?.ar || "؟";
  ui.waqfName.textContent = meta?.name || verdict?.fa || kind;
  ui.waqfRule.textContent = meta?.rule || "";
  ui.waqfRule.hidden = !meta?.rule;

  if (verdict) {
    ui.waqfVerdict.hidden = false;
    ui.waqfVerdict.textContent = [
      verdict.fa || null,
      verdict.ar ? `(${verdict.ar})` : null,
      verdict.reason ? `— ${verdict.reason}` : null,
      verdict.source ? `· ${verdict.source}` : null,
    ].filter(Boolean).join(" ");
  } else {
    ui.waqfVerdict.hidden = true;
  }

  if (restart && (restart.text || restart.word || restart.note)) {
    ui.waqfIbtida.hidden = false;
    ui.waqfIbtidaText.textContent = restart.text
      ? `${restart.label}: ${restart.text}`
      : restart.label;
    ui.waqfIbtidaNote.textContent = restart.note || "";
  } else {
    ui.waqfIbtida.hidden = true;
  }
}

function renderWaqfStrip(verseKey) {
  const { marks, ibtida } = describeVerse(state.waqfIndex, verseKey);
  const chips = [];

  marks.forEach((entry) => {
    const meta = kindMeta(entry.kind);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "waqf-chip";
    chip.dataset.waqfKind = entry.kind;

    const glyph = document.createElement("span");
    glyph.className = "waqf-chip-mark";
    glyph.textContent = meta?.mark || entry.mark || "";

    const label = document.createElement("span");
    label.textContent = `${meta?.name || entry.kind} · جای ${asPersianNumber(entry.word)}`;

    chip.append(glyph, label);

    // A printed mark is clickable: it selects the word it belongs to.
    if (entry.svg_id) {
      chip.addEventListener("click", () => {
        const target = ui.pageHost.querySelector(`#${CSS.escape(entry.svg_id)}`);
        if (target) selectWord(target);
      });
    } else {
      chip.disabled = true;
    }
    chips.push(chip);
  });

  ibtida.forEach((item) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "waqf-chip is-ibtida";
    chip.textContent = `${item.fa} · کلمهٔ ${asPersianNumber(item.word)}`;
    if (item.note) chip.title = item.note;

    // The word to resume from may sit on the next page; only link what is here.
    const selector = `g[id^="md-word-"][data-verse-key="${verseKey}"]`
      + `[data-word-index-in-ayah="${item.word}"]`;
    const target = ui.pageHost.querySelector(selector);
    if (target) chip.addEventListener("click", () => selectWord(target));
    else chip.disabled = true;

    chips.push(chip);
  });

  ui.waqfStrip.replaceChildren(...chips);
  ui.waqfStrip.hidden = chips.length === 0;
  ui.waqfStripLabel.hidden = chips.length === 0;
}

function renderWaqfLegend() {
  const items = kindLegend().map((meta) => {
    const item = document.createElement("span");
    item.className = "waqf-legend-item";
    item.dataset.waqfKind = meta.kind;

    const glyph = document.createElement("span");
    glyph.className = "waqf-chip-mark";
    glyph.textContent = meta.mark;

    const name = document.createElement("span");
    name.textContent = meta.name;

    item.append(glyph, name);
    return item;
  });

  ui.waqfLegendGrid.replaceChildren(...items);
  ui.waqfLegend.hidden = false;
}

function selectWord(word, { keepVerseHighlight = false } = {}) {
  const interactionKey = word.dataset.interactionKey || word.id;
  const verseKey = word.dataset.verseKey || verseKeyFromSvgWord(word);
  const qcfMatched = word.dataset.qcfMatched === "true";
  const sameInteraction = state.words.filter((item) => item.dataset.interactionKey === interactionKey);

  // Clicking a word selects only that word — never the whole verse.
  state.words.forEach((item) => item.classList.remove("is-active-word"));
  if (!keepVerseHighlight) {
    state.words.forEach((item) => item.classList.remove("is-active-verse"));
    state.ayaMarks.forEach((item) => item.classList.remove("is-active-mark"));
  }
  sameInteraction.forEach((item) => item.classList.add("is-active-word"));
  state.selectedKey = interactionKey;

  const [surah, ayah] = verseKey.split(":");
  const qcfText = word.dataset.qcfText || word.dataset.hafs || "—";
  const position = toInteger(word.dataset.qcfPosition || word.dataset.wordIndexInAyah);

  state.selectedWord = word;

  ui.selectedWord.textContent = qcfText;
  ui.plainWord.textContent = word.dataset.imlaey || "";
  ui.wordTranslation.textContent = wordTranslation(verseKey, position);
  renderVerseTranslations(verseKey, position);
  renderWaqf(word);
  renderWaqfStrip(verseKey);
  ui.verseKey.textContent = `${surah}:${ayah}`;
  ui.lineNumber.textContent = asPersianNumber(toInteger(word.dataset.lineNumber));
  ui.wordPosition.textContent = asPersianNumber(word.dataset.qcfPosition || word.dataset.wordIndexInAyah || "—");
  ui.svgId.textContent = word.id;
  ui.empty.hidden = true;
  ui.details.hidden = false;
  ui.resetSelection.disabled = false;

  ui.qcfStatus.classList.toggle("is-warning", !qcfMatched);
  ui.qcfStatus.innerHTML = qcfMatched
    ? '<span class="status-check">✓</span><span>به دادهٔ کلمه‌ای QCF4 متصل شد</span>'
    : '<span class="status-check">!</span><span>SVG لمس‌پذیر است؛ نگاشت QCF4 نیاز به بازبینی دارد</span>';
}

/*
 * Clicking the aya mark (۝) selects the entire verse: every word of the
 * verse is highlighted, and the inspector anchors on the verse's first
 * logical word so its word-by-word translation is shown.
 */
function selectVerse(mark) {
  const verseKey = mark.dataset.verseKey;
  if (!verseKey) return;

  state.words.forEach((item) => item.classList.remove("is-active-word", "is-active-verse"));
  state.ayaMarks.forEach((item) => item.classList.remove("is-active-mark"));

  const verseWords = state.words.filter((item) => item.dataset.verseKey === verseKey);
  verseWords.forEach((item) => item.classList.add("is-active-verse"));
  mark.classList.add("is-active-mark");

  const anchor = verseWords.find((item) => (item.dataset.interactionKey || "").startsWith(`${verseKey}:`));
  if (anchor) selectWord(anchor, { keepVerseHighlight: true });
}

function renderError() {
  const fragment = ui.errorTemplate.content.cloneNode(true);
  fragment.querySelector(".retry-button").addEventListener("click", () => loadPage(state.page));
  ui.pageHost.replaceChildren(fragment);
}

function setSourceLinks(page, origins = state.sourceOrigins) {
  const file = pageFile(page);
  ui.svgSource.href = `${SOURCES.sourcePages[origins.svg]}/${file}.svg`;
  ui.qcfSource.href = `${SOURCES.sourcePages[origins.qcf]}/${file}.json`;
}

async function fetchAsset(kind, file) {
  const filename = `${file}.${kind === "svg" ? "svg" : "json"}`;

  // Production builds set mode=local: never silently fall back to an upstream source.
  if (ASSET_MODE !== "remote") {
    try {
      const localResponse = await fetch(`${SOURCES.local[kind]}/${filename}`, { cache: "force-cache" });
      if (localResponse.ok || ASSET_MODE === "local") {
        return { response: localResponse, origin: "local" };
      }
    } catch (error) {
      if (ASSET_MODE === "local") throw error;
    }
  }

  // Development's auto mode stays convenient even before local assets are extracted.
  const remoteResponse = await fetch(`${SOURCES.remote[kind]}/${filename}`, { cache: "force-cache" });
  return { response: remoteResponse, origin: "remote" };
}

async function loadPage(requestedPage) {
  const page = Math.min(604, Math.max(1, toInteger(requestedPage) || state.page));
  const requestNumber = ++state.requestNumber;
  const file = pageFile(page);

  state.page = page;
  state.qcfPage = null;
  state.words = [];
  state.ayaMarks = [];
  ui.input.value = String(page);
  ui.pageBadge.textContent = asPersianNumber(page);
  ui.loading.hidden = false;
  ui.pageHost.replaceChildren();
  clearSelection();
  setSourceLinks(page);
  setConnection("loading", "در حال دریافت SVG و دادهٔ QCF4");

  const svgRequest = fetchAsset("svg", file);
  const qcfRequest = fetchAsset("qcf", file).catch(() => null);

  try {
    const [svgAsset, qcfAsset] = await Promise.all([svgRequest, qcfRequest]);
    const svgResponse = svgAsset.response;

    if (!svgResponse.ok) throw new Error(`SVG request failed: ${svgResponse.status}`);
    const svgText = await svgResponse.text();
    if (requestNumber !== state.requestNumber) return;

    const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Invalid SVG document");

    const svg = document.importNode(parsed.documentElement, true);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `صفحهٔ ${asPersianNumber(page)} از مصحف مدینه`);
    ui.pageHost.replaceChildren(svg);
    state.svg = svg;

    let qcfPage = null;
    if (qcfAsset?.response?.ok) {
      qcfPage = await qcfAsset.response.json();
      state.qcfPage = qcfPage;
    }

    state.sourceOrigins = {
      svg: svgAsset.origin,
      qcf: qcfAsset?.origin || svgAsset.origin,
    };
    setSourceLinks(page, state.sourceOrigins);

    const mapping = enrichSvgWords(svg, qcfPage);
    applyWaqfAnnotations();
    installTouchHitAreas(svg);
    ui.loading.hidden = true;

    if (mapping.qcfAvailable) {
      setConnection("success", `${asPersianNumber(mapping.totalMatched)} کلمه با QCF4 همگام شد`);
    } else {
      setConnection("success", "SVG آماده است؛ دادهٔ QCF4 در دسترس نبود");
    }
  } catch (error) {
    if (requestNumber !== state.requestNumber) return;
    console.error(error);
    ui.loading.hidden = true;
    setConnection("error", "خطا در دریافت داده");
    renderError();
  }
}

function movePage(delta) {
  loadPage(Math.min(604, Math.max(1, state.page + delta)));
}

ui.previous.addEventListener("click", () => movePage(-1));
ui.next.addEventListener("click", () => movePage(1));

ui.input.addEventListener("change", () => {
  if (validPage(ui.input.value)) loadPage(toInteger(ui.input.value));
  else ui.input.value = String(state.page);
});

ui.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") ui.input.blur();
});

ui.targetToggle.addEventListener("click", () => {
  const enabled = ui.targetToggle.getAttribute("aria-pressed") !== "true";
  ui.targetToggle.setAttribute("aria-pressed", String(enabled));
  ui.pageHost.classList.toggle("show-touch-targets", enabled);
});

ui.waqfToggle.addEventListener("click", () => {
  const enabled = ui.waqfToggle.getAttribute("aria-pressed") !== "true";
  ui.waqfToggle.setAttribute("aria-pressed", String(enabled));
  ui.pageHost.classList.toggle("show-waqf", enabled);
});

ui.resetSelection.addEventListener("click", clearSelection);

ui.pageHost.addEventListener("pointerup", (event) => {
  const mark = event.target.closest?.('g[id^="md-aya-mark"]');
  if (mark && ui.pageHost.contains(mark)) {
    selectVerse(mark);
    return;
  }

  const word = event.target.closest?.('g[id^="md-word-"]');
  if (word && ui.pageHost.contains(word)) selectWord(word);
});

renderWaqfLegend();
loadWaqfData();
loadWordTranslations();
loadPage(state.page);
