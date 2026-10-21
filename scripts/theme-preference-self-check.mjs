import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storage = new Map();
const listeners = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  },
};
globalThis.document = {
  documentElement: { dataset: { theme: "dark" } },
  createElement(tagName) {
    assert.equal(tagName, "button", "theme toggle should render as a button");
    return {
      className: "",
      type: "",
      innerHTML: "",
      setAttribute(name, value) {
        this[name] = value;
      },
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      click() {
        listeners.get("click")?.();
      },
    };
  },
};

const {
  applyTheme,
  createThemeToggle,
  getCurrentTheme,
  initializeThemePreference,
  normalizeTheme,
} = await import("../src/pages/login/theme-toggle.js");

assert.equal(normalizeTheme("light"), "light", "light should be a valid theme");
assert.equal(normalizeTheme("dark"), "dark", "dark should be a valid theme");
assert.equal(normalizeTheme("stadium"), "", "unknown themes should be rejected");

assert.equal(getCurrentTheme(), "dark", "default HTML theme should be dark");
applyTheme("light", { persist: true });
assert.equal(globalThis.document.documentElement.dataset.theme, "light", "applyTheme should update the document theme");
assert.equal(storage.get("aiove_color_theme"), "light", "applyTheme should persist explicit user choice");

globalThis.document.documentElement.dataset.theme = "dark";
assert.equal(initializeThemePreference(), "light", "initialization should restore stored theme");
assert.equal(globalThis.document.documentElement.dataset.theme, "light", "stored theme should be applied to the root element");

const button = createThemeToggle();
button.click();
assert.equal(globalThis.document.documentElement.dataset.theme, "dark", "theme toggle should switch the current theme");
assert.equal(storage.get("aiove_color_theme"), "dark", "theme toggle should persist the switched theme");

const mainSource = readFileSync("src/app/main.js", "utf8");
assert.match(mainSource, /initializeThemePreference\(\);/, "app startup should initialize the stored theme before mounting views");

console.log("theme preference self-check passed");
