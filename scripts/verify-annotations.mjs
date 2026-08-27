/*
 * End-to-end check for the waqf/ibtida layer.
 *
 * Runs the real app.js (unmodified) inside jsdom against the local server, so
 * the code that actually ships is the code under test. The harness supplies
 * only two things: the DOM, and a fetch that maps the module's file:// asset
 * URLs onto the server.
 *
 *   npm run serve          # in one terminal
 *   npm run test:annotations   # in another (needs: npm i)
 *
 * BASE=http://127.0.0.1:PORT overrides the server address.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.error("jsdom is not installed. Run `npm i` once, then retry.");
  process.exit(2);
}

const BASE = process.env.BASE || "http://127.0.0.1:4173";
const REPO = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const results = [];
const problems = [];

const NONE = Symbol("none");
function check(name, actual, expected = NONE) {
  const ok = expected === NONE ? Boolean(actual) : actual === expected;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}  →  ${JSON.stringify(actual)}`);
  if (!ok) problems.push(name);
}

const html = await (await fetch(`${BASE}/index.html`)).text();
const dom = new JSDOM(html, { url: `${BASE}/`, pretendToBeVisual: true });
const { window } = dom;

const requests = [];
const realFetch = globalThis.fetch;
const shim = (input, init) => {
  const url = String(input);
  const mapped = url.startsWith("file://") ? `${BASE}/${url.slice("file://".length + REPO.length + 1)}` : url;
  requests.push(mapped.replace(BASE, ""));
  return realFetch(mapped, init);
};

globalThis.window = window;
globalThis.document = window.document;
globalThis.DOMParser = window.DOMParser;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.fetch = shim;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
window.fetch = shim;

const pageErrors = [];
window.addEventListener("error", (e) => pageErrors.push(String(e.message || e.error)));

await import(`${REPO}/app.js`);

// Let loadPage() + loadAnnotations() settle.
const deadline = Date.now() + 45000;
while (Date.now() < deadline) {
  if (window.document.querySelectorAll(".annot-waqf").length > 0) break;
  await new Promise((r) => setTimeout(r, 250));
}

const doc = window.document;
const groups = [...doc.querySelectorAll('g[id^="md-word-"]')];
const waqf = groups.filter((g) => g.classList.contains("annot-waqf"));
const ibtida = groups.filter((g) => g.classList.contains("annot-ibtida"));
const byHafs = (h) => groups.find((g) => g.dataset.hafs === h);
const byKey = (k) => groups.find((g) => g.dataset.interactionKey === k);

console.log("fetched assets:", [...new Set(requests)].join("  "));
console.log(`page 351: ${groups.length} word groups, ${waqf.length} red, ${ibtida.length} blue`);
console.log(`distinct red keys: ${new Set(waqf.map((g) => g.dataset.interactionKey)).size}, `
  + `distinct blue keys: ${new Set(ibtida.map((g) => g.dataset.interactionKey)).size}`);
console.log("sample hafs:", JSON.stringify(groups.slice(0, 3).map((g) => g.dataset.hafs)));
console.log("");

check("annotation JSON was fetched", requests.some((r) => r.includes("annotations/waqf-ibtida.json")), true);
check("page 351 SVG was fetched locally", requests.some((r) => r === "/assets/mushaf-svg/351.svg"), true);
check("red (waqf) groups painted", waqf.length > 0);
check("blue (ibtida) groups painted", ibtida.length > 0);

// Ground truth from assets/annotations/waqf-ibtida.json for page 351.
const annot = JSON.parse(readFileSync(`${REPO}/assets/annotations/waqf-ibtida.json`, "utf8"));
const on351 = annot.entries.filter((e) => e.page === 351);
const waqfOn351 = on351.filter((e) => e.type === "waqf");
const ibtidaOn351 = on351.filter((e) => e.type === "ibtida");
console.log(`file says page 351: ${on351.length} entries (${waqfOn351.length} waqf / ${ibtidaOn351.length} ibtida)`);

check("every waqf entry in the file is painted", waqf.length >= waqfOn351.length);
check("every ibtida entry in the file is painted", ibtida.length >= ibtidaOn351.length);
check("sidebar list matches the file", doc.querySelectorAll("#annot-list .annot-row").length, on351.length);
check("sidebar count is in Persian digits", doc.querySelector("#annot-count").textContent, "۱۴");

// Address words by interaction key — the same key the reader itself uses —
// and compare spellings against the file, never against a literal in this test.
const keyOf = (e) => `${e.verse_key}:${e.position}`;
// 24:11 — the ۚ printed after مِّنكُمۡ (word 6), and the word that follows it (7).
const waqfEntry = waqfOn351.find((e) => e.verse_key === "24:11" && e.position === 6);
const ibtidaEntry = ibtidaOn351.find((e) => e.verse_key === "24:11" && e.position === 7);
const usba = byKey(keyOf(waqfEntry));
const la = byKey(keyOf(ibtidaEntry));
const inna = byKey("24:11:1");

check("the file names a waqf at 24:11:6", Boolean(waqfEntry), true);
check("the file names an ibtida at 24:11:7", Boolean(ibtidaEntry), true);
check("24:11:6 exists in the DOM", Boolean(usba), true);
check("24:11:6 spelling agrees with the file", usba?.dataset.imlaey, waqfEntry?.imlaey);
check("24:11:6 → data-annot=waqf", usba?.dataset.annot, "waqf");
check("24:11:6 has the red class", usba?.classList.contains("annot-waqf"), true);
check("24:11:7 → data-annot=ibtida", la?.dataset.annot, "ibtida");
check("24:11:7 has the blue class", la?.classList.contains("annot-ibtida"), true);
check("24:11:1 stays unmarked", inna?.dataset.annot ?? null, null);

// Count distinct keys, not groups: one logical word may be several SVG groups.
check("distinct red keys == waqf entries in the file",
  new Set(waqf.map((g) => g.dataset.interactionKey)).size, waqfOn351.length);
check("distinct blue keys == ibtida entries in the file",
  new Set(ibtida.map((g) => g.dataset.interactionKey)).size, ibtidaOn351.length);

// The pause sign after the waqf word shares its interaction key, so it turns red too.
const sign = groups.find((g) => g.dataset.interactionKey === keyOf(waqfEntry)
  && g.dataset.imlaey === "ۚ");
check("the pause sign turns red with its word", sign?.classList.contains("annot-waqf"), true);

// Selection: tapping a marked word must select it and show the badge.
const pointerUp = (el) => el.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
doc.querySelector("#mushaf-page").addEventListener("pointerup", () => {}, { once: true });
pointerUp(usba);
await new Promise((r) => setTimeout(r, 150));

check("tap marks the word active", doc.querySelectorAll(".is-active-word").length > 0);
check("inspector shows the word", doc.querySelector("#selected-word").textContent, waqfEntry.word);
check("badge names the sign", doc.querySelector("#annot-badges").textContent.trim(), `وقف · ${waqfEntry.label}`);
check("badge is visible", doc.querySelector("#annot-badges").hidden, false);
check("selected word keeps gold, not red (CSS owns the tint)",
  usba.classList.contains("is-active-word"), true);

// Tapping an unmarked word must clear the badge.
pointerUp(inna);
await new Promise((r) => setTimeout(r, 150));
check("badge hidden for an unmarked word", doc.querySelector("#annot-badges").hidden, true);

// Toggle off must strip every tint and empty the list.
doc.querySelector("#toggle-annotations").dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
check("toggle off: no red", doc.querySelectorAll(".annot-waqf").length, 0);
check("toggle off: no blue", doc.querySelectorAll(".annot-ibtida").length, 0);
check("toggle off: list empty", doc.querySelectorAll("#annot-list .annot-row").length, 0);
check("toggle aria-pressed=false", doc.querySelector("#toggle-annotations").getAttribute("aria-pressed"), "false");

doc.querySelector("#toggle-annotations").dispatchEvent(new window.Event("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
check("toggle on repaints", doc.querySelectorAll(".annot-waqf").length > 0);

// Page navigation must re-derive annotations for the new page.
const input = doc.querySelector("#page-number");
input.value = "2";
input.dispatchEvent(new window.Event("change", { bubbles: true }));
const t2 = Date.now() + 45000;
while (Date.now() < t2) {
  if (doc.querySelector("#page-badge").textContent === "۲" && doc.querySelectorAll(".annot-waqf").length) break;
  await new Promise((r) => setTimeout(r, 250));
}
const p2 = annot.entries.filter((e) => e.page === 2);
check("page 2 painted", doc.querySelectorAll(".annot-waqf").length > 0);
check("page 2 list matches the file", doc.querySelectorAll("#annot-list .annot-row").length, p2.length);
console.log(`\npage 2: ${doc.querySelectorAll(".annot-waqf").length} red, ${doc.querySelectorAll(".annot-ibtida").length} blue (file: ${p2.length} entries)`);

// The CSS contract: the classes the JS adds must be the ones the stylesheet tints.
const css = readFileSync(`${REPO}/styles.css`, "utf8");
check("css tints .annot-waqf red", /\.annot-waqf[^{]*\{[^}]*var\(--waqf-ink\)/.test(css), true);
check("css tints .annot-ibtida blue", /\.annot-ibtida[^{]*\{[^}]*var\(--ibtida-ink\)/.test(css), true);
check("--waqf-ink is red", /--waqf-ink:\s*#c0272d/.test(css), true);
check("--ibtida-ink is blue", /--ibtida-ink:\s*#1457b8/.test(css), true);
check("selection outranks the annotation tint", /\.annot-waqf:not\(\.is-active-word\)/.test(css), true);

check("no runtime errors", pageErrors.length ? pageErrors.join(" | ") : "none", "none");

console.log("\n" + results.join("\n"));
console.log(problems.length ? `\n${problems.length} FAILED: ${problems.join(", ")}` : "\nAll checks passed.");
process.exit(problems.length ? 1 : 0);
