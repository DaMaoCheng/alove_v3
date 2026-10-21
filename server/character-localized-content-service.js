import { normalizeCharacterLanguage } from "../shared/language-library.js";

export function resolveLocalizedCharacterOpeningLine(character = {}, preferredLanguage = "") {
  const canonicalOpeningLine = safeString(character?.opening_line || character?.openingLine);
  const languageCode = normalizeCharacterLanguage(preferredLanguage)?.code || "";
  if (!languageCode) return canonicalOpeningLine;

  const localizedContent = parseJsonObject(character?.localized_content || character?.localizedContent);
  const localizedOpeningLine = safeString(localizedContent?.translations?.[languageCode]?.openingLine);
  return localizedOpeningLine || canonicalOpeningLine;
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
