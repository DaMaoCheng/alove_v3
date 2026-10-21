import { getElevenLabsVoicePreset } from "../../../shared/voice-presets.js?v=20260625";
import { findCharacterLanguage } from "../../config/language-library.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

const ALLOWED_VIBES = new Set([
  "Hype & loud",
  "Calm mentor",
  "Cheeky banter",
  "Tactical nerd",
  "Old-school",
]);

const ALLOWED_CATEGORIES = new Set([
  "football_babe",
  "creator",
  "pundit",
  "fan",
  "companion",
]);

export function validateCreateCharacterPayload(payload = {}, { pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  const name = safeString(payload.name).slice(0, 96);
  if (!name) return copy.t("create.validationName");

  const categoryId = normalizeCategoryId(payload.categoryId || payload.category);
  if (!ALLOWED_CATEGORIES.has(categoryId)) return copy.t("create.validationCategory");

  const vibe = safeString(payload.vibe || payload.personality);
  if (!ALLOWED_VIBES.has(vibe)) return copy.t("create.validationPersonality");

  const voice = safeString(payload.voice || payload.voiceStyle);
  if (!getElevenLabsVoicePreset(voice)) return copy.t("create.validationVoice");

  if (!findCharacterLanguage(payload.languageCode || payload.language)) return copy.t("create.validationLanguage");

  const openingLine = safeString(payload.openingLine).slice(0, 512);
  if (!openingLine) return copy.t("create.validationOpening");

  const backstory = safeString(payload.backstory).slice(0, 4000);
  if (!backstory) return copy.t("create.validationBackstory");
  if (backstory.length < 20) return copy.t("create.validationBackstoryShort");

  return "";
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeCategoryId(value) {
  const normalized = safeString(value).toLowerCase();
  return {
    babe: "football_babe",
    football_babe: "football_babe",
    creator: "creator",
    pundit: "pundit",
    fan: "fan",
    companion: "companion",
  }[normalized] || normalized;
}
