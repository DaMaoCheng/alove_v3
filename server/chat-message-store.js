import { mergeProductCandidatePayload, stripProductCandidatePayload } from "./product-candidate-state-service.js";
import { getDbPool } from "./db.js";
import { createId } from "./security.js";
import { buildAttachmentSummary, parseJsonValue, throwNotFound } from "./chat-message-payload-utils.js";
import { mapSessionRow } from "./chat-session-service.js";
import { normalizeChatAttachmentForClient, toProtectedChatImageUrl, toProtectedVoiceUrl } from "./protected-upload-url-service.js";
import { toClientProduct } from "./product-response-sanitizer.js";
import { resolveEncodedAudioDurationSeconds } from "./encoded-audio-duration-service.js";
import { CHAT_RETENTION_DAYS } from "./chat-retention-policy.js";
import { mergeProductRequestPayload, stripProductRequestPayload } from "./product-request-scope-service.js";
import { mergeReplyRecoveryPayload, readReplyRecoveryState, stripReplyRecoveryPayload } from "./chat-reply-recovery-state.js";

export async function getMessagesForSession(session, { retentionDays = null } = {}) {
  const effectiveRetentionDays = resolveVisibleMessageRetentionDays(session, retentionDays);
  const messages = await listMessagesForSession(session.id, { retentionDays: effectiveRetentionDays });
  return {
    ok: true,
    session: mapSessionRow(session),
    items: messages,
  };
}

export async function listMessagesForSession(sessionId, { retentionDays = null } = {}) {
  return listMessagesForSessionWithDb(getDbPool(), sessionId, { retentionDays });
}

export async function listMessagesForSessionWithDb(db, sessionId, { retentionDays = null } = {}) {
  const normalizedRetentionDays = normalizeRetentionDays(retentionDays);
  const whereClause = normalizedRetentionDays
    ? "m.session_id = ? AND m.sent_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)"
    : "m.session_id = ?";
  const [messages] = await db.execute(
    buildMessageSelectSql(whereClause),
    normalizedRetentionDays ? [sessionId, normalizedRetentionDays] : [sessionId]
  );
  return messages.map(mapMessageRow);
}

function resolveVisibleMessageRetentionDays(session, retentionDays) {
  const explicit = normalizeRetentionDays(retentionDays);
  if (explicit) return explicit;
  return !(session?.internal_uid || session?.internalUid) && (session?.guest_session_id || session?.guestSessionId)
    ? CHAT_RETENTION_DAYS.GUEST_VISIBLE_MESSAGES
    : CHAT_RETENTION_DAYS.USER_VISIBLE_MESSAGES;
}

function normalizeRetentionDays(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export async function ensureOpeningMessageForSession(db, { sessionId, guestSessionId = "", characterId, senderLabel, openingLine }) {
  const normalizedText = String(openingLine || "").trim();
  if (!normalizedText) return null;
  const [existingRows] = await db.execute(
    `SELECT id
     FROM chat_messages
     WHERE session_id = ?
       AND content_type = 'text'
       AND sender_type = 'character'
       AND source_ref = 'opening-line'
     LIMIT 1`,
    [sessionId]
  );
  if (existingRows[0]) return null;
  const [messageRows] = await db.execute(
    `SELECT id
     FROM chat_messages
     WHERE session_id = ?
     LIMIT 1`,
    [sessionId]
  );
  if (messageRows[0]) {
    const [nonGreetingRows] = await db.execute(
      "SELECT id FROM chat_messages WHERE session_id = ? AND content_type <> 'mascot_greeting_image' LIMIT 1",
      [sessionId]
    );
    if (nonGreetingRows[0]) return null;
  }
  const displayOrder = await getNextMessageOrder(db, sessionId);
  return insertMessage(db, {
    sessionId,
    guestSessionId,
    characterId: characterId || null,
    senderType: "character",
    senderLabel: senderLabel || "AIOVE Character",
    contentType: "text",
    text: normalizedText,
    displayOrder,
    sourceType: "system",
    sourceRef: "opening-line",
  });
}

export async function findUserVoiceMessageForReply(db, { sessionId, messageId }) {
  const [rows] = await db.execute(
    `SELECT id, text_content, display_order
     FROM chat_messages
     WHERE id = ?
       AND session_id = ?
       AND sender_type = 'user'
       AND (
         (content_type = 'text' AND source_ref = 'voice-asr')
         OR (content_type = 'voice' AND source_ref = 'user-voice')
       )
     LIMIT 1`,
    [messageId, sessionId]
  );
  if (!rows[0]) throwNotFound();
  return rows[0];
}

export async function listUserTextMessagesSince(db, { sessionId, sinceMessageId }) {
  const [startRows] = await db.execute(
    `SELECT display_order
     FROM chat_messages
     WHERE id = ?
       AND session_id = ?
       AND sender_type = 'user'
       AND (
         (content_type = 'text' AND source_ref IN ('user-input', 'voice-asr'))
         OR (content_type = 'attachment' AND source_ref = 'user-attachment')
       )
     LIMIT 1`,
    [sinceMessageId, sessionId]
  );
  if (!startRows[0]) throwNotFound();

  const [rows] = await db.execute(
    `SELECT id, content_type, text_content, product_payload_json, display_order, sent_at
     FROM chat_messages
     WHERE session_id = ?
       AND sender_type = 'user'
       AND (
         (content_type = 'text' AND source_ref IN ('user-input', 'voice-asr'))
         OR (content_type = 'attachment' AND source_ref = 'user-attachment')
       )
       AND display_order >= ?
     ORDER BY display_order ASC, sent_at ASC`,
    [sessionId, Number(startRows[0].display_order || 0)]
  );
  return rows;
}

export function buildPendingUserText(messages = []) {
  const lines = messages
    .map((message) => {
      if (message?.content_type === "attachment") {
        return buildAttachmentSummary(parseJsonValue(message.product_payload_json, {}));
      }
      return String(message?.text_content || "").trim();
    })
    .filter(Boolean);
  if (!lines.length) {
    const error = new Error("消息内容为空");
    error.statusCode = 400;
    throw error;
  }
  if (lines.length === 1) return lines[0];
  return lines.map((text, index) => `Message ${index + 1}: ${text}`).join("\n");
}

export async function listRecentMessagesForPrompt(db, sessionId) {
  const [messages] = await db.execute(
    `SELECT sender_type, text_content
     FROM (
       SELECT sender_type, text_content, display_order, sent_at
       FROM chat_messages
       WHERE session_id = ?
         AND content_type = 'text'
         AND text_content IS NOT NULL
       ORDER BY display_order DESC, sent_at DESC
       LIMIT 50
     ) recent_messages
     ORDER BY display_order ASC, sent_at ASC`,
    [sessionId]
  );
  return messages.map((message) => ({
    senderType: message.sender_type,
    text: message.text_content || "",
  }));
}

export async function listRecentMessagesBeforeOrder(db, { sessionId, beforeDisplayOrder }) {
  const safeOrder = Number(beforeDisplayOrder || 0);
  if (!safeOrder) return [];
  const [messages] = await db.execute(
    `SELECT id, character_id, sender_type, content_type, text_content, product_payload_json, display_order, sent_at
     FROM (
       SELECT id, character_id, sender_type, content_type, text_content, product_payload_json, display_order, sent_at
       FROM chat_messages
       WHERE session_id = ?
         AND content_type IN ('text', 'product')
         AND text_content IS NOT NULL
         AND display_order < ?
       ORDER BY display_order DESC, sent_at DESC
       LIMIT 50
     ) recent_messages
     ORDER BY display_order ASC, sent_at ASC`,
    [sessionId, safeOrder]
  );
  return messages.map((message) => {
    const textPayload = message.content_type === "text" ? parseJsonValue(message.product_payload_json, null) : null;
    const replyRecoveryState = message.sender_type === "character" ? readReplyRecoveryState(textPayload) : null;
    return {
      id: message.id,
      characterId: message.character_id || "",
      displayOrder: Number(message.display_order || 0),
      sentAt: message.sent_at,
      senderType: message.sender_type,
      text: message.text_content || "",
      contentType: message.content_type || "text",
      product: message.content_type === "product" ? toClientProduct(parseJsonValue(message.product_payload_json, null)) : null,
      ...(textPayload && typeof textPayload === "object" && !Array.isArray(textPayload) && Object.hasOwn(textPayload, "_productRequestScope")
        ? { productRequestState: textPayload._productRequestScope } : {}),
      ...(textPayload && typeof textPayload === "object" && !Array.isArray(textPayload) && Object.hasOwn(textPayload, "_productCandidateState")
        ? { productCandidateState: textPayload._productCandidateState } : {}),
      ...(replyRecoveryState ? { replyRecoveryState } : {}),
    };
  });
}

export async function getNextMessageOrder(db, sessionId) {
  const [rows] = await db.execute(
    "SELECT COALESCE(MAX(display_order), 0) + 10 AS next_order FROM chat_messages WHERE session_id = ?",
    [sessionId]
  );
  return Number(rows[0]?.next_order || 10);
}

export async function insertMessage(db, { sessionId, guestSessionId = "", characterId, senderType, senderLabel, contentType, text, product = null, productRequestState = null, productCandidateState = null, replyRecoveryState = null, voice = null, displayOrder, deliveryStatus = "sent", sourceType, sourceRef }) {
  const messageId = createId("msg");
  const storedProduct = contentType === "product" ? toClientProduct(product)
    : contentType === "text" ? mergeProductCandidatePayload(mergeReplyRecoveryPayload(mergeProductRequestPayload(product, productRequestState), senderType === "character" ? replyRecoveryState : null), senderType === "character" ? productCandidateState : null) : product;
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label, content_type, text_content,
       voice_asset_id, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      messageId,
      sessionId,
      guestSessionId || null,
      characterId,
      senderType,
      senderLabel,
      contentType,
      text,
      voice?.id || null,
      storedProduct ? JSON.stringify(storedProduct) : null,
      displayOrder,
      deliveryStatus,
      sourceType,
      sourceRef,
    ]
  );
  return {
    id: messageId,
    sessionId,
    characterId: characterId || "",
    senderType,
    senderLabel,
    contentType,
    text,
    product: contentType === "text" ? stripProductCandidatePayload(stripReplyRecoveryPayload(stripProductRequestPayload(storedProduct))) : storedProduct,
    feedbackAction: contentType === "feedback_action" ? storedProduct : null,
    orderAction: contentType === "order_action" ? storedProduct : null,
    attachment: contentType === "attachment" ? storedProduct : null,
    displayOrder,
    display_order: displayOrder,
    deliveryStatus,
    sentAt: new Date(),
    voice,
  };
}

export function mapMessageRow(row) {
  const parsedProduct = parseJsonValue(row.product_payload_json, null);
  const product = row.content_type === "attachment"
    ? normalizeChatAttachmentForClient(parsedProduct)
    : row.content_type === "product"
      ? toClientProduct(parsedProduct)
      : row.content_type === "text" ? stripProductCandidatePayload(stripReplyRecoveryPayload(stripProductRequestPayload(parsedProduct))) : parsedProduct;
  return {
    id: row.id,
    sessionId: row.session_id,
    characterId: row.character_id || "",
    senderType: row.sender_type,
    senderLabel: row.sender_label || "",
    contentType: row.content_type,
    text: row.text_content || "",
    product,
    feedbackAction: row.content_type === "feedback_action" ? parsedProduct : null,
    orderAction: row.content_type === "order_action" ? parsedProduct : null,
    attachment: row.content_type === "attachment" ? product : null,
    image: row.content_type === "image_generation"
      ? mapChatImageAssetRow(row)
      : row.content_type === "mascot_greeting_image" || row.content_type === "mascot_library_image"
        ? mapMascotGreetingImage(row, parsedProduct)
        : null,
    displayOrder: Number(row.display_order || 0),
    deliveryStatus: row.delivery_status || "",
    sentAt: row.sent_at,
    voice: row.voice_asset_id
      ? {
          id: row.voice_asset_id,
          durationSeconds: resolveEncodedAudioDurationSeconds({
            durationSeconds: row.voice_duration_seconds,
            audioBytes: row.voice_audio_bytes,
            outputFormat: row.voice_output_format,
          }),
          audioUrl: toProtectedVoiceUrl(row.voice_audio_url || ""),
          assetStatus: row.voice_asset_status || "",
          provider: row.voice_provider || "",
          model: row.voice_model || "",
          voiceId: row.voice_voice_id || "",
          languageCode: row.voice_language_code || "",
          languageLabel: row.voice_language_label || "",
          errorMessage: row.voice_error_message || "",
          waveform: parseJsonValue(row.voice_waveform_json, []),
        }
      : null,
  };
}

function mapMascotGreetingImage(row, payload) {
  const imageUrl = String(payload?.imageUrl || "").trim();
  const mediaType = String(payload?.mediaType || "").trim().toLowerCase() === "video" ? "video" : "image";
  return {
    id: String(payload?.imageId || "").trim(),
    status: imageUrl.startsWith("/uploads/mascot-greetings/") ? "ready" : "failed",
    imageUrl: imageUrl.startsWith("/uploads/mascot-greetings/") ? imageUrl : "",
    mediaType,
    mimeType: mediaType === "video" ? "video/mp4" : "image/webp",
    errorMessage: "",
  };
}

function mapChatImageAssetRow(row) {
  if (!row.image_asset_id) {
    return {
      status: row.delivery_status || "",
      imageUrl: "",
      errorMessage: "",
    };
  }
  return {
    id: row.image_asset_id,
    status: row.image_status || row.delivery_status || "",
    imageUrl: toProtectedChatImageUrl(row.image_protected_path || row.image_storage_path || ""),
    width: Number(row.image_width || 0),
    height: Number(row.image_height || 0),
    bytes: Number(row.image_bytes || 0),
    mimeType: row.image_mime_type || "",
    provider: row.image_provider || "",
    // Keep provider failure details in the admin projection; public chat payloads only expose status.
    errorMessage: "",
    updatedAt: row.image_updated_at || null,
    completedAt: row.image_completed_at || null,
    terminalReplyPending: Boolean(Number(row.image_terminal_reply_pending ?? row.image_failure_reply_pending ?? 0)),
    failureReplyPending: row.image_status === "failed" && Boolean(Number(row.image_terminal_reply_pending ?? row.image_failure_reply_pending ?? 0)),
  };
}

export function mapContactRow(row) {
  const attachment = row.last_content_type === "attachment"
    ? parseJsonValue(row.last_payload_json, null)
    : null;
  return {
    sessionId: row.session_id,
    characterId: row.character_id,
    name: row.name || row.session_title || "AIOVE Character",
    roleTitle: row.role_title || "",
    avatarUrl: row.avatar_url || "",
    visibility: row.visibility || "public",
    characterStatus: row.character_status || "published",
    ownerUid: row.owner_uid || "",
    isOwnCharacter: Boolean(row.is_own_character),
    lastMessageAt: row.last_message_at,
    lastSenderType: row.last_sender_type || "",
    lastText: attachment ? buildAttachmentSummary(attachment) : row.last_text || "",
  };
}

export function buildMessageSelectSql(whereClause) {
  return `SELECT
     m.id,
     m.session_id,
     m.character_id,
     m.sender_type,
     m.sender_label,
     m.content_type,
     m.text_content,
     m.voice_asset_id,
     m.product_payload_json,
     m.display_order,
     m.delivery_status,
     m.sent_at,
     v.duration_seconds AS voice_duration_seconds,
     v.audio_bytes AS voice_audio_bytes,
     v.output_format AS voice_output_format,
     v.audio_url AS voice_audio_url,
     v.asset_status AS voice_asset_status,
     v.provider AS voice_provider,
     v.model AS voice_model,
     v.voice_id AS voice_voice_id,
     v.language_code AS voice_language_code,
     v.language_label AS voice_language_label,
     v.error_message AS voice_error_message,
     v.waveform_json AS voice_waveform_json,
     img.id AS image_asset_id,
     img.status AS image_status,
     CASE WHEN img.status IN ('ready', 'failed') THEN EXISTS (
       SELECT 1 FROM memory_jobs image_failure_job
       WHERE image_failure_job.id = CONCAT('mem_job_img_fail_', LEFT(SHA2(img.id, 256), 32))
         AND image_failure_job.job_status IN ('queued', 'running')
     ) ELSE 0 END AS image_terminal_reply_pending,
     img.storage_path AS image_storage_path,
     img.protected_path AS image_protected_path,
     img.width AS image_width,
     img.height AS image_height,
     img.bytes AS image_bytes,
     img.mime_type AS image_mime_type,
     img.provider AS image_provider,
     img.error_message AS image_error_message,
     img.updated_at AS image_updated_at,
     img.completed_at AS image_completed_at
   FROM chat_messages m
   LEFT JOIN character_voice_assets v ON v.id = m.voice_asset_id
   LEFT JOIN chat_image_assets img ON img.message_id = m.id
   WHERE ${whereClause}
   ORDER BY m.display_order ASC, m.sent_at ASC`;
}

export async function insertVoiceAsset(db, { characterId, voice, transcriptText, userId }) {
  const voiceId = createId("voice");
  await db.execute(
    `INSERT INTO character_voice_assets (
       id, character_id, asset_type, title, transcript, duration_seconds, provider, voice_id,
       audio_url, waveform_json, asset_status, source_type, source_ref
     ) VALUES (?, ?, 'user_message', ?, ?, ?, 'browser', ?, ?, ?, 'active', 'user', ?)`,
    [
      voiceId,
      characterId,
      voice.name || "Voice message",
      transcriptText,
      voice.durationSeconds,
      voice.mimeType,
      voice.url,
      JSON.stringify(voice.waveform || []),
      `user-voice:${userId}`,
    ]
  );
  return {
    id: voiceId,
    durationSeconds: voice.durationSeconds,
    audioUrl: toProtectedVoiceUrl(voice.url),
    waveform: voice.waveform || [],
  };
}

export async function attachVoiceAssetToMessage(db, { messageId, voiceAssetId }) {
  const normalizedMessageId = safeString(messageId);
  const normalizedVoiceAssetId = safeString(voiceAssetId);
  if (!normalizedMessageId || !normalizedVoiceAssetId) return;
  await db.execute(
    "UPDATE chat_messages SET voice_asset_id = ?, updated_at = NOW(3) WHERE id = ?",
    [normalizedVoiceAssetId, normalizedMessageId]
  );
}

function safeString(value = "") {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}
