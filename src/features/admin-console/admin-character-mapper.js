import { normalizeCharacterStatus } from "./admin-character-status.js";
import { getElevenLabsVoicePreset } from "../../config/voice-presets.js";

export const ADMIN_CHARACTER_CREATOR = Object.freeze({
  nickname: "Admin",
  account: "admin@aiove.local",
});

export function mapAdminCharacterForConsole(character = {}) {
  const profile = character.profile || {};
  const categoryId = character.category?.id || character.categoryId || character.category || "";
  const categoryLabel = character.category?.label || labelForCategory(categoryId);
  const creator = resolveConsoleCharacterCreator(character, categoryId);
  return {
    id: character.id || "",
    name: character.name || "",
    roleTitle: character.roleTitle || "",
    ownerUid: character.ownerUid || "",
    ownerAccount: character.ownerEmail || "",
    creator,
    category: categoryLabel,
    categoryId,
    shortBio: character.shortBio || "",
    personality: character.speakingStyle || profile.style || "Calm mentor",
    voice: character.voiceStyle || "Warm & friendly",
    voiceProvider: character.voiceProvider || "",
    voiceId: character.voiceId || "",
    language: character.language || profile.language || "",
    visibility: character.visibility || "public",
    openingLine: character.openingLine || "",
    backstory: character.personaPrompt || "",
    personaPrompt: character.personaPrompt || "",
    speakingStyle: character.speakingStyle || "",
    siteId: character.siteId || "",
    siteName: character.siteName || "未绑定站点",
    avatarUrl: character.avatarUrl || "",
    status: normalizeCharacterStatus(character.characterStatus || character.status),
    chats: character.metrics?.chatCountLabel || "0",
    revenue: "-",
  };
}

function resolveConsoleCharacterCreator(character, categoryId) {
  if (character.ownerNickname || character.ownerEmail) {
    return {
      nickname: character.ownerNickname || ADMIN_CHARACTER_CREATOR.nickname,
      account: character.ownerEmail || ADMIN_CHARACTER_CREATOR.account,
    };
  }
  if (categoryId && categoryId !== "creator" && categoryId !== "mascot") {
    return ADMIN_CHARACTER_CREATOR;
  }
  if (character.sourceType === "system") {
    return {
      nickname: "System",
      account: "system",
    };
  }
  return {
    nickname: "-",
    account: "-",
  };
}

export function mapConsoleCharacterPayload(data, { mode = "common" } = {}) {
  const voiceValue = data.get("voice") || "";
  const voicePreset = getElevenLabsVoicePreset(voiceValue);
  return {
    avatarUrl: data.get("avatarUrl") || "",
    avatarTouched: data.get("avatarTouched") === "1",
    name: data.get("name") || "",
    roleTitle: data.get("roleTitle") || "",
    category: mode === "creator" ? "creator" : data.get("category") || "companion",
    characterStatus: normalizeCharacterStatus(data.get("status")),
    visibility: data.get("visibility") || "public",
    ownerUid: mode === "creator" ? data.get("ownerUid") || "" : "",
    siteId: mode === "creator" ? data.get("siteId") || "" : "",
    shortBio: data.get("shortBio") || "",
    personality: data.get("personality") || "",
    voiceProvider: voicePreset?.provider || data.get("voiceProvider") || "",
    voiceStyle: voicePreset?.label || voiceValue,
    voiceId: voicePreset?.voiceId || data.get("voiceId") || "",
    voiceSampleUrl: voicePreset?.sampleUrl || data.get("voiceSampleUrl") || "",
    language: data.get("language") || "",
    languageCode: data.get("languageCode") || "",
    openingLine: data.get("openingLine") || "",
    backstory: data.get("backstory") || "",
  };
}

export function labelForCategory(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const labels = {
    football_babe: "Football Babe",
    creator: "Creator",
    pundit: "Pundit",
    fan: "Fan",
    companion: "Companion",
  };
  return labels[normalized] || value || "未分类";
}

export function categoryIdForLabel(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  const ids = {
    "football babe": "football_babe",
    creator: "creator",
    pundit: "pundit",
    fan: "fan",
    companion: "companion",
  };
  return ids[normalized] || normalized || "companion";
}
