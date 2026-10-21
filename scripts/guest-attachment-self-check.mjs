import { restore, assertFixtureTransport } from "./fixtures/chat-image-classifier-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeDbPool, getDbPool } from "../server/db.js";
import { createToken, hashSessionToken } from "../server/security.js";
import { buildGuestAttachmentAttemptStoredName, completeGuestChatAttachmentUpload, reserveGuestChatAttachmentUpload, saveGuestChatAttachment } from "../server/guest-chat-attachment-service.js";
import { sendGuestMessage } from "../server/guest-chat-service.js";
import { requireGuestChatAttachmentAccess } from "../server/protected-upload-routes.js";
import { deleteStoredChatAttachmentUpload } from "../server/chat-upload-service.js";
import { cleanupExpiredGuestSessions } from "../server/guest-session-cleanup-service.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "../server/upload-policies.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest attachment self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const owner = fixtureIds("owner", suffix);
const other = fixtureIds("other", suffix);
const networkHash = `attachment_network_${suffix}`;
let site = null;
let storedName = "";
let staleStoredName = "";
let recoveryStoredName = "";

try {
  [[site]] = await db.execute(
    `SELECT s.id, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk' AND s.guest_chat_enabled = 1 LIMIT 1`
  );
  assert.ok(site?.id && site?.character_id, "enabled FKK guest mascot is required");
  await createFixture(owner, site);
  await createFixture(other, site);
  const attachment = await saveGuestChatAttachment({
    guest: {
      id: owner.guestId,
      site_id: site.id,
      mascot_character_id: site.character_id,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
    clientUploadId: `upload_${suffix}`,
    networkHash,
    reservedBytes: 35,
    buffer: Buffer.from("guest attachment self-check"),
    contentType: "text/plain",
    filename: "guest-check.txt",
    originalName: "notes.txt",
    originalSha256: "a".repeat(64),
  });
  storedName = attachment.storedName;
  assert.ok(attachment.guestAttachmentId, "guest upload should return an opaque attachment asset id");
  assert.equal("uploadedBy" in attachment, false, "guest upload response must not leak the internal guest id");
  const retriedUpload = await saveGuestChatAttachment({
    guest: { id: owner.guestId, site_id: site.id, mascot_character_id: site.character_id },
    clientUploadId: `upload_${suffix}`,
    networkHash,
    reservedBytes: 35,
    buffer: Buffer.from("this retry body must not create another file"),
    contentType: "text/plain",
    filename: "guest-check-retry.txt",
    originalName: "retry.txt",
  });
  assert.equal(retriedUpload.guestAttachmentId, attachment.guestAttachmentId, "same upload id should reuse the completed attachment asset");
  const [[uploadCount]] = await db.execute("SELECT COUNT(*) AS count FROM guest_chat_attachments WHERE guest_session_id = ?", [owner.guestId]);
  assert.equal(Number(uploadCount.count), 1, "upload response retry must not create another pending row or file");

  const requestKey = `attachment_turn_${suffix}`;
  const first = await sendGuestMessage({
    token: owner.token,
    text: "",
    attachments: [attachment.guestAttachmentId],
    clientMessageId: requestKey,
    networkHash,
    deferReply: true,
  });
  const firstMessages = Array.isArray(first.messages) ? first.messages : first.items || [];
  const attachmentMessage = firstMessages.find((message) => message.contentType === "attachment");
  assert.ok(attachmentMessage?.id, "attachment-only guest turn should create an attachment message");
  assert.equal(attachmentMessage.attachment?.url, `/api/uploads/chat/${storedName}`);
  await requireGuestChatAttachmentAccess(owner.token, storedName);
  await assert.rejects(
    () => requireGuestChatAttachmentAccess(other.token, storedName),
    (error) => Number(error?.statusCode || 0) === 403,
    "another guest must not read the attachment"
  );

  await sendGuestMessage({
    token: owner.token,
    text: "",
    attachments: [attachment.guestAttachmentId],
    clientMessageId: requestKey,
    networkHash,
    deferReply: true,
  });
  const [[state]] = await db.execute(
    `SELECT COALESCE(gcs.message_window_count, g.message_window_count) AS message_window_count, a.asset_status, a.request_key,
            (SELECT COUNT(*) FROM chat_messages WHERE session_id = ? AND client_message_id = ?) AS primary_count,
            (SELECT COUNT(*) FROM chat_messages WHERE session_id = ? AND content_type = 'attachment') AS attachment_count
     FROM guest_sessions g
     JOIN guest_chat_attachments a ON a.guest_session_id = g.id
     LEFT JOIN guest_character_sessions gcs ON gcs.guest_session_id = g.id AND gcs.character_id = a.character_id
     WHERE g.id = ? AND a.id = ?`,
    [owner.sessionId, requestKey, owner.sessionId, owner.guestId, attachment.guestAttachmentId]
  );
  assert.equal(Number(state.message_window_count), 1, "attachment turn should consume shared guest quota once");
  assert.equal(state.asset_status, "attached");
  assert.equal(state.request_key, requestKey);
  assert.equal(Number(state.primary_count), 1, "attachment retry should preserve one idempotency marker");
  assert.equal(Number(state.attachment_count), 1, "attachment retry should not duplicate the message");
  await assert.rejects(
    () => saveGuestChatAttachment({
      guest: { id: owner.guestId, site_id: site.id, mascot_character_id: site.character_id },
      clientUploadId: `upload_${suffix}`,
      networkHash,
      reservedBytes: 35,
      buffer: Buffer.from("attached asset must remain terminal"),
      contentType: "text/plain",
      filename: "terminal.txt",
      originalName: "terminal.txt",
    }),
    (error) => Number(error?.statusCode || 0) === 409,
    "attached upload ids must never reopen as uploading"
  );
  const [[terminalState]] = await db.execute("SELECT asset_status, stored_name FROM guest_chat_attachments WHERE id = ?", [attachment.guestAttachmentId]);
  assert.equal(terminalState.asset_status, "attached");
  assert.equal(terminalState.stored_name, storedName, "terminal attached asset must keep its original file binding");
  await stat(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, storedName));

  const staleClientUploadId = `stale_upload_${suffix}`;
  const staleFirst = await reserveGuestChatAttachmentUpload({
    guest: { id: other.guestId, site_id: site.id, mascot_character_id: site.character_id },
    clientUploadId: staleClientUploadId,
    networkHash,
    reservedBytes: 35,
    storageExtension: ".txt",
  });
  const staleFirstTemp = buildGuestAttachmentAttemptStoredName({
    id: staleFirst.id,
    storedName: `${staleFirst.id}.txt`,
    attemptToken: staleFirst.attemptToken,
  });
  await writeFile(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, staleFirstTemp), Buffer.from("orphaned old attempt payload"));
  await db.execute(
    "UPDATE guest_chat_attachments SET updated_at = DATE_SUB(NOW(3), INTERVAL 3 MINUTE) WHERE id = ?",
    [staleFirst.id]
  );
  const staleSecond = await reserveGuestChatAttachmentUpload({
    guest: { id: other.guestId, site_id: site.id, mascot_character_id: site.character_id },
    clientUploadId: staleClientUploadId,
    networkHash,
    reservedBytes: 35,
    storageExtension: ".txt",
  });
  assert.equal(staleSecond.id, staleFirst.id, "stale upload takeover should reuse the reservation row");
  assert.notEqual(staleSecond.attemptToken, staleFirst.attemptToken, "stale upload takeover must rotate the attempt token");
  const staleWinner = await completeGuestChatAttachmentUpload({
    guest: { id: other.guestId },
    reservationId: staleSecond.id,
    attemptToken: staleSecond.attemptToken,
    buffer: Buffer.from("new worker payload wins"),
    contentType: "text/plain",
    filename: "stale-winner.txt",
    originalName: "stale-winner.txt",
  });
  staleStoredName = staleWinner.storedName;
  await assert.rejects(
    () => stat(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, staleFirstTemp)),
    (error) => error?.code === "ENOENT",
    "winner completion should clean historical attempt files left before takeover"
  );
  await assert.rejects(
    () => completeGuestChatAttachmentUpload({
      guest: { id: other.guestId },
      reservationId: staleFirst.id,
      attemptToken: staleFirst.attemptToken,
      buffer: Buffer.from("late old worker payload must lose"),
      contentType: "text/plain",
      filename: "stale-loser.txt",
      originalName: "stale-loser.txt",
    }),
    (error) => Number(error?.statusCode || 0) === 409,
    "a late stale worker must lose its fenced completion"
  );
  const [[staleState]] = await db.execute(
    "SELECT asset_status, attempt_token, stored_name FROM guest_chat_attachments WHERE id = ?",
    [staleFirst.id]
  );
  assert.equal(staleState.asset_status, "uploaded");
  assert.equal(staleState.attempt_token, null);
  assert.equal(staleState.stored_name, staleStoredName);
  assert.equal((await readFile(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, staleStoredName), "utf8")), "new worker payload wins");
  const staleLoserTemp = buildGuestAttachmentAttemptStoredName({
    id: staleFirst.id,
    storedName: staleStoredName,
    attemptToken: staleFirst.attemptToken,
  });
  await assert.rejects(
    () => stat(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, staleLoserTemp)),
    (error) => error?.code === "ENOENT",
    "late stale worker must remove only its own temporary file"
  );
  await writeFile(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, staleLoserTemp), Buffer.from("late orphan after winner completion"));
  await db.execute("UPDATE guest_chat_attachments SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?", [staleFirst.id]);
  await cleanupExpiredGuestSessions({ now: new Date(), limit: 500 });
  await assert.rejects(
    () => stat(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, staleLoserTemp)),
    (error) => error?.code === "ENOENT",
    "expiry cleanup should remove historical attempt files even after the current token was cleared"
  );

  const recoveryClientUploadId = `recovery_upload_${suffix}`;
  const recoveryReservation = await reserveGuestChatAttachmentUpload({
    guest: { id: other.guestId, site_id: site.id, mascot_character_id: site.character_id },
    clientUploadId: recoveryClientUploadId,
    networkHash,
    reservedBytes: 35,
    storageExtension: ".txt",
  });
  recoveryStoredName = `${recoveryReservation.id}.txt`;
  const recoveryTempName = buildGuestAttachmentAttemptStoredName({
    id: recoveryReservation.id,
    storedName: recoveryStoredName,
    attemptToken: recoveryReservation.attemptToken,
  });
  const recoveryPayload = {
    kind: "document",
    name: "recovery.txt",
    storedName: recoveryStoredName,
    url: `/api/uploads/chat/${recoveryStoredName}`,
    size: 24,
    mimeType: "text/plain",
    sha256: "b".repeat(64),
    originalSha256: "",
    processed: { renamed: true, imageCompressed: false, documentPreserved: true },
  };
  await writeFile(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, recoveryTempName), Buffer.from("recover finalizing upload"));
  await db.execute(
    `UPDATE guest_chat_attachments
     SET asset_status = 'finalizing', attachment_json = ?, updated_at = DATE_SUB(NOW(3), INTERVAL 3 MINUTE)
     WHERE id = ?`,
    [JSON.stringify(recoveryPayload), recoveryReservation.id]
  );
  const recoveredFromTemp = await reserveGuestChatAttachmentUpload({
    guest: { id: other.guestId, site_id: site.id, mascot_character_id: site.character_id },
    clientUploadId: recoveryClientUploadId,
    networkHash,
    reservedBytes: 35,
    storageExtension: ".txt",
  });
  assert.equal(recoveredFromTemp.reused, true, "stale finalizing temp should recover as a completed upload");
  assert.equal((await readFile(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, recoveryStoredName), "utf8")), "recover finalizing upload");
  await db.execute(
    `UPDATE guest_chat_attachments
     SET asset_status = 'finalizing', attempt_token = ?, updated_at = DATE_SUB(NOW(3), INTERVAL 3 MINUTE)
     WHERE id = ?`,
    [recoveryReservation.attemptToken, recoveryReservation.id]
  );
  const recoveredFromFinal = await reserveGuestChatAttachmentUpload({
    guest: { id: other.guestId, site_id: site.id, mascot_character_id: site.character_id },
    clientUploadId: recoveryClientUploadId,
    networkHash,
    reservedBytes: 35,
    storageExtension: ".txt",
  });
  assert.equal(recoveredFromFinal.reused, true, "stale finalizing final file should repair the uploaded state idempotently");
  const [[recoveredState]] = await db.execute("SELECT asset_status, attempt_token FROM guest_chat_attachments WHERE id = ?", [recoveryReservation.id]);
  assert.equal(recoveredState.asset_status, "uploaded");
  assert.equal(recoveredState.attempt_token, null);

  const crashReservation = await reserveGuestChatAttachmentUpload({
    guest: { id: other.guestId, site_id: site.id, mascot_character_id: site.character_id },
    clientUploadId: `crash_upload_${suffix}`,
    networkHash,
    reservedBytes: 35,
    storageExtension: ".txt",
  });
  const crashFileName = buildGuestAttachmentAttemptStoredName({
    id: crashReservation.id,
    storedName: `${crashReservation.id}.txt`,
    attemptToken: crashReservation.attemptToken,
  });
  const crashFilePath = resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, crashFileName);
  await mkdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { recursive: true });
  await writeFile(crashFilePath, Buffer.from("written before attachment DB finalize"));
  await db.execute("UPDATE guest_chat_attachments SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id = ?", [crashReservation.id]);
  await cleanupExpiredGuestSessions({ now: new Date(), limit: 500 });
  await assert.rejects(
    () => stat(crashFilePath),
    (error) => error?.code === "ENOENT",
    "cleanup must find a deterministic file written before DB finalize"
  );

  const [routeSource, attachmentServiceSource, protectedSource, textActionSource, composerSource, composerAttachmentSource, attachmentActionSource, dataActionSource, clientServiceSource] = await Promise.all([
    readFile(new URL("../server/guest-chat-routes.js", import.meta.url), "utf8"),
    readFile(new URL("../server/guest-chat-attachment-service.js", import.meta.url), "utf8"),
    readFile(new URL("../server/protected-upload-routes.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/chat-text-actions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/chat/chat-composer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/chat/chat-composer-attachment.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/chat-attachment-actions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app/chat-data-actions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/services/guest-chat-service.js", import.meta.url), "utf8"),
  ]);
  assert.match(routeSource, /\/api\/guest\/uploads\/chat/, "guest attachment upload endpoint should exist");
  assert.match(routeSource, /reserveGuestChatAttachmentUpload[\s\S]*readRequestBuffer/, "attachment budget and idempotency reservation must run before the body is buffered");
  assert.match(attachmentServiceSource, /guest_session_id = \?[\s\S]*site_id = \?[\s\S]*character_id = \?/, "attachment resolution must freeze guest, site and mascot ownership");
  assert.doesNotMatch(
    attachmentServiceSource,
    /asset_status === "uploaded"[\s\S]{0,240}deleteStoredChatAttachmentAttempts/,
    "uploaded idempotency retries must not trigger an unmetered shared-directory scan"
  );
  assert.match(protectedSource, /requireGuestChatAttachmentAccess/, "protected attachment reads should support guest ownership checks");
  assert.match(textActionSource, /pendingAttachmentIds[\s\S]*requestFingerprint/, "guest attachment sends should reuse a stable idempotency key on retry");
  assert.match(composerSource, /if \(allowAttachments\) bindChatAttachmentInput/, "attachment controls should be capability-driven");
  assert.match(composerAttachmentSource, /maxFiles:\s*remainingSlots|maxFiles = 5/, "attachment picker should honor remaining pending slots");
  assert.match(attachmentActionSource, /await deleteGuestPendingChatAttachment[\s\S]*pendingAttachmentsByCharacterId/, "guest chip should remain until server deletion succeeds");
  assert.match(dataActionSource, /result\.guest\.pendingAttachments/, "guest refresh should restore server-owned pending attachments");
  assert.match(clientServiceSource, /X-Client-Upload-Id/, "attachment response retries should reuse a stable upload id");

  assertFixtureTransport();
  console.log("guest attachment self-check passed");
} finally {
  restore();
  await cleanupFixture(owner);
  await cleanupFixture(other);
  if (site?.id) await db.execute("DELETE FROM guest_network_rate_limits WHERE network_hash = ? AND site_id = ?", [networkHash, site.id]).catch(() => {});
  if (storedName) await deleteStoredChatAttachmentUpload(storedName).catch(() => {});
  if (staleStoredName) await deleteStoredChatAttachmentUpload(staleStoredName).catch(() => {});
  if (recoveryStoredName) await deleteStoredChatAttachmentUpload(recoveryStoredName).catch(() => {});
  await closeDbPool();
}

function fixtureIds(label, compact) {
  return {
    guestId: `guest_attachment_${label}_${compact}`.slice(0, 64),
    sessionId: `chat_attachment_${label}_${compact}`.slice(0, 64),
    token: createToken(),
  };
}

async function createFixture(fixture, currentSite) {
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [fixture.guestId, hashSessionToken(fixture.token), currentSite.id, currentSite.character_id, fixture.sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, last_message_at)
     VALUES (?, NULL, ?, ?, 'Guest attachment self-check', 'active', 'guest', 'guest-attachment-self-check', NOW(3))`,
    [fixture.sessionId, fixture.guestId, currentSite.character_id]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [fixture.guestId]);
}

async function cleanupFixture(fixture) {
  await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [fixture.sessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_chat_attachments WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
  await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [fixture.sessionId]).catch(() => {});
  await db.execute("DELETE FROM guest_sessions WHERE id = ?", [fixture.guestId]).catch(() => {});
}
