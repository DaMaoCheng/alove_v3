import { normalizeCharacterLanguage } from "./language-library.js";

export const DEFAULT_SITE_LANGUAGE = Object.freeze({
  code: "en",
  label: "English",
  uiCode: "en",
});

export function normalizeSiteLanguage(value = "") {
  const source = value && typeof value === "object"
    ? value.code || value.label || value.defaultLanguage || value.default_language
    : value;
  const language = normalizeCharacterLanguage(source) || DEFAULT_SITE_LANGUAGE;
  return {
    code: language.code,
    label: language.label,
    uiCode: language.code,
  };
}

export function isChineseSiteLanguage(value = "") {
  return normalizeSiteLanguage(value).uiCode === "zh";
}
