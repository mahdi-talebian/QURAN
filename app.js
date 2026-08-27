/*
 * Mushaf Touch — proof of concept
 *
 * Render source: MushafDatabase SVG (visual authority)
 * Metadata source: QCF4 JSON (interaction/enrichment layer)
 *
 * Important: QCF4 glyphs/fonts are deliberately NOT drawn on top of the SVG.
 * The SVG keeps the printed Madinah page visually faithful; QCF4 enriches it.
 */

const ASSET_MODE = window.MUSHAF_ASSET_MODE === "local" ? "local" : "remote";
const LOCAL_ASSET_ROOT = new URL("./assets/", import.meta.url).href.replace(/\/$/, "");

const SOURCES = ASSET_MODE === "local"
  ? {
      // import.meta.url keeps these paths correct even when deployed under a sub-path.
      svgRaw: `${LOCAL_ASSET_ROOT}/mushaf-svg`,
      svgGithub: `${LOCAL_ASSET_ROOT}/mushaf-svg`,
      qcfRaw: `${LOCAL_ASSET_ROOT}/qcf4/pages`,
      qcfGithub: `${LOCAL_ASSET_ROOT}/qcf4/pages`,
    }
  : {
      svgRaw:
        "https://raw.githubusercontent.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/main/SVG%20V1.01",
      svgGithub:
        "https://github.com/mushafdatabase/MushafDatabase-Ligature-Based-SVG/blob/main/SVG%20V1.01",
      qcfRaw:
        "https://raw.githubusercontent.com/MohamadHajjRabee/quran-qcf4/main/pages",
      qcfGithub:
        "https://github.com/MohamadHajjRabee/quran-qcf4/blob/main/pages",
    };

const state = {
  page: 351,
  svg: null,
  qcfPage: null,
  words: [],
  selectedKey: null,
  requestNumber: 0,
};

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
  return { totalMatched, totalLogicalWords, qcfAvailable: qcfByVerse.size > 0 };
}

function installTouchHitAreas(svgRoot) {
  // A transparent rectangle enlarges tiny diacritics/short words for finger taps.
  requestAnimationFrame(() => {
    svgRoot.querySelectorAll('g[id^="md-word-"]').forEach((word) => {
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
  state.words.forEach((word) => word.classList.remove("is-active-word", "is-same-verse"));
  ui.resetSelection.disabled = true;
  ui.details.hidden = true;
  ui.empty.hidden = false;
}

function selectWord(word) {
  const interactionKey = word.dataset.interactionKey || word.id;
  const verseKey = word.dataset.verseKey || verseKeyFromSvgWord(word);
  const qcfMatched = word.dataset.qcfMatched === "true";
  const sameInteraction = state.words.filter((item) => item.dataset.interactionKey === interactionKey);
  const sameVerse = state.words.filter((item) => item.dataset.verseKey === verseKey);

  state.words.forEach((item) => item.classList.remove("is-active-word", "is-same-verse"));
  sameVerse.forEach((item) => item.classList.add("is-same-verse"));
  sameInteraction.forEach((item) => item.classList.add("is-active-word"));
  state.selectedKey = interactionKey;

  const [surah, ayah] = verseKey.split(":");
  const qcfText = word.dataset.qcfText || word.dataset.hafs || "—";

  ui.selectedWord.textContent = qcfText;
  ui.plainWord.textContent = word.dataset.imlaey || "";
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

function renderError() {
  const fragment = ui.errorTemplate.content.cloneNode(true);
  fragment.querySelector(".retry-button").addEventListener("click", () => loadPage(state.page));
  ui.pageHost.replaceChildren(fragment);
}

function setSourceLinks(page) {
  const file = pageFile(page);
  ui.svgSource.href = `${SOURCES.svgGithub}/${file}.svg`;
  ui.qcfSource.href = `${SOURCES.qcfGithub}/${file}.json`;
}

async function loadPage(requestedPage) {
  const page = Math.min(604, Math.max(1, toInteger(requestedPage) || state.page));
  const requestNumber = ++state.requestNumber;
  const file = pageFile(page);

  state.page = page;
  state.qcfPage = null;
  state.words = [];
  ui.input.value = String(page);
  ui.pageBadge.textContent = asPersianNumber(page);
  ui.loading.hidden = false;
  ui.pageHost.replaceChildren();
  clearSelection();
  setSourceLinks(page);
  setConnection("loading", "در حال دریافت SVG و دادهٔ QCF4");

  const svgRequest = fetch(`${SOURCES.svgRaw}/${file}.svg`);
  const qcfRequest = fetch(`${SOURCES.qcfRaw}/${file}.json`);

  try {
    const [svgResponse, qcfResult] = await Promise.all([
      svgRequest,
      qcfRequest.catch(() => null),
    ]);

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
    if (qcfResult?.ok) {
      qcfPage = await qcfResult.json();
      state.qcfPage = qcfPage;
    }

    const mapping = enrichSvgWords(svg, qcfPage);
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

ui.resetSelection.addEventListener("click", clearSelection);

ui.pageHost.addEventListener("pointerup", (event) => {
  const word = event.target.closest?.('g[id^="md-word-"]');
  if (word && ui.pageHost.contains(word)) selectWord(word);
});

loadPage(state.page);
