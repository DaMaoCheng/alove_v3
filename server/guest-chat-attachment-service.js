import { createId } from "./security.js";
import { getDbPool } from "./db.js";
import { deleteStoredChatAttachmentAttempts, deleteStoredChatAttachmentUpload, moveStoredChatAttachmentUpload, saveChatAttachmentUpload, storedChatAttachmentUploadExists } from "./chat-upload-service.js";
import { createPublicError } from "./public-error-utils.js";
import { normalizeAttachmentPayload } from "./chat-message-payload-utils.js";
import { acquireDbAdvisoryLock } from "./db-advisory-lock-service.js";
import { toProtectedChatAttachmentUrl } from "./protected-upload-url-service.js";

const MAX_PENDING_ATTACHMENTS = 10;
const MAX_ATTACHMENTS_PER_TURN = 5;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const GUEST_UPLOAD_LIMIT = 10;
const GUEST_UPLOAD_BYTES_LIMIT = 100 * 1024 * 1024;
const NETWORK_UPLOAD_LIMIT = 30;
const NETWORK_UPLOAD_BYTES_LIMIT = 300 * 1024 * 1024;
const UPLOAD_LEASE_MS = 2 * 60 * 1000;
const GUEST_INFLIGHT_LIMIT = 2;
const NETWORK_INFLIGHT_LIMIT = 2;
const GLOBAL_INFLIGHT_LIMIT = 8;

export async function reserveGuestChatAttachmentUpload({ guest, clientUploadId, networkHash, reservedBytes, storageExtension }) {
  if (!guest?.id) throw createPublicError("Please start a guest chat first.", 401);
  const normalizedUploadId = String(clientUploadId || "").trim().slice(0, 128);
  const normalizedNetworkHash = String(networkHash || "").trim();
  const normalizedBytes = Math.max(1, Number(reservedBytes || 0));
  const normalizedExtension = String(storageExtension || "").trim().toLowerCase();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalizedUploadId)) throw createPublicError("Attachment upload id is invalid.", 400);
  if (!normalizedNetworkHash) throw createPublicError("Guest upload is unavailable.", 503);
  if (!/^\.[a-z0-9]{1,8}$/.test(normalizedExtension)) throw createPublicError("Attachment file type is invalid.", 400);
  const connection = await getDbPool().getConnection();
  let releaseReservationLock = async () => {};
  try {
    releaseReservationLock = await acquireDbAdvisoryLock(connection, "guest_attachment_reservation", 10);
    await connection.beginTransaction();
    const [guestRows] = await connection.execute(
      `SELECT *, NOW(3) AS db_now FROM guest_sessions
       WHERE id = ? AND session_status = 'active' AND expires_at > NOW(3)
         AND claimed_user_id IS NULL AND claimed_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [guest.id]
    );
    const lockedGuest = guestRows[0] || null;
    if (!lockedGuest) throw createPublicError("Please start a guest chat first.", 401);
    const [existingRows] = await connection.execute(
      "SELECT * FROM guest_chat_attachments WHERE guest_session_id = ? AND character_id = ? AND client_upload_id = ? LIMIT 1 FOR UPDATE",
      [guest.id, guest.mascot_character_id, normalizedUploadId]
    );
    const existing = existingRows[0] || null;
    if (existing?.asset_status === "uploaded") {
      await connection.commit();
      return { id: existing.id, reused: true, attachment: { ...normalizeAttachmentPayload(parseJsonObject(existing.attachment_json)), guestAttachmentId: existing.id } };
    }
    if (existing?.asset_status === "attached") throw createPublicError("This attachment has already been sent.", 409);
    if (existing?.asset_status === "finalizing") {
      const recovered = await recoverFinalizingGuestAttachment(connection, { existing, dbNow: lockedGuest.db_now });
      if (recovered) {
        await connection.commit();
        await deleteStoredChatAttachmentAttempts(existing.id).catch(() => {});
        return { id: existing.id, reused: true, attachment: { ...recovered, guestAttachmentId: existing.id } };
      }
      existing.asset_status = "uploading";
      existing.updated_at = new Date(0);
    }
    if (existing && existing.asset_status !== "uploading") throw createPublicError("This attachment upload is unavailable.", 409);
    if (existing?.asset_status === "uploading" && new Date(lockedGuest.db_now).getTime() - new Date(existing.updated_at).getTime() < UPLOAD_LEASE_MS) {
      throw createPublicError("This attachment is still uploading.", 409);
    }
    const [[inflight]] = await connection.execute(
      `SELECT
         COUNT(*) AS global_count,
         SUM(CASE WHEN network_hash = ? THEN 1 ELSE 0 END) AS network_count,
         SUM(CASE WHEN guest_session_id = ? THEN 1 ELSE 0 END) AS guest_count
       FROM guest_chat_attachments
       WHERE asset_status = 'uploading' AND updated_at >= DATE_SUB(NOW(3), INTERVAL 2 MINUTE)
         AND (? = '' OR id <> ?)`,
      [normalizedNetworkHash, guest.id, existing?.id || "", existing?.id || ""]
    );
    if (Number(inflight?.global_count || 0) >= GLOBAL_INFLIGHT_LIMIT
      || Number(inflight?.network_count || 0) >= NETWORK_INFLIGHT_LIMIT
      || Number(inflight?.guest_count || 0) >= GUEST_INFLIGHT_LIMIT) {
      throw createPublicError("Too many guest attachments are uploading. Please try again shortly.", 429);
    }
    await consumeAttachmentUploadBudget(connection, { guest: lockedGuest, networkHash: normalizedNetworkHash, reservedBytes: normalizedBytes });
    const [[usage]] = await connection.execute(
      `SELECT COUNT(*) AS pending_count
       FROM guest_chat_attachments
       WHERE guest_session_id = ? AND asset_status IN ('uploading', 'uploaded')`,
      [guest.id]
    );
    if (!existing && Number(usage?.pending_count || 0) >= MAX_PENDING_ATTACHMENTS) {
      throw createPublicError("Please send or remove an existing attachment before uploading more.", 429);
    }
    const id = existing?.id || createId("guest_attachment");
    const attemptToken = createId("attachment_attempt");
    const deterministicStoredName = `${id}${normalizedExtension}`;
    if (existing) {
      const [takenOver] = await connection.execute(
        `UPDATE guest_chat_attachments
         SET network_hash = ?, stored_name = ?, attempt_token = ?, attachment_json = JSON_OBJECT(), updated_at = NOW(3)
         WHERE id = ? AND asset_status = 'uploading'`,
        [normalizedNetworkHash, deterministicStoredName, attemptToken, id]
      );
      if (Number(takenOver.affectedRows || 0) !== 1) throw createPublicError("This attachment upload is unavailable.", 409);
    } else {
      await connection.execute(
        `INSERT INTO guest_chat_attachments (
           id, guest_session_id, site_id, character_id, network_hash, client_upload_id, stored_name, attempt_token,
           attachment_json, asset_status, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, JSON_OBJECT(), 'uploading', ?)`,
        [id, guest.id, guest.site_id, guest.mascot_character_id, normalizedNetworkHash, normalizedUploadId, deterministicStoredName, attemptToken, lockedGuest.expires_at]
      );
    }
    await connection.commit();
    return { id, attemptToken, reused: false, attachment: null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await releaseReservationLock().catch(() => {});
    connection.release();
  }
}

export async function completeGuestChatAttachmentUpload({ guest, reservationId, attemptToken, buffer, contentType, filename, originalName, originalSha256 }) {
  const id = String(reservationId || "").trim();
  const normalizedAttemptToken = String(attemptToken || "").trim();
  if (!/^guest_attachment_[a-zA-Z0-9-]+$/.test(id) || !/^attachment_attempt_[a-zA-Z0-9-]+$/.test(normalizedAttemptToken)) {
    throw createPublicError("Guest attachment upload was cancelled.", 409);
  }
  const temporaryNameBase = `${id}_${normalizedAttemptToken}_tmp`;
  let temporaryStoredName = "";
  let finalStoredName = "";
  let guestSafeAttachment = null;
  let ownsFinalizing = false;
  try {
    const attachment = await saveChatAttachmentUpload({
      userId: `guest:${guest.id}`,
      buffer,
      contentType,
      filename,
      originalName,
      originalSha256,
      deterministicNameBase: temporaryNameBase,
    });
    temporaryStoredName = attachment.storedName;
    const extension = temporaryStoredName.slice(temporaryNameBase.length);
    if (!/^\.[a-z0-9]{1,8}$/.test(extension)) throw createPublicError("Guest attachment upload was cancelled.", 409);
    finalStoredName = `${id}${extension}`;
    guestSafeAttachment = {
      ...attachment,
      storedName: finalStoredName,
      url: toProtectedChatAttachmentUrl(finalStoredName),
    };
    delete guestSafeAttachment.uploadedBy;
    const [finalizing] = await getDbPool().execute(
      `UPDATE guest_chat_attachments a
       JOIN guest_sessions g ON g.id = a.guest_session_id
       SET a.attachment_json = ?, a.asset_status = 'finalizing', a.updated_at = NOW(3)
       WHERE a.id = ? AND a.guest_session_id = ? AND a.asset_status = 'uploading'
         AND a.stored_name = ? AND a.attempt_token = ?
         AND g.session_status = 'active' AND g.expires_at > NOW(3)
         AND g.claimed_user_id IS NULL AND g.claimed_at IS NULL`,
      [JSON.stringify(guestSafeAttachment), id, guest.id, finalStoredName, normalizedAttemptToken]
    );
    if (Number(finalizing.affectedRows || 0) !== 1) throw createPublicError("Guest attachment upload was cancelled.", 409);
    ownsFinalizing = true;
    await moveStoredChatAttachmentUpload(temporaryStoredName, finalStoredName);
    temporaryStoredName = "";
    const [uploaded] = await getDbPool().execute(
      `UPDATE guest_chat_attachments
       SET asset_status = 'uploaded', attempt_token = NULL, updated_at = NOW(3)
       WHERE id = ? AND guest_session_id = ? AND asset_status = 'finalizing' AND attempt_token = ?`,
      [id, guest.id, normalizedAttemptToken]
    );
    if (Number(uploaded.affectedRows || 0) !== 1) throw createPublicError("Guest attachment upload was cancelled.", 409);
    ownsFinalizing = false;
    await deleteStoredChatAttachmentAttempts(id).catch(() => {});
  } catch (error) {
    if (temporaryStoredName) await deleteStoredChatAttachmentUpload(temporaryStoredName).catch(() => {});
    if (ownsFinalizing) {
      const [[current]] = await getDbPool().execute(
        "SELECT asset_status, attempt_token FROM guest_chat_attachments WHERE id = ? LIMIT 1",
        [id]
      ).catch(() => [[]]);
      if (current?.asset_status === "finalizing" && current?.attempt_token === normalizedAttemptToken) {
        await getDbPool().execute(
          "DELETE FROM guest_chat_attachments WHERE id = ? AND asset_status = 'finalizing' AND attempt_token = ?",
          [id, normalizedAttemptToken]
        ).catch(() => {});
        if (finalStoredName) await deleteStoredChatAttachmentUpload(finalStoredName).catch(() => {});
      } else if (!current || current.asset_status === "cleanup_pending") {
        if (finalStoredName) await deleteStoredChatAttachmentUpload(finalStoredName).catch(() => {});
      }
    } else {
      await getDbPool().execute(
        "DELETE FROM guest_chat_attachments WHERE id = ? AND asset_status = 'uploading' AND attempt_token = ?",
        [id, normalizedAttemptToken]
      ).catch(() => {});
    }
    throw error;
  }
  return { ...guestSafeAttachment, guestAttachmentId: id };
}

export async function saveGuestChatAttachment({ guest, clientUploadId, networkHash, reservedBytes, buffer, contentType, filename, originalName, originalSha256 }) {
  const normalizedType = String(contentType || "").split(";", 1)[0].trim().toLowerCase();
  const storageExtension = ({ "text/plain": ".txt", "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" })[normalizedType] || "";
  const reservation = await reserveGuestChatAttachmentUpload({ guest, clientUploadId, networkHash, reservedBytes, storageExtension });
  if (reservation.reused) return reservation.attachment;
  return completeGuestChatAttachmentUpload({ guest, reservationId: reservation.id, attemptToken: reservation.attemptToken, buffer, contentType, filename, originalName, originalSha256 });
}

export async function deleteGuestAttachmentStoredFiles({ id, storedName, attemptToken }) {
  let deleted = false;
  if (storedName && await deleteStoredChatAttachmentUpload(storedName)) deleted = true;
  const temporaryStoredName = buildGuestAttachmentAttemptStoredName({ id, storedName, attemptToken });
  if (temporaryStoredName && await deleteStoredChatAttachmentUpload(temporaryStoredName)) deleted = true;
  if (await deleteStoredChatAttachmentAttempts(id)) deleted = true;
  return deleted;
}

export function buildGuestAttachmentAttemptStoredName({ id, storedName, attemptToken }) {
  const normalizedId = String(id || "").trim();
  const normalizedStoredName = String(storedName || "").trim();
  const normalizedAttemptToken = String(attemptToken || "").trim();
  const extension = normalizedStoredName.startsWith(normalizedId) ? normalizedStoredName.slice(normalizedId.length) : "";
  if (!/^guest_attachment_[a-zA-Z0-9-]+$/.test(normalizedId)
    || !/^attachment_attempt_[a-zA-Z0-9-]+$/.test(normalizedAttemptToken)
    || !/^\.[a-z0-9]{1,8}$/.test(extension)) return "";
  return `${normalizedId}_${normalizedAttemptToken}_tmp${extension}`;
}

export async function resolveGuestAttachmentsForTurn(db, { guest, attachmentIds = [], lock = false }) {
  const ids = normalizeAttachmentIds(attachmentIds);
  if (!ids.length) return [];
  const [rows] = await db.execute(
    `SELECT * FROM guest_chat_attachments
     WHERE guest_session_id = ? AND site_id = ? AND character_id = ?
       AND id IN (${ids.map(() => "?").join(", ")})
       AND asset_status = 'uploaded'
     ORDER BY created_at ASC
     ${lock ? "FOR UPDATE" : ""}`,
    [guest.id, guest.site_id, guest.mascot_character_id, ...ids]
  );
  if (rows.length !== ids.length) throw createPublicError("One or more attachments are unavailable.", 400);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    return { id, attachment: normalizeAttachmentPayload(parseJsonObject(row.attachment_json)) };
  });
}

export async function markGuestAttachmentAttached(db, { id, guestSessionId, characterId, requestKey, messageId }) {
  const [result] = await db.execute(
    `UPDATE guest_chat_attachments
     SET asset_status = 'attached', request_key = ?, message_id = ?, updated_at = NOW(3)
     WHERE id = ? AND guest_session_id = ? AND character_id = ? AND asset_status = 'uploaded'`,
    [requestKey, messageId, id, guestSessionId, String(characterId || "").trim()]
  );
  if (Number(result.affectedRows || 0) !== 1) throw createPublicError("Attachment state changed. Please try again.", 409);
}

export async function listGuestAttachmentsForRequest(db, { guestSessionId, characterId, requestKey }) {
  const [rows] = await db.execute(
    `SELECT attachment_json
     FROM guest_chat_attachments
     WHERE guest_session_id = ? AND character_id = ? AND request_key = ? AND asset_status = 'attached'
     ORDER BY created_at ASC`,
    [guestSessionId, String(characterId || "").trim(), requestKey]
  );
  return rows.map((row) => normalizeAttachmentPayload(parseJsonObject(row.attachment_json)));
}

export async function listPendingGuestAttachments(db, guestSessionId, characterId = "") {
  const characterFilter = String(characterId || "").trim() ? "AND character_id = ?" : "";
  const values = String(characterId || "").trim() ? [guestSessionId, String(characterId).trim()] : [guestSessionId];
  const [rows] = await db.execute(
    `SELECT id, attachment_json FROM guest_chat_attachments
     WHERE guest_session_id = ? ${characterFilter} AND asset_status = 'uploaded'
     ORDER BY created_at ASC LIMIT 5`,
    values
  );
  return rows.map((row) => ({ ...normalizeAttachmentPayload(parseJsonObject(row.attachment_json)), guestAttachmentId: row.id }));
}

export async function deleteGuestPendingAttachment({ guest, attachmentId }) {
  const normalizedId = String(attachmentId || "").trim();
  if (!guest?.id || !/^guest_attachment_[a-zA-Z0-9-]+$/.test(normalizedId)) throw createPublicError("Attachment not found.", 404);
  const connection = await getDbPool().getConnection();
  let storedName = "";
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT stored_name FROM guest_chat_attachments
       WHERE id = ? AND guest_session_id = ? AND site_id = ? AND character_id = ? AND asset_status = 'uploaded'
       LIMIT 1 FOR UPDATE`,
      [normalizedId, guest.id, guest.site_id, guest.mascot_character_id]
    );
    if (!rows[0]) throw createPublicError("Attachment not found.", 404);
    storedName = rows[0].stored_name;
    await deleteGuestAttachmentStoredFiles({ id: normalizedId, storedName, attemptToken: "" });
    await connection.execute("DELETE FROM guest_chat_attachments WHERE id = ?", [normalizedId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { ok: true };
}

function normalizeAttachmentIds(values = []) {
  if (!Array.isArray(values)) return [];
  const unique = [...new Set(values.map((value) => String(value?.guestAttachmentId || value || "").trim()).filter(Boolean))];
  if (unique.length > MAX_ATTACHMENTS_PER_TURN) throw createPublicError("You can send up to five attachments at a time.", 400);
  if (unique.some((id) => !/^guest_attachment_[a-zA-Z0-9-]+$/.test(id))) throw createPublicError("Attachment id is invalid.", 400);
  return unique;
}

async function consumeAttachmentUploadBudget(db, { guest, networkHash, reservedBytes }) {
  const now = new Date(guest.db_now).getTime();
  const guestStartedAt = new Date(guest.attachment_window_started_at || 0).getTime();
  const guestFresh = !guestStartedAt || now - guestStartedAt >= UPLOAD_WINDOW_MS;
  const guestCount = guestFresh ? 0 : Number(guest.attachment_window_count || 0);
  const guestBytes = guestFresh ? 0 : Number(guest.attachment_window_bytes || 0);
  if (guestCount >= GUEST_UPLOAD_LIMIT || guestBytes + reservedBytes > GUEST_UPLOAD_BYTES_LIMIT) {
    throw createPublicError("Guest attachment upload limit reached. Please try again later.", 429);
  }
  await db.execute(
    `UPDATE guest_sessions SET attachment_window_started_at = ?, attachment_window_count = ?, attachment_window_bytes = ? WHERE id = ?`,
    [guestFresh ? guest.db_now : guest.attachment_window_started_at, guestCount + 1, guestBytes + reservedBytes, guest.id]
  );
  await db.execute("INSERT IGNORE INTO guest_network_rate_limits (network_hash, site_id) VALUES (?, ?)", [networkHash, guest.site_id]);
  const [networkRows] = await db.execute(
    "SELECT *, NOW(3) AS db_now FROM guest_network_rate_limits WHERE network_hash = ? AND site_id = ? LIMIT 1 FOR UPDATE",
    [networkHash, guest.site_id]
  );
  const network = networkRows[0];
  const networkNow = new Date(network.db_now).getTime();
  const networkStartedAt = new Date(network.upload_window_started_at || 0).getTime();
  const networkFresh = !networkStartedAt || networkNow - networkStartedAt >= UPLOAD_WINDOW_MS;
  const networkCount = networkFresh ? 0 : Number(network.upload_window_count || 0);
  const networkBytes = networkFresh ? 0 : Number(network.upload_window_bytes || 0);
  if (networkCount >= NETWORK_UPLOAD_LIMIT || networkBytes + reservedBytes > NETWORK_UPLOAD_BYTES_LIMIT) {
    throw createPublicError("Guest upload traffic is busy. Please try again later.", 429);
  }
  await db.execute(
    `UPDATE guest_network_rate_limits
     SET upload_window_started_at = ?, upload_window_count = ?, upload_window_bytes = ?, updated_at = NOW(3)
     WHERE network_hash = ? AND site_id = ?`,
    [networkFresh ? network.db_now : network.upload_window_started_at, networkCount + 1, networkBytes + reservedBytes, networkHash, guest.site_id]
  );
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

async function recoverFinalizingGuestAttachment(db, { existing, dbNow }) {
  const now = new Date(dbNow).getTime();
  if (now - new Date(existing.updated_at).getTime() < UPLOAD_LEASE_MS) {
    throw createPublicError("This attachment is still uploading.", 409);
  }
  const attachment = normalizeAttachmentPayload(parseJsonObject(existing.attachment_json));
  const finalStoredName = String(existing.stored_name || "").trim();
  const temporaryStoredName = buildGuestAttachmentAttemptStoredName({
    id: existing.id,
    storedName: finalStoredName,
    attemptToken: existing.attempt_token,
  });
  let finalExists = finalStoredName ? await storedChatAttachmentUploadExists(finalStoredName) : false;
  if (!finalExists && temporaryStoredName && await storedChatAttachmentUploadExists(temporaryStoredName)) {
    try {
      await moveStoredChatAttachmentUpload(temporaryStoredName, finalStoredName);
    } catch (error) {
      if (!(await storedChatAttachmentUploadExists(finalStoredName))) throw error;
    }
    finalExists = true;
  }
  if (finalExists && attachment.storedName === finalStoredName) {
    const [uploaded] = await db.execute(
      `UPDATE guest_chat_attachments
       SET asset_status = 'uploaded', attempt_token = NULL, updated_at = NOW(3)
       WHERE id = ? AND asset_status = 'finalizing' AND attempt_token = ?`,
      [existing.id, existing.attempt_token]
    );
    if (Number(uploaded.affectedRows || 0) !== 1) throw createPublicError("This attachment upload is unavailable.", 409);
    return attachment;
  }
  await db.execute(
    `UPDATE guest_chat_attachments
     SET asset_status = 'uploading', attempt_token = NULL, attachment_json = JSON_OBJECT()
     WHERE id = ? AND asset_status = 'finalizing' AND attempt_token = ?`,
    [existing.id, existing.attempt_token]
  );
  return null;
}
