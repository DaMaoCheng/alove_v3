import { hashSessionToken } from "./security.js";
import { getDbPool } from "./db.js";
import { getMessagesForSession } from "./chat-message-store.js";
import { createPublicError } from "./public-error-utils.js";
import { normalizeMessageText } from "./chat-message-payload-utils.js";
import { VOICE_MODEL_MODE_REALTIME_CALL_FAST } from "./chat-reply-voice-service.js";
import { listPendingGuestAttachments } from "./guest-chat-attachment-service.js";
import { acquireDedicatedDbAdvisoryLock } from "./db-advisory-lock-service.js";
import {
  GUEST_COOKIE_NAME,
  GUEST_SESSION_MAX_AGE_SECONDS,
  assertGuestBrowsingEnabled,
  generateGuestVoiceWithoutFailingText,
  getOrCreateGuestSessionRecord,
  mapGuest,
  requireGuest,
  requireGuestCharacter,
  retryGuestVoiceAssets,
} from "./guest-session-service.js";
import { persistGuestTurn } from "./guest-turn-service.js";
import { ensureGuestReply, prepareStoredGuestReply } from "./guest-reply-service.js";
import { PRODUCT_CLARIFICATION_SOURCE_MARKER } from "./product-search-decision-service.js";
import { recordGuestLastAccess } from "./access-location-service.js";
import { getGuestImageEntitlement } from "./guest-image-entitlement-service.js";

export { GUEST_COOKIE_NAME, GUEST_SESSION_MAX_AGE_SECONDS, assertGuestBrowsingEnabled, requireGuest, requireGuestCharacter, retryGuestVoiceAssets };

export async function getOrCreateGuestSession({ token = "", siteSlug = "", handoff = "", networkHash = "", access = null } = {}) {
  return getOrCreateGuestSessionRecord({
    token,
    siteSlug,
    handoff,
    networkHash,
    access,
    recoverExistingGuest: (guest) => recoverPendingGuestVoiceReply(token, guest),
  });
}

export async function getGuestConversation(token, { characterId = "", skipRecovery = false, networkHash = "" } = {}) {
  const guest = await requireGuestCharacter(token, characterId);
  if (!skipRecovery) await recoverPendingGuestVoiceReply(token, guest);
  const [rows] = await getDbPool().execute("SELECT * FROM chat_sessions WHERE id = ? AND guest_session_id = ? LIMIT 1", [guest.chat_session_id, guest.id]);
  if (!rows[0]) throw createPublicError("Guest conversation is unavailable.", 404);
  const payload = await getMessagesForSession(rows[0]);
  const pendingAttachments = await listPendingGuestAttachments(getDbPool(), guest.id, guest.mascot_character_id);
  const contacts = await listGuestConversationContacts(guest.id);
  const imageQuota = await getGuestImageEntitlement(getDbPool(), guest.id, {
    siteId: guest.site_id,
    networkHash,
  });
  return { ...payload, guest: { ...mapGuest(guest), imageQuota, pendingAttachments, contacts } };
}

async function listGuestConversationContacts(guestSessionId) {
  const [rows] = await getDbPool().execute(
    `SELECT session.character_id AS character_id, character_record.name, character_record.avatar_url,
            MAX(message.sent_at) AS last_message_at
       FROM chat_sessions session
       INNER JOIN chat_messages message
         ON message.session_id = session.id
        AND message.sender_type = 'user'
       INNER JOIN ai_characters character_record ON character_record.id = session.character_id
      WHERE session.guest_session_id = ?
      GROUP BY session.character_id, character_record.name, character_record.avatar_url
      ORDER BY last_message_at DESC, session.character_id ASC`,
    [guestSessionId]
  );
  return rows.map((row) => ({
    id: String(row.character_id || ""),
    name: String(row.name || ""),
    avatarUrl: String(row.avatar_url || ""),
  })).filter((row) => row.id);
}

export async function sendGuestMessage({ token, characterId = "", text, attachments = [], clientMessageId, networkHash = "", access = null, deferReply = false, sourceRef = "guest-input", networkQuotaReserved = false, reservedVoiceRequestKey = "", skipMessageQuota = false, skipRateQuota = false, includeRequestMeta = false, replyLockHeld = false, callContext = null }) {
  const hasText = String(text || "").trim().length > 0;
  const normalizedText = hasText ? normalizeMessageText(text) : "";
  const attachmentIds = Array.isArray(attachments) ? attachments : [];
  if (!normalizedText && !attachmentIds.length) throw createPublicError("Please enter a message.", 400);
  const requestKey = String(clientMessageId || "").trim().slice(0, 128);
  if (!requestKey) throw createPublicError("Please enter a message.", 400);
  const initialGuest = await requireGuestCharacter(token, characterId);
  if (access) await recordGuestLastAccess(getDbPool(), { guestSessionId: initialGuest.id, access });
  const releaseLock = replyLockHeld ? async () => {} : await acquireGuestReplyLock(initialGuest.id);
  let voiceAssetId = "";
  let requestDuplicate = false;
  try {
    const prepared = await persistGuestTurn({
      token,
      normalizedText,
      attachmentIds,
      requestKey,
      networkHash,
      sourceRef,
      networkQuotaReserved,
      reservedVoiceRequestKey,
      skipMessageQuota,
      skipRateQuota,
      callContext,
      characterId: initialGuest.mascot_character_id,
    });
    requestDuplicate = Boolean(prepared?.duplicate);
    if (!deferReply) voiceAssetId = await ensureGuestReply({ token, prepared });
  } finally {
    await releaseLock();
  }
  if (voiceAssetId) await generateGuestVoiceWithoutFailingText(voiceAssetId);
  const conversation = await getGuestConversation(token, { characterId: initialGuest.mascot_character_id, skipRecovery: true, networkHash });
  return includeRequestMeta ? { ...conversation, requestDuplicate } : conversation;
}

export async function sendGuestReplyForMessage({ token, characterId = "", messageId, expectedSourceRef = "voice-asr", voiceModelMode = "", networkHash = "", replyLockHeld = false }) {
  const normalizedMessageId = String(messageId || "").trim();
  const normalizedSourceRef = expectedSourceRef === "guest-call" ? "guest-call" : "voice-asr";
  if (!normalizedMessageId) throw createPublicError("Guest message not found.", 404);
  const initialGuest = await requireGuestCharacter(token, characterId);
  const releaseLock = replyLockHeld ? async () => {} : await acquireGuestReplyLock(initialGuest.id);
  let voiceAssetId = "";
  try {
    const prepared = await prepareStoredGuestReply({
      token,
      messageId: normalizedMessageId,
      expectedSourceRef: normalizedSourceRef,
      characterId: initialGuest.mascot_character_id,
      networkHash,
    });
    voiceAssetId = await ensureGuestReply({
      token,
      prepared,
      voiceModelMode,
    });
  } finally {
    await releaseLock();
  }
  if (voiceAssetId) await generateGuestVoiceWithoutFailingText(voiceAssetId);
  return getGuestConversation(token, { characterId: initialGuest.mascot_character_id, skipRecovery: true, networkHash });
}

export async function createGuestCallMessage({ token, characterId = "", text, callSessionId, turnId, leaseToken, replyLockHeld = false }) {
  const normalizedCallSessionId = String(callSessionId || "").trim();
  const normalizedTurnId = Number(turnId || 0);
  if (!/^call_[a-zA-Z0-9-]+$/.test(normalizedCallSessionId) || !Number.isSafeInteger(normalizedTurnId) || normalizedTurnId <= 0) {
    throw createPublicError("Guest call turn is unavailable.", 400);
  }
  const clientMessageId = `guest-call:${normalizedCallSessionId}:${normalizedTurnId}`.slice(0, 128);
  const conversation = await sendGuestMessage({
    token,
    characterId,
    text,
    clientMessageId,
    deferReply: true,
    sourceRef: "guest-call",
    networkQuotaReserved: true,
    skipRateQuota: true,
    includeRequestMeta: true,
    replyLockHeld,
    callContext: { callSessionId: normalizedCallSessionId, leaseToken },
  });
  const guest = await requireGuestCharacter(token, characterId);
  const [rows] = await getDbPool().execute(
    `SELECT id, display_order
     FROM chat_messages
     WHERE session_id = ? AND guest_session_id = ? AND sender_type = 'user'
       AND content_type = 'text' AND source_ref = 'guest-call' AND client_message_id = ?
     LIMIT 1`,
    [guest.chat_session_id, guest.id, clientMessageId]
  );
  const userMessage = rows[0] || null;
  if (!userMessage) throw createPublicError("Guest call turn is unavailable.", 409);
  const items = (Array.isArray(conversation.items) ? conversation.items : [])
    .filter((item) => item.id === userMessage.id);
  return {
    ok: true,
    session: conversation.session || null,
    items,
    callUserMessageId: userMessage.id,
    guest: conversation.guest || null,
    duplicate: Boolean(conversation.requestDuplicate),
  };
}

export async function createGuestCallReply({ token, characterId = "", messageId, voiceModelMode = "", replyLockHeld = false }) {
  const guest = await requireGuestCharacter(token, characterId);
  const [rows] = await getDbPool().execute(
    `SELECT id, display_order
     FROM chat_messages
     WHERE id = ? AND session_id = ? AND guest_session_id = ? AND sender_type = 'user'
       AND content_type = 'text' AND source_ref = 'guest-call' AND client_message_id IS NOT NULL
     LIMIT 1`,
    [String(messageId || "").trim(), guest.chat_session_id, guest.id]
  );
  const userMessage = rows[0] || null;
  if (!userMessage) throw createPublicError("Guest call turn is unavailable.", 409);
  const conversation = await sendGuestReplyForMessage({
    token,
    characterId,
    messageId: userMessage.id,
    expectedSourceRef: "guest-call",
    voiceModelMode,
    replyLockHeld,
  });
  const items = (Array.isArray(conversation.items) ? conversation.items : [])
    .filter((item) => Number(item.displayOrder || 0) >= Number(userMessage.display_order || 0));
  return {
    ok: true,
    session: conversation.session || null,
    items: items.filter((item) => item.id !== userMessage.id),
  };
}

export async function acquireGuestReplyLockForToken(token) {
  const tokenHash = hashSessionToken(token);
  if (!tokenHash) return async () => {};
  const [rows] = await getDbPool().execute(
    "SELECT id FROM guest_sessions WHERE token_hash = ? LIMIT 1",
    [tokenHash]
  );
  if (!rows[0]?.id) return async () => {};
  const releaseLock = await acquireGuestReplyLock(rows[0].id);
  return async () => {
    await releaseLock().catch((error) => {
      console.warn("[aiove] guest reply lock release failed after auth:", error.message);
    });
  };
}

async function recoverPendingGuestVoiceReply(token, guest) {
  const [rows] = await getDbPool().execute(
    `SELECT m.id, m.source_ref
     FROM chat_messages m
     LEFT JOIN chat_messages reply
       ON reply.session_id = m.session_id AND reply.sender_type = 'character' AND reply.content_type = 'text'
         AND reply.source_ref IN (CONCAT('guest-reply:', m.id), CONCAT('guest-reply:', m.id, ?))
     WHERE m.session_id = ? AND m.guest_session_id = ? AND m.sender_type = 'user'
       AND m.content_type = 'text' AND m.source_ref IN ('voice-asr', 'guest-call') AND m.client_message_id IS NOT NULL
       AND reply.id IS NULL
     ORDER BY m.display_order ASC LIMIT 3`,
    [`:${PRODUCT_CLARIFICATION_SOURCE_MARKER}`, guest.chat_session_id, guest.id]
  );
  let recovered = null;
  for (const row of rows) {
    try {
      recovered = await sendGuestReplyForMessage({
        token,
      characterId: guest.mascot_character_id,
      messageId: row.id,
        expectedSourceRef: row.source_ref,
        voiceModelMode: row.source_ref === "guest-call" ? VOICE_MODEL_MODE_REALTIME_CALL_FAST : "",
      });
    } catch (error) {
      console.warn("[aiove] pending guest voice reply recovery failed:", error.message);
    }
  }
  return recovered;
}

async function acquireGuestReplyLock(guestId) {
  const lockName = `guest_reply:${String(guestId || "")}`.slice(0, 64);
  return acquireDedicatedDbAdvisoryLock(lockName, 30);
}
