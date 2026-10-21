import { getDbPool } from "./db.js";
import { upsertPersonaLanguageSetting } from "./chat-language-preference-service.js";
import { getElevenLabsVoicePreset } from "../shared/voice-presets.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";

export function normalizeAdminCharacterPayload(payload, current = {}) {
  const name = safeString(payload.name).slice(0, 96);
  if (!name) {
    const error = new Error("角色名称不能为空");
    error.statusCode = 400;
    throw error;
  }

  return {
    name,
    categoryId: normalizeCategoryId(payload.categoryId || payload.category),
    siteId: normalizeSiteId(payload.siteId ?? payload.site_id ?? current.site_id),
    ownerUid: normalizeSiteId(payload.ownerUid ?? payload.owner_uid ?? current.owner_uid),
    roleTitle: buildRoleTitle(payload, current),
    shortBio: buildShortBio(payload, current),
    avatarUrl: safeString(payload.avatarUrl).slice(0, 512),
    openingLine: safeString(payload.openingLine).slice(0, 512),
    personaPrompt: buildAdminPersonaPrompt(payload, current),
    speakingStyle: safeString(payload.personality || payload.speakingStyle).slice(0, 2000),
    voiceProvider: safeString(payload.voiceProvider || current.voice_provider).slice(0, 64),
    voiceId: safeString(payload.voiceId || current.voice_id).slice(0, 128),
    voiceStyle: safeString(payload.voiceStyle).slice(0, 128),
    voiceSampleUrl: safeString(payload.voiceSampleUrl || current.voice_sample_url).slice(0, 512),
    profileJson: buildAdminProfileJson(payload, current),
    visibility: normalizeOneOf(payload.visibility, ["public", "private"], "public"),
    characterStatus: normalizeOneOf(payload.characterStatus || payload.status, ["draft", "published", "archived"], "draft"),
  };
}

export function normalizeCreateCharacterPayload(payload) {
  const name = safeString(payload.name).slice(0, 96);
  if (!name) {
    const error = new Error("角色名称不能为空");
    error.statusCode = 400;
    throw error;
  }

  const openingLine = safeString(payload.openingLine).slice(0, 512);
  if (!openingLine) {
    const error = new Error("开场白不能为空");
    error.statusCode = 400;
    throw error;
  }

  const backstory = safeString(payload.backstory).slice(0, 4000);
  if (!backstory) {
    const error = new Error("背景故事不能为空");
    error.statusCode = 400;
    throw error;
  }

  const categoryId = normalizeCreateCategoryId(payload.categoryId || payload.category);
  const categoryLabel = labelForCategory(categoryId);
  const personality = requireCreateOption(payload.personality || payload.vibe, [
    "Hype & loud",
    "Calm mentor",
    "Cheeky banter",
    "Tactical nerd",
    "Old-school",
  ], "请选择角色性格");
  const voicePreset = requireCreateVoicePreset(payload.voiceStyle || payload.voice);
  const language = requireCreateLanguage(payload.languageCode || payload.language);
  const visibility = normalizeOneOf(payload.visibility, ["public", "private"], "private");
  const profileJson = JSON.stringify({
    category: categoryLabel,
    style: personality,
    language: language.label,
    languageCode: language.code,
    languageLabel: language.label,
    defaultLanguageCode: language.code,
    defaultLanguageLabel: language.label,
    languageFlashSupported: language.flashSupported,
    languageV3Supported: language.v3Supported,
  });

  return {
    name,
    categoryId,
    categoryLabel,
    personality,
    voice: voicePreset.label,
    language: language.label,
    languageCode: language.code,
    languageLabel: language.label,
    languageFlashSupported: language.flashSupported,
    languageV3Supported: language.v3Supported,
    visibility,
    voiceProvider: voicePreset.provider,
    voiceId: voicePreset.voiceId,
    voiceSampleUrl: voicePreset.sampleUrl,
    avatarUrl: normalizeCharacterAvatarUrl(payload.avatarUrl, categoryId),
    openingLine,
    backstory,
    profileJson,
  };
}

export async function createUniqueSlug(name) {
  const base = slugify(name) || "character";
  let candidate = base;

  for (let index = 0; index < 20; index += 1) {
    const [rows] = await getDbPool().execute(
      "SELECT id FROM ai_characters WHERE slug = ? LIMIT 1",
      [candidate]
    );
    if (!rows.length) return candidate;
    candidate = `${base}-${index + 2}`;
  }

  return `${base}-${Date.now()}`;
}

export function normalizeCategoryId(value) {
  const normalized = safeString(value).toLowerCase();
  const aliases = {
    babe: "football_babe",
    football_babe: "football_babe",
    creator: "creator",
    pundit: "pundit",
    fan: "fan",
    companion: "companion",
  };
  return aliases[normalized] || "football_babe";
}

export function labelForCategory(value) {
  const labels = {
    football_babe: "Football Babe",
    creator: "Creator",
    pundit: "Pundit",
    fan: "Fan",
    companion: "Companion",
  };
  return labels[normalizeCategoryId(value)] || "Football Babe";
}

function buildRoleTitle(payload, current = {}) {
  const explicitRoleTitle = safeString(payload.roleTitle);
  if (explicitRoleTitle) return explicitRoleTitle.slice(0, 128);
  return safeString(current.role_title).slice(0, 128);
}

function buildShortBio(payload, current = {}) {
  const explicitBio = safeString(payload.shortBio);
  if (explicitBio) return explicitBio.slice(0, 255);
  if (!Object.prototype.hasOwnProperty.call(payload, "shortBio")) return safeString(current.short_bio || current.shortBio).slice(0, 255);
  return safeString(current.short_bio).slice(0, 255);
}

function buildAdminPersonaPrompt(payload, current = {}) {
  const rawPrompt = safeString(payload.backstory || payload.personaPrompt || current.persona_prompt).slice(0, 4000);
  const language = safeString(payload.language || parseJsonObject(current.profile_json).language).slice(0, 128);
  return upsertPersonaLanguageSetting(rawPrompt, language).slice(0, 4000);
}

function buildAdminProfileJson(payload, current = {}) {
  const profile = parseJsonObject(current.profile_json);
  const language = safeString(payload.language || profile.language).slice(0, 128);
  const languageCode = safeString(payload.languageCode || profile.languageCode || profile.defaultLanguageCode).slice(0, 32);
  const style = safeString(payload.personality || payload.speakingStyle || profile.style).slice(0, 128);
  return JSON.stringify({
    ...profile,
    ...(language ? { language } : {}),
    ...(languageCode ? { languageCode, defaultLanguageCode: languageCode } : {}),
    ...(language ? { languageLabel: language, defaultLanguageLabel: language } : {}),
    ...(style ? { style } : {}),
  });
}

function normalizeCreateOption(value, allowed, fallback) {
  const normalized = safeString(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

function requireCreateOption(value, allowed, message) {
  const normalized = safeString(value);
  if (allowed.includes(normalized)) return normalized;

  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function requireCreateVoicePreset(value) {
  const preset = getElevenLabsVoicePreset(value);
  if (preset) return preset;

  const error = new Error("请选择角色声音");
  error.statusCode = 400;
  throw error;
}

function requireCreateLanguage(value) {
  const language = normalizeCharacterLanguage(value);
  if (language) return language;

  const error = new Error("请选择有效语言");
  error.statusCode = 400;
  throw error;
}

function normalizeCreateCategoryId(value) {
  const normalized = safeString(value).toLowerCase();
  const aliases = {
    babe: "football_babe",
    football_babe: "football_babe",
    creator: "creator",
    pundit: "pundit",
    fan: "fan",
    companion: "companion",
  };
  const categoryId = aliases[normalized] || "";
  if (categoryId) return categoryId;

  const error = new Error("请选择角色分类");
  error.statusCode = 400;
  throw error;
}

function normalizeCharacterAvatarUrl(value) {
  const normalized = safeString(value).slice(0, 512);
  if (!normalized) return "";
  if (
    normalized.startsWith("/uploads/avatars/") ||
    normalized.startsWith("assets/")
  ) {
    return normalized;
  }

  const error = new Error("头像地址无效，请重新上传头像");
  error.statusCode = 400;
  throw error;
}

function normalizeOneOf(value, allowed, fallback) {
  const normalized = safeString(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeSiteId(value) {
  return safeString(value).slice(0, 64) || null;
}

function slugify(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
