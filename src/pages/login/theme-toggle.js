import { createSiteCopy } from "../../i18n/site-copy.js";

const THEME_STORAGE_KEY = "aiove_color_theme";
const DEFAULT_THEME = "dark";
const VALID_THEMES = new Set(["dark", "light"]);

export function normalizeTheme(value) {
  const theme = String(value || "").trim().toLowerCase();
  return VALID_THEMES.has(theme) ? theme : "";
}

export function initializeThemePreference() {
  const storedTheme = readStoredTheme();
  if (!storedTheme) return getCurrentTheme();
  return applyTheme(storedTheme, { persist: false });
}

export function createThemeToggle() {
  initializeThemePreference();
  const copy = createSiteCopy(globalThis.document?.documentElement?.lang || "English");
  const button = document.createElement("button");
  button.className = "theme-toggle";
  button.type = "button";
  button.setAttribute("aria-label", copy.t("common.toggleTheme"));
  button.innerHTML = `
    <svg class="theme-toggle__moon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 1010.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
    </svg>
    <svg class="theme-toggle__sun" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"></circle>
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
    </svg>
  `;

  button.addEventListener("click", () => {
    const nextTheme = getCurrentTheme() === "dark" ? "light" : "dark";
    applyTheme(nextTheme, { persist: true });
  });

  return button;
}

export function getCurrentTheme() {
  return normalizeTheme(globalThis.document?.documentElement?.dataset?.theme) || DEFAULT_THEME;
}

export function applyTheme(theme, { persist = false } = {}) {
  const nextTheme = normalizeTheme(theme) || DEFAULT_THEME;
  const root = globalThis.document?.documentElement;
  if (root) root.dataset.theme = nextTheme;
  if (persist) {
    try {
      globalThis.window?.localStorage?.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Theme switching should still work when storage is unavailable.
    }
  }
  return nextTheme;
}

function readStoredTheme() {
  try {
    return normalizeTheme(globalThis.window?.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "";
  }
}
