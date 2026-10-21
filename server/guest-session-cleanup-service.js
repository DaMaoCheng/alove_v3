import { getDbPool, withTransaction } from "./db.js";
import { deleteStoredChatImageAsset } from "./chat-image-asset-service.js";
import { acquireChatImageJobLock } from "./chat-image-job-service.js";
import { deleteStoredChatVoiceAsset } from "./chat-voice-asset-service.js";
import { deleteGuestAttachmentStoredFiles } from "./guest-chat-attachment-service.js";
import { CHAT_RETENTION_DAYS } from "./chat-retention-policy.js";

export async function cleanupExpiredGuestSessions({ now = new Date(), limit = 100, deleteAttachmentFiles = deleteGuestAttachmentStoredFiles } = {}) {
  const cutoff = new Date(now);
  const batchLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  const [expiredVoiceRequests] = await getDbPool().execute("DELETE FROM guest_voice_requests WHERE expires_at <= ?", [cutoff]);
  const expiredPendingAttachments = await cleanupExpiredPendingGuestAttachments({ cutoff, limit: batchLimit, deleteAttachmentFiles });
  const [markedRows] = await getDbPool().execute(
    `UPDATE guest_sessions g
     SET g.session_status = 'expired', g.updated_at = NOW(3)
     WHERE g.expires_at <= ?
       AND g.session_status = 'active'
       AND g.claimed_user_id IS NULL
       AND g.claimed_at IS NULL`,
    [cutoff]
  );
  await getDbPool().execute(
    `UPDATE chat_sessions s
     INNER JOIN guest_sessions g ON g.id = s.guest_session_id
     SET s.session_status = 'expired', s.updated_at = NOW(3)
     WHERE g.session_status = 'expired'
       AND g.claimed_user_id IS NULL
       AND g.claimed_at IS NULL
       AND g.expires_at <= ?
       AND s.internal_uid IS NULL
       AND s.session_status = 'active'`,
    [cutoff]
  );
  const retentionCutoff = new Date(cutoff.getTime() - CHAT_RETENTION_DAYS.RAW_MESSAGES * 24 * 60 * 60 * 1000);
  const [rows] = await getDbPool().execute(
    `SELECT id, chat_session_id
     FROM guest_sessions
     WHERE expires_at <= ?
       AND claimed_user_id IS NULL
       AND claimed_at IS NULL
       AND created_at <= ?
       AND session_status IN ('expired', 'active', 'revoked', 'cleanup_pending')
       AND NOT EXISTS (SELECT 1 FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id
         WHERE s.guest_session_id = guest_sessions.id AND m.sent_at >= ?)
     ORDER BY expires_at ASC
     LIMIT ${batchLimit}`,
    [cutoff, retentionCutoff, retentionCutoff]
  );

  let deletedSessions = 0;
  let deletedFiles = 0;
  let deletedAttachmentFiles = expiredPendingAttachments.deletedFiles;
  const deletedVoiceAssetFiles = new Set();
  for (const row of rows) {
    const guestSessionId = String(row.id || "").trim();
    if (!guestSessionId) continue;
    const prepared = await withTransaction(async (db) => {
      const [lockedRows] = await db.execute(
        `SELECT id, chat_session_id
         FROM guest_sessions
         WHERE id = ?
           AND expires_at <= ?
           AND claimed_user_id IS NULL
           AND claimed_at IS NULL
         LIMIT 1
         FOR UPDATE`,
        [guestSessionId, cutoff]
      );
      if (!lockedRows[0]) return null;
      await db.execute(
        "UPDATE guest_sessions SET session_status = 'cleanup_pending', updated_at = NOW(3) WHERE id = ?",
        [guestSessionId]
      );
      return lockedRows[0];
    });
    if (!prepared) continue;
    const [assets] = await getDbPool().execute(
      `SELECT id
       FROM chat_image_assets
       WHERE guest_session_id = ?`,
      [guestSessionId]
    );
    const [attachmentAssets] = await getDbPool().execute(
      "SELECT id, stored_name, attempt_token FROM guest_chat_attachments WHERE guest_session_id = ?",
      [guestSessionId]
    );
    const [voiceSnapshot] = await getDbPool().execute(
      `SELECT v.id, v.asset_type, v.audio_url, v.attempt_token
       FROM character_voice_assets v
       JOIN chat_messages m ON m.voice_asset_id = v.id
       WHERE m.guest_session_id = ?`,
      [guestSessionId]
    );
    await getDbPool().execute(
      `UPDATE character_voice_assets v
       JOIN chat_messages m ON m.voice_asset_id = v.id
       SET v.asset_status = 'cancelled', v.attempt_token = NULL, v.updated_at = NOW(3)
       WHERE m.guest_session_id = ?
         AND v.asset_status IN ('pending', 'generating', 'finalizing', 'failed')`,
      [guestSessionId]
    );
    const [voiceCurrent] = await getDbPool().execute(
      `SELECT v.id, v.asset_type, v.audio_url, v.attempt_token
       FROM character_voice_assets v
       JOIN chat_messages m ON m.voice_asset_id = v.id
       WHERE m.guest_session_id = ?`,
      [guestSessionId]
    );
    const voiceAssets = mergeVoiceAssetSnapshots(voiceSnapshot, voiceCurrent);
    const releaseLocks = [];
    let deleted = false;
    try {
      for (const asset of [...assets].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
        releaseLocks.push(await acquireChatImageJobLock(asset.id));
      }
      for (const asset of assets) {
        if (await deleteStoredChatImageAsset({ assetId: asset.id })) {
          deletedFiles += 1;
        }
      }
      for (const voiceAsset of voiceAssets) {
        if (await deleteStoredChatVoiceAsset({ assetId: voiceAsset.id, assetType: voiceAsset.asset_type, audioUrl: voiceAsset.audio_url, attemptToken: voiceAsset.attempt_token })) {
          deletedVoiceAssetFiles.add(voiceAsset.id);
        }
      }
      for (const attachmentAsset of attachmentAssets) {
        if (await deleteGuestAttachmentStoredFiles({ id: attachmentAsset.id, storedName: attachmentAsset.stored_name, attemptToken: attachmentAsset.attempt_token })) deletedAttachmentFiles += 1;
      }

      deleted = await withTransaction(async (db) => {
        const [lockedRows] = await db.execute(
          `SELECT id, chat_session_id
           FROM guest_sessions
           WHERE id = ?
             AND session_status = 'cleanup_pending'
             AND claimed_user_id IS NULL
             AND claimed_at IS NULL
           LIMIT 1
           FOR UPDATE`,
          [guestSessionId]
        );
        const guest = lockedRows[0] || null;
        if (!guest) return false;
        const chatSessionId = String(guest.chat_session_id || row.chat_session_id || "").trim();
        if (chatSessionId) {
          await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [chatSessionId]);
        }
        if (voiceAssets.length) {
          await db.execute(
            `DELETE FROM character_voice_assets
             WHERE id IN (${voiceAssets.map(() => "?").join(", ")})`,
            voiceAssets.map((asset) => asset.id)
          );
        }
        await db.execute("DELETE FROM guest_chat_attachments WHERE guest_session_id = ?", [guestSessionId]);
        await db.execute("DELETE FROM guest_voice_requests WHERE guest_session_id = ?", [guestSessionId]);
        await db.execute("DELETE FROM guest_call_sessions WHERE guest_session_id = ?", [guestSessionId]);
        await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guestSessionId]);
        await db.execute("DELETE FROM guest_character_sessions WHERE guest_session_id = ?", [guestSessionId]);
        await db.execute(
          "DELETE FROM chat_sessions WHERE guest_session_id = ? AND internal_uid IS NULL",
          [guestSessionId]
        );
        const [result] = await db.execute(
          `DELETE FROM guest_sessions
           WHERE id = ?
             AND claimed_user_id IS NULL
             AND claimed_at IS NULL`,
          [guestSessionId]
        );
        return Number(result.affectedRows || 0) === 1;
      });
      for (const voiceAsset of voiceAssets) {
        if (await deleteStoredChatVoiceAsset({ assetId: voiceAsset.id, assetType: voiceAsset.asset_type, audioUrl: voiceAsset.audio_url, attemptToken: voiceAsset.attempt_token })) {
          deletedVoiceAssetFiles.add(voiceAsset.id);
        }
      }
    } finally {
      for (const releaseLock of releaseLocks.reverse()) {
        await releaseLock().catch(() => {});
      }
    }
    if (deleted) deletedSessions += 1;
  }

  return {
    expiredGuestSessionsDeleted: deletedSessions,
    expiredGuestSessionsMarked: Number(markedRows.affectedRows || 0),
    expiredGuestImageFilesDeleted: deletedFiles,
    expiredGuestVoiceFilesDeleted: deletedVoiceAssetFiles.size,
    expiredGuestAttachmentFilesDeleted: deletedAttachmentFiles,
    expiredGuestVoiceRequestsDeleted: Number(expiredVoiceRequests.affectedRows || 0),
  };
}

async function cleanupExpiredPendingGuestAttachments({ cutoff, limit, deleteAttachmentFiles }) {
  const [rows] = await getDbPool().execute(
    `SELECT attachment.id
     FROM guest_chat_attachments attachment
     INNER JOIN guest_sessions guest ON guest.id = attachment.guest_session_id
     WHERE attachment.expires_at <= ?
       AND attachment.asset_status IN ('uploading', 'finalizing', 'uploaded')
       AND attachment.message_id IS NULL
       AND guest.claimed_user_id IS NULL AND guest.claimed_at IS NULL
       AND guest.session_status <> 'claimed'
     ORDER BY attachment.expires_at ASC LIMIT ${limit}`,
    [cutoff]
  );
  let deletedFiles = 0;
  for (const row of rows) {
    const deleted = await withTransaction(async (db) => {
      const [locked] = await db.execute(
        `SELECT attachment.id, attachment.stored_name, attachment.attempt_token
         FROM guest_chat_attachments attachment
         INNER JOIN guest_sessions guest ON guest.id = attachment.guest_session_id
         WHERE attachment.id = ? AND attachment.expires_at <= ?
           AND attachment.asset_status IN ('uploading', 'finalizing', 'uploaded')
           AND attachment.message_id IS NULL
           AND guest.claimed_user_id IS NULL AND guest.claimed_at IS NULL
           AND guest.session_status <> 'claimed'
         LIMIT 1 FOR UPDATE`,
        [row.id, cutoff]
      );
      if (!locked[0]) return false;
      await db.execute("UPDATE guest_chat_attachments SET asset_status = 'cleanup_pending', updated_at = NOW(3) WHERE id = ?", [row.id]);
      const removed = await deleteAttachmentFiles({ id: locked[0].id, storedName: locked[0].stored_name, attemptToken: locked[0].attempt_token });
      await db.execute("DELETE FROM guest_chat_attachments WHERE id = ? AND asset_status = 'cleanup_pending'", [row.id]);
      return removed;
    });
    if (deleted) deletedFiles += 1;
  }
  return { deletedFiles };
}

function mergeVoiceAssetSnapshots(...groups) {
  const byId = new Map();
  for (const row of groups.flat()) {
    if (!row?.id) continue;
    const current = byId.get(row.id) || {};
    byId.set(row.id, {
      id: row.id,
      asset_type: row.asset_type || current.asset_type || "",
      audio_url: row.audio_url || current.audio_url || "",
      attempt_token: row.attempt_token || current.attempt_token || "",
    });
  }
  return [...byId.values()];
}
