import { SERVER_CONFIG } from "./config.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";

export const VOICE_MODEL_MODE_REALTIME_CALL_FAST = "realtime_call_fast";

export function resolveReplyVoiceModel({
  mode = "",
  languageCode = "",
  languageLabel = "",
  config = SERVER_CONFIG.elevenLabs,
} = {}) {
  const qualityModel = safeString(config?.qualityModel) || "eleven_v4_turbo";
  const fastModel = safeString(config?.fastModel) || "eleven_v4_turbo";
  const normalizedMode = safeString(mode);
  if (normalizedMode !== VOICE_MODEL_MODE_REALTIME_CALL_FAST) {
    return {
      model: qualityModel,
      reason: "quality_default",
      languageCode: normalizeCharacterLanguage(languageCode || languageLabel)?.code || safeString(languageCode),
    };
  }

  const language = normalizeCharacterLanguage(languageCode || languageLabel);
  if (fastModel === "eleven_v4_turbo") {
    return {
      model: fastModel,
      reason: "v4_turbo_realtime",
      languageCode: language?.code || safeString(languageCode),
      languageLabel: language?.label || safeString(languageLabel),
    };
  }
  if (!language) {
    return {
      model: qualityModel,
      reason: "unknown_language_fallback_v3",
      languageCode: safeString(languageCode),
    };
  }
  if (language.flashSupported) {
    return {
      model: fastModel,
      reason: "flash_supported",
      languageCode: language.code,
      languageLabel: language.label,
    };
  }
  return {
    model: qualityModel,
    reason: "flash_unsupported_fallback_v3",
    languageCode: language.code,
    languageLabel: language.label,
  };
}

export function resolveReplyVoiceMetaModel(voiceMeta = {}, {
  mode = "",
  fallbackLanguageCode = "",
  fallbackLanguageLabel = "",
} = {}) {
  const languageCode = voiceMeta?.languageCode || fallbackLanguageCode;
  const languageLabel = voiceMeta?.languageLabel || fallbackLanguageLabel;
  const decision = resolveReplyVoiceModel({
    mode,
    languageCode,
    languageLabel,
  });
  return {
    ...voiceMeta,
    model: decision.model,
  };
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
