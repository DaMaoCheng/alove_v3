import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeDbPool, getDbPool } from "../server/db.js";
import { getChatImageStorageName, saveMockChatImageAsset } from "../server/chat-image-asset-service.js";
import { acquireChatImageJobLock } from "../server/chat-image-job-service.js";
import { cleanupExpiredGuestSessions } from "../server/guest-session-cleanup-service.js";
import { enqueueMemoryJob, MEMORY_JOB_TYPES } from "../server/memory-job-service.js";
import { createToken, hashSessionToken } from "../server/security.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY, CHAT_IMAGE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { resolveElevenLabsTtsConfig } from "../server/elevenlabs-tts-service.js";
import { generateReservedAiReplyVoiceAsset, reserveAiReplyVoiceAssetForDb } from "../server/chat-voice-asset-service.js";
import { attachVoiceAssetToMessage, insertMessage } from "../server/chat-message-store.js";
import { deleteGuestAttachmentStoredFiles } from "../server/guest-chat-attachment-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest session cleanup self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const expired = ids("expired", suffix);
const active = ids("active", suffix);
const running = ids("running", suffix);
const retained = ids("retained", suffix);
const concurrent = ids("concurrent", suffix);
const claimed = ids("claimed", suffix);
const pendingRace = ids("pending-race", suffix);
const createdFiles = new Set();
const createdVoiceFiles = new Set();
const createdAttachmentFiles = new Set();

try {
  const [[site]] = await db.execute(
    `SELECT s.id, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk'
     LIMIT 1`
  );
  assert.ok(site?.id && site?.character_id, "FKK site and mascot are required for guest cleanup self-check");
  const retentionExpiredAt = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000);
  await createFixture(expired, site, { expired: true, withImage: true, createdAt: retentionExpiredAt });
  await createFixture(active, site, { expired: false, withImage: false });
  await createFixture(running, site, { expired: true, withImage: true, createdAt: retentionExpiredAt });
  await createFixture(retained, site, { expired: true, withImage: true });
  await db.execute("UPDATE guest_chat_attachments SET expires_at = DATE_ADD(NOW(3), INTERVAL 1 DAY), message_id = ?, asset_status = 'sent' WHERE id = ?", [retained.messageId, retained.attachmentId]);
  await db.execute("UPDATE guest_call_sessions SET call_status = 'active', ended_at = NULL WHERE id = ?", [running.callId]);
  await db.execute("UPDATE guest_sessions SET active_call_id = ? WHERE id = ?", [running.callId, running.guestId]);
  await createFixture(claimed, site, { expired: true, withImage: true, createdAt: retentionExpiredAt });
  await db.execute(
    "UPDATE guest_sessions SET session_status = 'claimed', claimed_user_id = 'cleanup-self-check-user', claimed_at = NOW(3), target_chat_session_id = chat_session_id WHERE id = ?",
    [claimed.guestId]
  );
  await db.execute("UPDATE chat_image_assets SET status = 'generating', completed_at = NULL WHERE id = ?", [running.assetId]);
  await db.execute(
    "UPDATE guest_image_entitlements SET entitlement_status = 'reserved', consumed_at = NULL WHERE guest_session_id = ?",
    [running.guestId]
  );
  await db.execute("UPDATE memory_jobs SET job_status = 'running', started_at = NOW(3) WHERE session_id = ?", [running.sessionId]);

  const releaseRunningLock = await acquireChatImageJobLock(running.assetId);
  let cleanupSettled = false;
  const cleanupPromise = cleanupExpiredGuestSessions({ now: new Date(), limit: 20 }).finally(() => {
    cleanupSettled = true;
  });
  await waitForCleanupPending(running.guestId);
  assert.equal(cleanupSettled, false, "cleanup should wait for the running image asset lock");
  await stat(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, getChatImageStorageName(running.assetId)));
  await releaseRunningLock();
  const result = await cleanupPromise;
  assert.equal(result.expiredGuestSessionsDeleted, 2);
  assert.equal(result.expiredGuestImageFilesDeleted, 2);
  assert.equal(result.expiredGuestVoiceFilesDeleted, 2);
  assert.equal(result.expiredGuestAttachmentFilesDeleted, 2);

  const [[retainedCounts]] = await db.execute(
    `SELECT g.session_status,
       (SELECT COUNT(*) FROM guest_sessions WHERE id = ?) AS guests,
       (SELECT COUNT(*) FROM chat_sessions WHERE id = ?) AS sessions,
       (SELECT COUNT(*) FROM chat_image_assets WHERE guest_session_id = ?) AS assets,
       (SELECT COUNT(*) FROM character_voice_assets WHERE id = ?) AS voices,
       (SELECT COUNT(*) FROM guest_chat_attachments WHERE guest_session_id = ?) AS attachments
     FROM guest_sessions g WHERE g.id = ?`,
    [retained.guestId, retained.sessionId, retained.guestId, retained.voiceAssetId, retained.guestId, retained.guestId]
  );
  assert.deepEqual(
    {
      status: retainedCounts.session_status,
      guests: Number(retainedCounts.guests),
      sessions: Number(retainedCounts.sessions),
      assets: Number(retainedCounts.assets),
      voices: Number(retainedCounts.voices),
      attachments: Number(retainedCounts.attachments),
    },
    { status: "expired", guests: 1, sessions: 1, assets: 1, voices: 1, attachments: 1 },
    "expired guest data inside the 180-day retention window must be preserved"
  );

  const [[expiredCounts]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM guest_sessions WHERE id = ?) AS guests,
       (SELECT COUNT(*) FROM guest_image_entitlements WHERE guest_session_id = ?) AS entitlements,
       (SELECT COUNT(*) FROM chat_sessions WHERE id = ?) AS sessions,
       (SELECT COUNT(*) FROM chat_image_assets WHERE guest_session_id = ?) AS assets,
       (SELECT COUNT(*) FROM guest_call_sessions WHERE guest_session_id = ?) AS calls,
       (SELECT COUNT(*) FROM memory_jobs WHERE session_id = ?) AS jobs`,
    [expired.guestId, expired.guestId, expired.sessionId, expired.guestId, expired.guestId, expired.sessionId]
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(expiredCounts).map(([key, value]) => [key, Number(value)])),
    { guests: 0, entitlements: 0, sessions: 0, assets: 0, calls: 0, jobs: 0 },
    "expired unclaimed guest data should be removed as one cleanup unit"
  );
  const [[activeCount]] = await db.execute("SELECT COUNT(*) AS count FROM guest_sessions WHERE id = ? AND session_status = 'active'", [active.guestId]);
  assert.equal(Number(activeCount.count), 1, "unexpired guest sessions must be preserved");
  const [[claimedCounts]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM guest_sessions WHERE id = ?) AS guests,
       (SELECT COUNT(*) FROM guest_chat_attachments WHERE guest_session_id = ?) AS attachments,
       (SELECT COUNT(*) FROM guest_call_sessions WHERE guest_session_id = ?) AS calls`,
    [claimed.guestId, claimed.guestId, claimed.guestId]
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(claimedCounts).map(([key, value]) => [key, Number(value)])),
    { guests: 1, attachments: 1, calls: 1 },
    "claimed guest resources must not be removed by expiry cleanup"
  );
  await stat(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, claimed.attachmentFileName));
  await stat(resolve(resolveElevenLabsTtsConfig().outputDir, claimed.voiceFileName));
  await stat(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, claimed.imageFileName));
  for (const fileName of createdFiles) {
    if (fileName === claimed.imageFileName || fileName === retained.imageFileName) continue;
    await assert.rejects(
      () => stat(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName)),
      (error) => error?.code === "ENOENT",
      "expired guest image file should be removed"
    );
  }
  for (const fileName of createdVoiceFiles) {
    if (fileName === claimed.voiceFileName || fileName === retained.voiceFileName) continue;
    await assert.rejects(
      () => stat(resolve(resolveElevenLabsTtsConfig().outputDir, fileName)),
      (error) => error?.code === "ENOENT",
      "expired guest AI voice file should be removed"
    );
  }
  for (const fileName of createdAttachmentFiles) {
    if (fileName === claimed.attachmentFileName || fileName === retained.attachmentFileName) continue;
    await assert.rejects(
      () => stat(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fileName)),
      (error) => error?.code === "ENOENT",
      "expired guest attachment file should be removed"
    );
  }

  await createFixture(pendingRace, site, { expired: false, withImage: true });
  let releasePendingDelete;
  let markPendingDeleteStarted;
  const pendingDeleteStarted = new Promise((resolveStarted) => { markPendingDeleteStarted = resolveStarted; });
  const pendingDeleteGate = new Promise((resolveDelete) => { releasePendingDelete = resolveDelete; });
  const pendingCleanup = cleanupExpiredGuestSessions({
    now: new Date(),
    limit: 20,
    deleteAttachmentFiles: async (attachment) => {
      if (attachment.id === pendingRace.attachmentId) {
        markPendingDeleteStarted();
        await pendingDeleteGate;
      }
      return deleteGuestAttachmentStoredFiles(attachment);
    },
  });
  await pendingDeleteStarted;
  const claimConnection = await db.getConnection();
  let claimSettled = false;
  const claimDuringCleanup = (async () => {
    try {
      await claimConnection.beginTransaction();
      await claimConnection.execute(
        "UPDATE guest_sessions SET session_status = 'claimed', claimed_user_id = 'cleanup-race-user', claimed_at = NOW(3) WHERE id = ?",
        [pendingRace.guestId]
      );
      await claimConnection.commit();
    } finally {
      claimConnection.release();
      claimSettled = true;
    }
  })();
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  assert.equal(claimSettled, false, "claim should wait while pending attachment cleanup holds the guest lock");
  releasePendingDelete();
  await pendingCleanup;
  await claimDuringCleanup;
  const [[pendingRaceState]] = await db.execute(
    `SELECT g.session_status,
            (SELECT COUNT(*) FROM guest_chat_attachments WHERE guest_session_id = g.id) AS attachments
     FROM guest_sessions g WHERE g.id = ?`,
    [pendingRace.guestId]
  );
  assert.deepEqual(
    { status: pendingRaceState.session_status, attachments: Number(pendingRaceState.attachments) },
    { status: "claimed", attachments: 0 },
    "cleanup that wins the lock must finish before claim succeeds"
  );

  await createFixture(concurrent, site, { expired: true, withImage: false, createdAt: retentionExpiredAt });
  const concurrentVoice = await insertMessage(db, {
    sessionId: concurrent.sessionId,
    guestSessionId: concurrent.guestId,
    characterId: site.character_id,
    senderType: "character",
    senderLabel: "Guest cleanup",
    contentType: "text",
    text: "Concurrent voice cleanup.",
    displayOrder: 10,
    sourceType: "ai",
    sourceRef: "guest-concurrent-voice-cleanup",
  });
  const concurrentReservation = await reserveAiReplyVoiceAssetForDb(db, {
    messageId: concurrentVoice.id,
    characterId: site.character_id,
    speechText: concurrentVoice.text,
    voiceMeta: { provider: "elevenlabs", model: "eleven_v3", voiceId: "self-check", languageCode: "en", languageLabel: "English" },
    deterministic: true,
  });
  concurrent.voiceAssetId = concurrentReservation.id;
  await attachVoiceAssetToMessage(db, { messageId: concurrentVoice.id, voiceAssetId: concurrentReservation.id });
  await db.execute("UPDATE chat_messages SET sent_at = ? WHERE session_id = ?", [retentionExpiredAt, concurrent.sessionId]);
  let releaseDelayedProvider;
  let markProviderStarted;
  const providerStarted = new Promise((resolveStarted) => { markProviderStarted = resolveStarted; });
  const providerGate = new Promise((resolveProvider) => { releaseDelayedProvider = resolveProvider; });
  const concurrentGeneration = generateReservedAiReplyVoiceAsset({
    assetId: concurrentReservation.id,
    generateAudio: async ({ outputFileName, temporaryFileSuffix }) => {
      markProviderStarted();
      await providerGate;
      const config = resolveElevenLabsTtsConfig();
      const outputPath = resolve(config.outputDir, outputFileName);
      const temporaryPath = `${outputPath}.${temporaryFileSuffix}.tmp`;
      await mkdir(config.outputDir, { recursive: true });
      await writeFile(temporaryPath, Buffer.from("delayed guest voice"));
      return { status: "ready", audioUrl: `/uploads/voice/ai/${outputFileName}`, audioBytes: 19, durationSeconds: 2, outputFormat: "mp3", outputPath, temporaryPath };
    },
  });
  await providerStarted;
  const concurrentCleanupResult = await cleanupExpiredGuestSessions({ now: new Date(), limit: 500 });
  releaseDelayedProvider();
  const concurrentGenerationResult = await concurrentGeneration;
  assert.equal(concurrentCleanupResult.expiredGuestSessionsDeleted, 1);
  assert.equal(concurrentGenerationResult, null, "a cancelled guest voice generation must not report a ready asset");
  const [[concurrentCounts]] = await db.execute(
    `SELECT
       (SELECT COUNT(*) FROM guest_sessions WHERE id = ?) AS guests,
       (SELECT COUNT(*) FROM chat_sessions WHERE id = ?) AS sessions,
       (SELECT COUNT(*) FROM character_voice_assets WHERE id = ?) AS voices`,
    [concurrent.guestId, concurrent.sessionId, concurrentReservation.id]
  );
  assert.deepEqual(Object.fromEntries(Object.entries(concurrentCounts).map(([key, value]) => [key, Number(value)])), { guests: 0, sessions: 0, voices: 0 });
  await assert.rejects(
    () => stat(resolve(resolveElevenLabsTtsConfig().outputDir, `${concurrentReservation.id}.mp3`)),
    (error) => error?.code === "ENOENT",
    "cleanup racing delayed TTS must not leave a final voice file"
  );
  console.log("guest session cleanup self-check passed");
} finally {
  for (const fixture of [expired, active, running, retained, concurrent, claimed, pendingRace]) {
    await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [fixture.sessionId]).catch(() => {});
    await db.execute("DELETE FROM guest_chat_attachments WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_call_sessions WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [fixture.guestId]).catch(() => {});
    await db.execute("DELETE FROM character_voice_assets WHERE id = ?", [fixture.voiceAssetId]).catch(() => {});
    await db.execute("DELETE FROM chat_sessions WHERE id = ?", [fixture.sessionId]).catch(() => {});
    await db.execute("DELETE FROM guest_sessions WHERE id = ?", [fixture.guestId]).catch(() => {});
  }
  for (const fileName of createdFiles) {
    await unlink(resolve(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName)).catch(() => {});
  }
  for (const fileName of createdVoiceFiles) {
    await unlink(resolve(resolveElevenLabsTtsConfig().outputDir, fileName)).catch(() => {});
  }
  for (const fileName of createdAttachmentFiles) {
    await unlink(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fileName)).catch(() => {});
  }
  await closeDbPool();
}

async function waitForCleanupPending(guestSessionId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [[row]] = await db.execute("SELECT session_status FROM guest_sessions WHERE id = ?", [guestSessionId]);
    if (row?.session_status === "cleanup_pending") return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error("cleanup did not enter cleanup_pending before the wait deadline");
}

function ids(label, compact) {
  return {
    guestId: `guest_cleanup_${label}_${compact}`.slice(0, 64),
    sessionId: `chat_cleanup_${label}_${compact}`.slice(0, 64),
    messageId: `msg_cleanup_${label}_${compact}`.slice(0, 64),
    assetId: `img_cleanup_${label}_${compact}`.slice(0, 64),
    voiceMessageId: `msg_voice_cleanup_${label}_${compact}`.slice(0, 64),
    voiceAssetId: `voice_cleanup_${label}_${compact}`.slice(0, 64),
    voiceFileName: `voice_cleanup_${label}_${compact}.mp3`.slice(0, 120),
    attachmentId: `guest_attachment_cleanup_${label}_${compact}`.slice(0, 64),
    attachmentFileName: `chat-cleanup-${label}-${compact}.txt`.slice(0, 160),
    callId: `call_cleanup-${label}-${compact}`.slice(0, 64),
  };
}

async function createFixture(fixture, site, { expired, withImage, createdAt = null }) {
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, NOW(3)), COALESCE(?, NOW(3)))`,
    [
      fixture.guestId,
      hashSessionToken(createToken()),
      site.id,
      site.character_id,
      fixture.sessionId,
      expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60 * 60 * 1000),
      createdAt,
      createdAt,
    ]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Guest cleanup self-check', 'active', 'guest', 'guest-cleanup-self-check', NOW(3))`,
    [fixture.sessionId, fixture.guestId, site.character_id]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [fixture.guestId]);
  await db.execute(
    `INSERT INTO guest_call_sessions (
       id, guest_session_id, site_id, character_id, network_hash, lease_token, call_status,
       duration_milliseconds, turn_count, started_at, last_accounted_at, ended_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, 'cleanup-check', 'ended', 2000, 1, NOW(3), NOW(3), NOW(3), ?)`,
    [fixture.callId, fixture.guestId, site.id, site.character_id, "c".repeat(64), expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 60 * 60 * 1000)]
  );
  await enqueueMemoryJob({
    sessionId: fixture.sessionId,
    characterId: site.character_id,
    jobType: MEMORY_JOB_TYPES.GENERATE_CHAT_IMAGE,
    availableAt: new Date(Date.now() + 60 * 60 * 1000),
    payload: { assetId: fixture.assetId, messageId: fixture.messageId, phase: "mock" },
  });
  if (!withImage) return;
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type,
       text_content, display_order, delivery_status, source_type, source_ref
     ) VALUES (?, ?, ?, 'character', 'Guest cleanup', 'image_generation', 'Photo ready.', 10, 'ready', 'system', 'guest-cleanup-self-check')`,
    [fixture.messageId, fixture.sessionId, site.character_id]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, guest_session_id, character_id, sender_type, sender_label, content_type,
       text_content, display_order, delivery_status, source_type, source_ref
     ) VALUES (?, ?, ?, ?, 'character', 'Guest cleanup', 'text', 'Voice ready.', 20, 'sent', 'ai', 'guest-voice-cleanup-self-check')`,
    [fixture.voiceMessageId, fixture.sessionId, fixture.guestId, site.character_id]
  );
  const voiceConfig = resolveElevenLabsTtsConfig();
  await mkdir(voiceConfig.outputDir, { recursive: true });
  await writeFile(resolve(voiceConfig.outputDir, fixture.voiceFileName), Buffer.from("guest voice cleanup self-check"));
  createdVoiceFiles.add(fixture.voiceFileName);
  await db.execute(
    `INSERT INTO character_voice_assets (
       id, character_id, asset_type, title, transcript, provider, voice_id, model, language_code,
       language_label, audio_url, audio_bytes, character_count, estimated_credits, output_format,
       message_id, waveform_json, asset_status, source_type, source_ref
     ) VALUES (?, ?, 'ai_reply', 'Guest cleanup voice', 'Voice ready.', 'elevenlabs', 'self-check',
       'eleven_v3', 'en', 'English', ?, 30, 12, 12, 'mp3', ?, JSON_ARRAY(), 'ready', 'ai', 'guest-cleanup-self-check')`,
    [fixture.voiceAssetId, site.character_id, `/uploads/voice/ai/${fixture.voiceFileName}`, fixture.voiceMessageId]
  );
  await db.execute("UPDATE chat_messages SET voice_asset_id = ? WHERE id = ?", [fixture.voiceAssetId, fixture.voiceMessageId]);
  await mkdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { recursive: true });
  await writeFile(resolve(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fixture.attachmentFileName), Buffer.from("guest attachment cleanup self-check"));
  createdAttachmentFiles.add(fixture.attachmentFileName);
  await db.execute(
    `INSERT INTO guest_chat_attachments (
       id, guest_session_id, site_id, character_id, network_hash, client_upload_id, stored_name, attachment_json, asset_status, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', DATE_SUB(NOW(3), INTERVAL 1 MINUTE))`,
    [fixture.attachmentId, fixture.guestId, site.id, site.character_id, "cleanup-network-hash", `cleanup_${fixture.attachmentId}`.slice(0, 128), fixture.attachmentFileName, JSON.stringify({ kind: "document", name: "cleanup.txt", storedName: fixture.attachmentFileName, url: `/api/uploads/chat/${fixture.attachmentFileName}`, size: 35, mimeType: "text/plain" })]
  );
  const saved = await saveMockChatImageAsset({ assetId: fixture.assetId });
  fixture.imageFileName = saved.storagePath;
  createdFiles.add(saved.storagePath);
  await db.execute(
    `INSERT INTO chat_image_assets (
       id, message_id, session_id, internal_uid, guest_session_id, character_id,
       status, storage_path, protected_path, width, height, bytes, mime_type, provider, completed_at
     ) VALUES (?, ?, ?, NULL, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, 'mock', NOW(3))`,
    [
      fixture.assetId,
      fixture.messageId,
      fixture.sessionId,
      fixture.guestId,
      site.character_id,
      saved.storagePath,
      saved.protectedPath,
      saved.width,
      saved.height,
      saved.bytes,
      saved.mimeType,
    ]
  );
  if (createdAt) await db.execute("UPDATE chat_messages SET sent_at = ? WHERE session_id = ?", [createdAt, fixture.sessionId]);
  await db.execute(
    `UPDATE guest_image_entitlements
     SET entitlement_status = 'consumed', asset_id = ?, consumed_at = NOW(3)
     WHERE guest_session_id = ?`,
    [fixture.assetId, fixture.guestId]
  );
}
