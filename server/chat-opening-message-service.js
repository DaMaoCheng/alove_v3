import { createAiReplyVoiceAssetForDb } from "./chat-voice-asset-service.js";
import { attachVoiceAssetToMessage, ensureOpeningMessageForSession } from "./chat-message-store.js";
import { resolveReplyVoiceModel } from "./chat-reply-voice-service.js";
import { ensureMascotGreetingImageMessageForSession } from "./mascot-greeting-image-service.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";
import { resolveLocalizedCharacterOpeningLine } from "./character-localized-content-service.js";

export async function ensureOpeningMessageWithVoiceForSession(db, {
  sessionId = "",
  character = {},
  characterId = "",
  senderLabel = "",
  openingLine = "",
  userId = "",
  guestSessionId = "",
  preferredLanguage = "",
  generateVoiceAudio = null,
} = {}) {
  const normalizedSessionId = safeString(sessionId);
  const normalizedCharacterId = safeString(characterId || character.id || character.character_id);
  const canonicalOpeningLine = safeString(character.opening_line || character.openingLine);
  const normalizedOpeningLine = safeString(
    openingLine && openingLine !== canonicalOpeningLine
      ? openingLine
      : resolveLocalizedCharacterOpeningLine(character, preferredLanguage)
  );
  if (!normalizedSessionId || !normalizedOpeningLine) return null;

  if (String(character?.category_id || character?.categoryId || "").trim() === "mascot") {
    await ensureMascotGreetingImageMessageForSession(db, {
      sessionId: normalizedSessionId,
      guestSessionId: safeString(guestSessionId),
      character: { ...character, id: normalizedCharacterId },
    });
  }
  const inserted = await ensureOpeningMessageForSession(db, {
    sessionId: normalizedSessionId,
    guestSessionId: safeString(guestSessionId),
    characterId: normalizedCharacterId,
    senderLabel: senderLabel || character.name,
    openingLine: normalizedOpeningLine,
  });
  const openingMessage = inserted || await findOpeningMessageNeedingVoice(db, normalizedSessionId);
  if (!openingMessage?.id) return openingMessage || null;

  // Only a newly inserted opening receives a gallery photo. Old sessions stay
  // unchanged and reloading a session never re-randomizes its greeting.
  if (openingMessage.voiceAssetId) return openingMessage;

  const voiceAsset = await createAiReplyVoiceAssetForDb(db, {
    messageId: openingMessage.id,
    characterId: normalizedCharacterId,
    userId,
    speechText: normalizedOpeningLine,
    voiceMeta: buildOpeningVoiceMeta(character, preferredLanguage),
    generateAudio: generateVoiceAudio,
  });
  await attachVoiceAssetToMessage(db, {
    messageId: openingMessage.id,
    voiceAssetId: voiceAsset.id,
  });
  return {
    ...openingMessage,
    voiceAssetId: voiceAsset.id,
  };
}

async function findOpeningMessageNeedingVoice(db, sessionId) {
  const [rows] = await db.execute(
    `SELECT id, voice_asset_id AS voiceAssetId
     FROM chat_messages
     WHERE session_id = ?
       AND content_type = 'text'
       AND sender_type = 'character'
       AND source_ref = 'opening-line'
     ORDER BY display_order ASC, sent_at ASC
     LIMIT 1`,
    [sessionId]
  );
  return rows[0] || null;
}

function buildOpeningVoiceMeta(character = {}, preferredLanguage = "") {
  const profile = parseJsonObject(character.profile_json || character.profileJson || character.profile);
  const normalizedPreferredLanguage = normalizeCharacterLanguage(preferredLanguage);
  const languageCode = normalizedPreferredLanguage?.code || safeString(profile.defaultLanguageCode || profile.languageCode || "en") || "en";
  const languageLabel = normalizedPreferredLanguage?.label || safeString(profile.defaultLanguageLabel || profile.languageLabel || profile.language || "English") || "English";
  const modelDecision = resolveReplyVoiceModel({ languageCode, languageLabel });
  return {
    provider: safeString(character.voice_provider || character.voiceProvider || "elevenlabs") || "elevenlabs",
    model: modelDecision.model,
    voiceId: safeString(character.voice_id || character.voiceId),
    languageCode,
    languageLabel,
  };
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
