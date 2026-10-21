import { getDbPool } from "./db.js";
import { deleteStoredChatImageAsset } from "./chat-image-asset-service.js";
import { acquireChatImageJobLock } from "./chat-image-job-service.js";
import { deleteStoredChatVoiceAsset } from "./chat-voice-asset-service.js";
import { deleteGuestAttachmentStoredFiles } from "./guest-chat-attachment-service.js";
import { deleteStoredChatAttachmentUpload } from "./chat-upload-service.js";
import { parseJsonValue } from "./chat-message-payload-utils.js";
import { CHAT_RETENTION_DAYS } from "./chat-retention-policy.js";

const DEFAULT_BATCH_LIMIT = 100;
const MAX_BATCH_LIMIT = 500;

/**
 * Remove registered-user messages older than the raw-data retention window.
 * Guest sessions are purged by guest-session-cleanup-service after their
 * token has expired and all of their messages have crossed the same cutoff.
 */
export async function cleanupExpiredChatMessages({
  cutoff = resolveRetentionCutoff(),
  limit = DEFAULT_BATCH_LIMIT,
  after = null,
  sessionId = "",
  db = getDbPool(),
  deleteImage = deleteStoredChatImageAsset,
  deleteVoice = deleteStoredChatVoiceAsset,
  deleteAttachment = deleteGuestAttachmentStoredFiles,
  deleteUserAttachment = deleteStoredChatAttachmentUpload,
  acquireImageLock = acquireChatImageJobLock,
} = {}) {
  const cutoffDate = normalizeCutoff(cutoff);
  const batchLimit = normalizeLimit(limit);
  const cursor = normalizeCursor(after);
  const cursorClause = cursor ? "AND (m.sent_at > ? OR (m.sent_at = ? AND m.id > ?))" : "";
  const normalizedSessionId = String(sessionId || "").trim();
  const sessionClause = normalizedSessionId ? "AND s.id = ?" : "";
  const queryParams = [cutoffDate];
  if (normalizedSessionId) queryParams.push(normalizedSessionId);
  if (cursor) queryParams.push(cursor.sentAt, cursor.sentAt, cursor.id);
  const [messages] = await db.execute(
    `SELECT m.id, m.sent_at
     FROM chat_messages m
     INNER JOIN chat_sessions s ON s.id = m.session_id
     WHERE s.source_type = 'user'
       AND m.sent_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM chat_image_assets active_image
         WHERE active_image.message_id = m.id
           AND active_image.status IN ('queued', 'generating')
       )
       AND NOT EXISTS (
         SELECT 1 FROM character_voice_assets active_voice
         WHERE (active_voice.message_id = m.id OR active_voice.id = m.voice_asset_id)
           AND active_voice.asset_status IN ('generating', 'finalizing')
       )
       ${sessionClause}
       ${cursorClause}
     ORDER BY m.sent_at ASC, m.id ASC
     LIMIT ${batchLimit}`,
    queryParams
  );

  let deletedMessages = 0;
  let skippedMessages = 0;
  for (const message of messages) {
    const result = await cleanupOneMessage({
      messageId: message.id,
      cutoff: cutoffDate,
      sessionId: normalizedSessionId,
      db,
      deleteImage,
      deleteVoice,
      deleteAttachment,
      deleteUserAttachment,
      acquireImageLock,
    });
    if (result === "deleted") deletedMessages += 1;
    else skippedMessages += 1;
  }

  return {
    cutoff: cutoffDate,
    scannedMessages: messages.length,
    deletedMessages,
    skippedMessages,
    hasMore: messages.length >= batchLimit,
    nextCursor: messages.length
      ? { sentAt: messageSentAt(messages[messages.length - 1]), id: String(messages[messages.length - 1].id) }
      : null,
  };
}

async function cleanupOneMessage({
  messageId,
  cutoff,
  sessionId,
  db,
  deleteImage,
  deleteVoice,
  deleteAttachment,
  deleteUserAttachment,
  acquireImageLock,
}) {
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedMessageId) return "skipped";
  const normalizedSessionId = String(sessionId || "").trim();

  // Acquire the same named locks as the image worker before opening the DB
  // transaction. The locks remain held until file and row deletion commits.
  const [candidateImages] = await db.execute(
    "SELECT id FROM chat_image_assets WHERE message_id = ? ORDER BY id ASC",
    [normalizedMessageId]
  );
  const releaseLocks = [];
  let connection = null;
  let transactionOpen = false;
  try {
    for (const image of candidateImages) releaseLocks.push(await acquireImageLock(image.id));

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;

    const sessionClause = normalizedSessionId ? "AND s.id = ?" : "";
    const messageParams = [normalizedMessageId, cutoff];
    if (normalizedSessionId) messageParams.push(normalizedSessionId);
    const [[message]] = await connection.execute(
      `SELECT m.id, m.session_id, m.voice_asset_id, m.content_type, m.product_payload_json
       FROM chat_messages m
       INNER JOIN chat_sessions s ON s.id = m.session_id
       WHERE m.id = ? AND m.sent_at < ? AND s.source_type = 'user'
         ${sessionClause}
       LIMIT 1 FOR UPDATE`,
      messageParams
    );
    if (!message) {
      await connection.rollback();
      transactionOpen = false;
      return "skipped";
    }

    const [images] = await connection.execute(
      `SELECT id, storage_path, status
       FROM chat_image_assets
       WHERE message_id = ?
       ORDER BY id ASC
       FOR UPDATE`,
      [normalizedMessageId]
    );
    const lockedImageIds = new Set(candidateImages.map((asset) => String(asset.id)));
    if (images.some((asset) => !lockedImageIds.has(String(asset.id)))) {
      await connection.rollback();
      transactionOpen = false;
      return "skipped";
    }
    if (images.some((asset) => ["queued", "generating"].includes(String(asset.status || "").toLowerCase()))) {
      await connection.rollback();
      transactionOpen = false;
      return "skipped";
    }

    const [voices] = await connection.execute(
      `SELECT v.id, v.asset_type, v.audio_url, v.attempt_token, v.asset_status
       FROM character_voice_assets v
       WHERE v.message_id = ? OR v.id = ?
       ORDER BY v.id ASC
       FOR UPDATE`,
      [normalizedMessageId, String(message.voice_asset_id || "")]
    );
    if (voices.some((asset) => ["generating", "finalizing"].includes(String(asset.asset_status || "").toLowerCase()))) {
      await connection.rollback();
      transactionOpen = false;
      return "skipped";
    }

    const [attachments] = await connection.execute(
      `SELECT id, stored_name, attempt_token, asset_status
       FROM guest_chat_attachments
       WHERE message_id = ?
       ORDER BY id ASC
       FOR UPDATE`,
      [normalizedMessageId]
    );
    if (attachments.some((asset) => ["uploading", "finalizing"].includes(String(asset.asset_status || "").toLowerCase()))) {
      await connection.rollback();
      transactionOpen = false;
      return "skipped";
    }

    const deletableVoices = [];
    for (const voice of voices) {
      const [[referenceRow]] = await connection.execute(
        `SELECT COUNT(*) AS reference_count
         FROM chat_messages
         WHERE voice_asset_id = ? AND id <> ?`,
        [voice.id, normalizedMessageId]
      );
      if (Number(referenceRow?.reference_count || 0) === 0) deletableVoices.push(voice);
    }

    const payload = parseJsonValue(message.product_payload_json, null);
    const userAttachmentStoredName = message.content_type === "attachment"
      ? resolveChatAttachmentStoredName(payload)
      : "";

    try {
      for (const image of images) {
        await deleteImage({ assetId: image.id });
      }
      for (const voice of deletableVoices) {
        await deleteVoice({
          assetId: voice.id,
          assetType: voice.asset_type,
          audioUrl: voice.audio_url,
          attemptToken: voice.attempt_token,
        });
      }
      if (userAttachmentStoredName) await deleteUserAttachment(userAttachmentStoredName);
      for (const attachment of attachments) {
        await deleteAttachment({
          id: attachment.id,
          storedName: attachment.stored_name,
          attemptToken: attachment.attempt_token,
        });
      }
    } catch {
      await connection.rollback();
      transactionOpen = false;
      return "skipped";
    }

    await connection.execute("DELETE FROM chat_message_index WHERE message_id = ?", [normalizedMessageId]);
    if (images.length) {
      await connection.execute("DELETE FROM chat_image_assets WHERE message_id = ?", [normalizedMessageId]);
    }
    if (deletableVoices.length) {
      await connection.execute(
        `DELETE FROM character_voice_assets WHERE id IN (${deletableVoices.map(() => "?").join(", ")})`,
        deletableVoices.map((asset) => asset.id)
      );
    }
    if (attachments.length) {
      await connection.execute("DELETE FROM guest_chat_attachments WHERE message_id = ?", [normalizedMessageId]);
    }
    await connection.execute(
      "DELETE FROM chat_messages WHERE id = ? AND sent_at < ?",
      [normalizedMessageId, cutoff]
    );
    await connection.commit();
    transactionOpen = false;
    return "deleted";
  } catch (error) {
    if (transactionOpen) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (connection) connection.release();
    for (const releaseLock of releaseLocks.reverse()) await releaseLock().catch(() => {});
  }
}

function resolveChatAttachmentStoredName(payload) {
  const candidates = [payload?.storedName, payload?.url];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    const match = value.match(/^(?:\/api)?\/uploads\/chat\/([^/?#]+)$/);
    const storedName = match ? match[1] : value;
    if (/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,179}$/.test(storedName) && storedName !== "." && storedName !== "..") {
      return storedName;
    }
  }
  return "";
}

function resolveRetentionCutoff(now = new Date()) {
  const current = now instanceof Date ? now : new Date(now);
  return new Date(current.getTime() - CHAT_RETENTION_DAYS.RAW_MESSAGES * 24 * 60 * 60 * 1000);
}

function normalizeCursor(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  const sentAt = value.sentAt instanceof Date ? value.sentAt : new Date(value.sentAt || "");
  return id && Number.isFinite(sentAt.getTime()) ? { id, sentAt } : null;
}

function messageSentAt(message) {
  return message.sent_at instanceof Date ? message.sent_at : new Date(message.sent_at);
}

function normalizeCutoff(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new TypeError("cutoff must be a valid date");
  return date;
}

function normalizeLimit(value) {
  const numeric = Number(value || DEFAULT_BATCH_LIMIT);
  if (!Number.isFinite(numeric)) return DEFAULT_BATCH_LIMIT;
  return Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(numeric)));
}

export const CHAT_RETENTION_CLEANUP_LIMITS = Object.freeze({
  DEFAULT_BATCH_LIMIT,
  MAX_BATCH_LIMIT,
});
