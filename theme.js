/*
 * Theme controller — light / dark.
 *
 * Loaded synchronously from <head> so the theme is applied before the
 * first paint (no light-theme flash when dark is selected). Preference
 * is stored in localStorage; without an explicit choice the OS
 * prefers-color-scheme setting is followed.
 */
(function () {
  const STORAGE_KEY = "mushaf-theme";
  const META_COLORS = { light: "#0c6b4f", dark: "#0b120f" };

  function storedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === "dark" || value === "light" ? value : null;
    } catch {
      return null; // Private mode / storage disabled — fall back to the OS setting.
    }
  }

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", META_COLORS[theme]);
  }

  applyTheme(storedTheme() || systemTheme());

  window.addEventListener("DOMContentLoaded", () => {
    const toggle = document.querySelector("#theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Storage unavailable — the toggle still works for this page view.
        }
        applyTheme(next);
      });
    }

    // Follow OS-level changes only while the user hasn't chosen explicitly.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
      if (!storedTheme()) applyTheme(event.matches ? "dark" : "light");
    });
  });
})();
