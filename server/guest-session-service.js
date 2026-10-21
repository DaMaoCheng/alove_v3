import { createId, createToken, hashSessionToken } from "./security.js";
import { getDbPool, withTransaction } from "./db.js";
import { attachVoiceAssetToMessage, ensureOpeningMessageForSession } from "./chat-message-store.js";
import { createPublicError } from "./public-error-utils.js";
import { consumeGuestNetworkQuota } from "./guest-network-rate-limit-service.js";
import { generateReservedAiReplyVoiceAsset, reserveAiReplyVoiceAssetForDb } from "./chat-voice-asset-service.js";
import { resolveReplyVoiceModel } from "./chat-reply-voice-service.js";
import { GUEST_MESSAGE_LIMIT } from "./guest-message-quota-policy.js";
import { recordGuestLastAccess } from "./access-location-service.js";
import { ensureMascotGreetingImageMessageForSession } from "./mascot-greeting-image-service.js";
import { resolveInitialSessionLanguagePreference } from "./chat-language-preference-service.js";
import { resolveLocalizedCharacterOpeningLine } from "./character-localized-content-service.js";
import { buildExternalSourceContextFromHandoff, parseExternalSourceHandoffToken } from "./external-source-context-service.js";

export const GUEST_COOKIE_NAME = "aiove_guest_session";
export const GUEST_SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
export async function getOrCreateGuestSessionRecord({
  token = "",
  siteSlug = "",
  handoff = "",
  networkHash = "",
  access = null,
  recoverExistingGuest = async () => {},
} = {}) {
  const normalizedSiteSlug = String(siteSlug || "").trim().toLowerCase();
  const tokenHash = hashSessionToken(token);
  if (tokenHash) {
    const existing = await findGuestByToken(tokenHash, normalizedSiteSlug);
    if (existing) {
      const guestWithSourceContext = await applyExternalSourceHandoff(existing, handoff);
      if (access) await recordGuestLastAccess(getDbPool(), { guestSessionId: guestWithSourceContext.id, access });
      await retryGuestVoiceAssets(guestWithSourceContext.id);
      await recoverExistingGuest(guestWithSourceContext);
      return { guest: guestWithSourceContext, token, created: false };
    }
    throw createPublicError("Please start a new guest chat.", 401);
  }

  const result = await withTransaction(async (db) => {
    const site = await loadGuestEnabledSite(db, normalizedSiteSlug);
    await consumeGuestNetworkQuota(db, { networkHash, siteId: site.id, action: "session_create" });
    const character = await loadMascot(db, site);
    const externalSourceContext = resolveExternalSourceContext(handoff, {
      siteId: site.id,
      siteSlug: site.slug,
      mascotCharacterId: character.id,
    });
    const guestId = createId("guest");
    const nextToken = createToken();
    const sessionId = createId("chat");
    const initialLanguage = await resolveInitialSessionLanguagePreference(db, {
      character,
      siteLanguage: site.default_language,
    });
    await db.execute(
      `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, target_chat_session_id, external_source_context_json, last_ip, last_ip_region, last_ip_at, last_user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, CASE WHEN ? <> '' THEN NOW(3) ELSE NULL END, ?, DATE_ADD(NOW(3), INTERVAL 14 DAY))`,
      [guestId, hashSessionToken(nextToken), site.id, character.id, sessionId, externalSourceContext ? JSON.stringify(externalSourceContext) : null, String(access?.ip || "").trim() || null, String(access?.region || "").trim() || null, String(access?.ip || "").trim(), String(access?.userAgent || "").trim().slice(0, 500) || null]
    );
    await db.execute(
      `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
       VALUES (?, NULL, ?, ?, ?, 'active', 'guest', 'guest-chat', ?, NOW(3))`,
      [sessionId, guestId, character.id, `${character.name} conversation`, initialLanguage.label]
    );
    await db.execute(
      `INSERT INTO guest_character_sessions (
         guest_session_id, character_id, chat_session_id,
         message_window_started_at, message_window_count, rate_window_started_at, rate_window_count
       ) VALUES (?, ?, ?, NULL, 0, NULL, 0)`,
      [guestId, character.id, sessionId]
    );
    await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guestId]);
    const openingLine = resolveLocalizedCharacterOpeningLine(character, initialLanguage.label);
    const openingMessage = await ensureOpeningMessageForSession(db, {
      sessionId,
      guestSessionId: guestId,
      characterId: character.id,
      senderLabel: character.name,
      openingLine,
    });
    const openingVoice = openingMessage?.id ? await reserveAiReplyVoiceAssetForDb(db, {
      messageId: openingMessage.id,
      characterId: character.id,
      speechText: openingLine,
      voiceMeta: guestVoiceMeta(character, "", initialLanguage),
      deterministic: true,
    }) : null;
    if (openingVoice?.id) {
      await attachVoiceAssetToMessage(db, { messageId: openingMessage.id, voiceAssetId: openingVoice.id });
    }
    if (openingMessage?.id) {
      await ensureMascotGreetingImageMessageForSession(db, {
        sessionId,
        guestSessionId: guestId,
        character,
      });
    }
    return {
      guest: {
        id: guestId,
        site_id: site.id,
        site_slug: site.slug,
        site_default_language: initialLanguage.label,
        mascot_character_id: character.id,
        chat_session_id: sessionId,
        preferred_language: initialLanguage.label,
        session_status: "active",
        external_source_context_json: externalSourceContext ? JSON.stringify(externalSourceContext) : null,
        expires_at: new Date(Date.now() + GUEST_SESSION_MAX_AGE_SECONDS * 1000),
        character,
      },
      token: nextToken,
      openingVoiceAssetId: openingVoice?.id || "",
    };
  });
  if (result.openingVoiceAssetId) await generateGuestVoiceWithoutFailingText(result.openingVoiceAssetId);
  return { guest: result.guest, token: result.token, created: true };
}

export async function requireGuest(token) {
  return requireGuestForDb(getDbPool(), token);
}

// A browser guest identity is shared, while every eligible character gets an
// isolated chat session and quota window. The public character selector is
// validated server-side; callers must never trust a supplied character id.
export async function requireGuestCharacter(token, characterId = "") {
  const result = await withTransaction((db) => requireGuestCharacterForDb(db, token, { characterId, lock: true }));
  if (result.opening_voice_asset_id) await generateGuestVoiceWithoutFailingText(result.opening_voice_asset_id);
  return result;
}

export async function requireGuestCharacterForDb(db, token, { characterId = "", lock = false } = {}) {
  const rootGuest = await requireGuestForDb(db, token, { lock: true });
  const selectedCharacterId = String(characterId || rootGuest.mascot_character_id || "").trim();
  const character = await loadGuestCharacterForDb(db, {
    ...rootGuest,
    base_mascot_character_id: rootGuest.mascot_character_id,
    mascot_character_id: selectedCharacterId,
  });
  const [existingRows] = await db.execute(
    `SELECT * FROM guest_character_sessions
     WHERE guest_session_id = ? AND character_id = ?
     LIMIT 1 FOR UPDATE`,
    [rootGuest.id, character.id]
  );
  let characterSession = existingRows[0] || null;
  let openingVoiceAssetId = "";
  if (!characterSession) {
    const legacyMascotSession = character.id === rootGuest.mascot_character_id
      ? String(rootGuest.chat_session_id || "").trim()
      : "";
    const chatSessionId = legacyMascotSession || createId("chat");
    const initialLanguage = await resolveInitialSessionLanguagePreference(db, {
      character,
      siteLanguage: rootGuest.site_default_language,
    });
    if (!legacyMascotSession) {
      await db.execute(
        `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
         VALUES (?, NULL, ?, ?, ?, 'active', 'guest', 'guest-chat', ?, NOW(3))`,
        [chatSessionId, rootGuest.id, character.id, `${character.name} conversation`, initialLanguage.label]
      );
    }
    await db.execute(
      `INSERT INTO guest_character_sessions (
         guest_session_id, character_id, chat_session_id,
         message_window_started_at, message_window_count, rate_window_started_at, rate_window_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        rootGuest.id,
        character.id,
        chatSessionId,
        legacyMascotSession ? rootGuest.message_window_started_at : null,
        legacyMascotSession ? Number(rootGuest.message_window_count || 0) : 0,
        legacyMascotSession ? rootGuest.rate_window_started_at : null,
        legacyMascotSession ? Number(rootGuest.rate_window_count || 0) : 0,
      ]
    );
    if (!legacyMascotSession) {
      const openingLine = resolveLocalizedCharacterOpeningLine(character, initialLanguage.label);
      const openingMessage = await ensureOpeningMessageForSession(db, {
        sessionId: chatSessionId,
        guestSessionId: rootGuest.id,
        characterId: character.id,
        senderLabel: character.name,
        openingLine,
      });
      const openingVoice = openingMessage?.id ? await reserveAiReplyVoiceAssetForDb(db, {
        messageId: openingMessage.id,
        characterId: character.id,
        speechText: openingLine,
        voiceMeta: guestVoiceMeta(character, "", initialLanguage),
        deterministic: true,
      }) : null;
      if (openingVoice?.id) {
        await attachVoiceAssetToMessage(db, { messageId: openingMessage.id, voiceAssetId: openingVoice.id });
        openingVoiceAssetId = openingVoice.id;
      }
      if (openingMessage?.id) {
        await ensureMascotGreetingImageMessageForSession(db, {
          sessionId: chatSessionId,
          guestSessionId: rootGuest.id,
          character,
        });
      }
    }
    characterSession = {
      guest_session_id: rootGuest.id,
      character_id: character.id,
      chat_session_id: chatSessionId,
      message_window_started_at: legacyMascotSession ? rootGuest.message_window_started_at : null,
      message_window_count: legacyMascotSession ? Number(rootGuest.message_window_count || 0) : 0,
      rate_window_started_at: legacyMascotSession ? rootGuest.rate_window_started_at : null,
      rate_window_count: legacyMascotSession ? Number(rootGuest.rate_window_count || 0) : 0,
    };
  }
  const [[chatSession]] = await db.execute(
    "SELECT preferred_language FROM chat_sessions WHERE id = ? AND guest_session_id = ? LIMIT 1",
    [characterSession.chat_session_id, rootGuest.id]
  );
  return {
    ...rootGuest,
    mascot_character_id: character.id,
    chat_session_id: characterSession.chat_session_id,
    preferred_language: chatSession?.preferred_language || "",
    message_window_started_at: characterSession.message_window_started_at,
    message_window_count: Number(characterSession.message_window_count || 0),
    rate_window_started_at: characterSession.rate_window_started_at,
    rate_window_count: Number(characterSession.rate_window_count || 0),
    guest_character_session_id: `${rootGuest.id}:${character.id}`,
    quota_scope: "guest_character",
    opening_voice_asset_id: openingVoiceAssetId,
    character,
  };
}

export async function requireGuestForDb(db, token, { lock = false } = {}) {
  const tokenHash = hashSessionToken(token);
  if (!tokenHash) throw createPublicError("Please sign in or start a new chat.", 401);
  const [rows] = await db.execute(
    `SELECT g.*, s.slug AS site_slug, s.name AS site_name, COALESCE((SELECT ms.character_id FROM mascot_settings ms WHERE ms.site_id = s.id AND ms.setting_status = 'active' LIMIT 1), s.mascot_character_id) AS site_mascot_character_id, s.default_language AS site_default_language, NOW(3) AS db_now FROM guest_sessions g JOIN sites s ON s.id = g.site_id
     WHERE g.token_hash = ? AND g.session_status = 'active' AND g.expires_at > NOW(3) AND s.site_status = 'active' AND s.guest_chat_enabled = 1
     LIMIT 1 ${lock ? "FOR UPDATE" : ""}`,
    [tokenHash]
  );
  if (!rows[0]) throw createPublicError("Please sign in or start a new chat.", 401);
  return rows[0];
}

export async function findGuestByToken(tokenHash, siteSlug = "") {
  const normalizedSiteSlug = String(siteSlug || "").trim().toLowerCase();
  const siteFilter = normalizedSiteSlug ? "AND s.slug = ?" : "";
  const values = normalizedSiteSlug ? [tokenHash, normalizedSiteSlug] : [tokenHash];
  const [rows] = await getDbPool().execute(
    `SELECT g.*, s.slug AS site_slug, s.name AS site_name, COALESCE(ms.character_id, s.mascot_character_id) AS site_mascot_character_id, s.default_language AS site_default_language FROM guest_sessions g JOIN sites s ON s.id = g.site_id
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE g.token_hash = ? AND g.session_status = 'active' AND g.expires_at > NOW(3) AND s.site_status = 'active' AND s.guest_chat_enabled = 1
       ${siteFilter}
     LIMIT 1`,
    values
  );
  return rows[0] || null;
}

async function applyExternalSourceHandoff(guest, handoff) {
  const context = resolveExternalSourceContext(handoff, {
    siteId: guest.site_id,
    siteSlug: guest.site_slug,
    mascotCharacterId: guest.mascot_character_id,
  });
  if (!context) return guest;
  const serialized = JSON.stringify(context);
  await getDbPool().execute(
    "UPDATE guest_sessions SET external_source_context_json = ?, updated_at = NOW(3) WHERE id = ?",
    [serialized, guest.id]
  );
  return { ...guest, external_source_context_json: serialized };
}

function resolveExternalSourceContext(handoff, { siteId = "", siteSlug = "", mascotCharacterId = "" } = {}) {
  const parsed = parseExternalSourceHandoffToken(handoff);
  if (!parsed) return null;
  if (String(parsed.siteId || "") !== String(siteId || "")) return null;
  if (String(parsed.siteSlug || "").toLowerCase() !== String(siteSlug || "").toLowerCase()) return null;
  if (String(parsed.mascotCharacterId || "") !== String(mascotCharacterId || "")) return null;
  return buildExternalSourceContextFromHandoff(parsed);
}

export async function loadGuestCharacter(guest) {
  return loadGuestCharacterForDb(getDbPool(), guest);
}

export async function loadGuestCharacterForDb(db, guest) {
  const [rows] = await db.execute(
    `SELECT id, name, opening_line, localized_content, persona_prompt, speaking_style, role_title, short_bio, site_id, category_id, visibility, voice_provider, voice_id, profile_json, source_type, source_ref
     FROM ai_characters
     WHERE id = ?
       AND visibility = 'public'
       AND character_status = 'published'
       AND (category_id <> 'mascot' OR id = ?)
       AND (category_id <> 'creator' OR site_id = ?)
     LIMIT 1`,
    [guest.mascot_character_id, guest.base_mascot_character_id || guest.mascot_character_id, guest.site_id]
  );
  if (!rows[0]) throw createPublicError("Guest chat is unavailable.", 503);
  return rows[0];
}

export async function assertGuestBrowsingEnabled(siteSlug = "") {
  const [rows] = await getDbPool().execute(
    `SELECT id FROM sites
     WHERE slug = ? AND site_status = 'active' AND guest_chat_enabled = 1
     LIMIT 1`,
    [String(siteSlug || "").trim().toLowerCase()]
  );
  if (!rows[0]) throw createPublicError("Please sign in first.", 401);
  return rows[0];
}

export async function retryGuestVoiceAssets(guestSessionId) {
  const [rows] = await getDbPool().execute(
    `SELECT v.id
     FROM character_voice_assets v
     JOIN chat_messages m ON m.voice_asset_id = v.id
     WHERE m.guest_session_id = ?
       AND (
         v.asset_status = 'finalizing'
         OR (v.asset_status IN ('pending', 'failed', 'generating') AND v.retry_count < 2)
       )
     ORDER BY v.created_at ASC
     LIMIT 3`,
    [guestSessionId]
  );
  for (const row of rows) await generateGuestVoiceWithoutFailingText(row.id);
}

export async function generateGuestVoiceWithoutFailingText(assetId) {
  try {
    return await generateReservedAiReplyVoiceAsset({ assetId });
  } catch (error) {
    console.warn("[aiove] guest AI voice generation failed after text commit:", error.message);
    return null;
  }
}

export function guestVoiceMeta(character = {}, voiceModelMode = "", providerMeta = null) {
  const profile = parseJsonObject(character.profile_json);
  const languageCode = providerMeta?.languageCode || providerMeta?.code || profile.defaultLanguageCode || profile.languageCode || "en";
  const languageLabel = providerMeta?.languageLabel || providerMeta?.label || profile.defaultLanguageLabel || profile.languageLabel || profile.language || "English";
  return {
    ...(providerMeta || {}),
    provider: providerMeta?.provider || character.voice_provider || "elevenlabs",
    model: resolveReplyVoiceModel({ mode: voiceModelMode, languageCode, languageLabel }).model,
    voiceId: providerMeta?.voiceId || character.voice_id || "",
    languageCode,
    languageLabel,
  };
}

export function guestSessionForImage(guest = {}) {
  return {
    id: guest.chat_session_id || "",
    internal_uid: null,
    guest_session_id: guest.id || "",
    character_id: guest.mascot_character_id || "",
    preferred_language: guest.preferred_language || guest.site_default_language || "",
  };
}

export function mapGuest(guest) {
  const windowStartedAt = new Date(guest.message_window_started_at || 0).getTime();
  const windowExpired = !windowStartedAt || Date.now() - windowStartedAt >= 24 * 60 * 60 * 1000;
  return {
    siteSlug: guest.site_slug || "",
    mascotCharacterId: guest.mascot_character_id || "",
    messageLimit: GUEST_MESSAGE_LIMIT,
    messageCount: windowExpired ? 0 : Number(guest.message_window_count || 0),
    messageWindowResetsAt: windowExpired ? "" : new Date(windowStartedAt + 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function loadGuestEnabledSite(db, slug) {
  const [rows] = await db.execute(
    `SELECT s.*, COALESCE(ms.character_id, s.mascot_character_id) AS mascot_character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = ? AND s.site_status = 'active' AND s.guest_chat_enabled = 1 LIMIT 1`,
    [String(slug || "").trim().toLowerCase()]
  );
  if (!rows[0]) throw createPublicError("Guest chat is not available for this site.", 403);
  return rows[0];
}

async function loadMascot(db, site) {
  const [rows] = await db.execute("SELECT id, name, opening_line, localized_content, persona_prompt, speaking_style, role_title, short_bio, site_id, category_id, voice_provider, voice_id, profile_json, source_type, source_ref FROM ai_characters WHERE id = ? AND category_id = 'mascot' AND character_status = 'published' LIMIT 1", [site.mascot_character_id]);
  if (!rows[0]) throw createPublicError("Guest chat is unavailable.", 503);
  return rows[0];
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
