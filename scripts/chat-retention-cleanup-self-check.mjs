import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { cleanupExpiredChatMessages } from "../server/chat-retention-cleanup-service.js";
import { deleteStoredChatImageAsset, getChatImageStorageName } from "../server/chat-image-asset-service.js";
import { resolveElevenLabsTtsConfig } from "../server/elevenlabs-tts-service.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY, CHAT_IMAGE_UPLOAD_POLICY, CHAT_VOICE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "chat retention cleanup self-check" });
await initializeDatabase();
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const characterId = `char_retention_${suffix}`.slice(0, 64);
const sessionId = `chat_retention_${suffix}`.slice(0, 64);
const oldImageId = `msg_retention_image_${suffix}`.slice(0, 64);
const oldAiVoiceId = `msg_retention_ai_voice_${suffix}`.slice(0, 64);
const oldUserVoiceId = `msg_retention_user_voice_${suffix}`.slice(0, 64);
const oldAttachmentId = `msg_retention_attachment_${suffix}`.slice(0, 64);
const recentId = `msg_retention_recent_${suffix}`.slice(0, 64);
const activeId = `msg_retention_active_${suffix}`.slice(0, 64);
const imageId = `img_retention_old_${suffix}`.slice(0, 64);
const aiVoiceAssetId = `voice_retention_ai_${suffix}`.slice(0, 64);
const userVoiceAssetId = `voice_retention_user_${suffix}`.slice(0, 64);
const imageName = getChatImageStorageName(imageId);
const aiVoiceName = `${aiVoiceAssetId}.mp3`;
const userVoiceName = `voice-retention-${suffix}.wav`;
const attachmentName = `chat-retention-${suffix}.txt`;
const mediaPaths = [
  join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, imageName),
  join(resolveElevenLabsTtsConfig().outputDir, aiVoiceName),
  join(CHAT_VOICE_UPLOAD_POLICY.uploadDir, userVoiceName),
  join(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, attachmentName),
];
const fixtureMessageIds = [oldImageId, oldAiVoiceId, oldUserVoiceId, oldAttachmentId, recentId, activeId];
const now = new Date();

try {
  const [[site]] = await db.execute("SELECT id FROM sites ORDER BY id LIMIT 1");
  assert.ok(site?.id, "local site is required");
  await db.execute(
    `INSERT INTO ai_characters (id, category_id, slug, name, role_title, avatar_url, visibility, character_status, source_type, source_ref, published_at)
     VALUES (?, 'mascot', ?, 'Retention cleanup self-check', 'Self-check', 'assets/char_coach.png', 'public', 'published', 'self-check', 'retention-cleanup', NOW(3))`,
    [characterId, `retention-cleanup-${suffix}`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, NULL, NULL, ?, 'Retention cleanup self-check', 'active', 'user', 'retention-cleanup', 'English', NOW(3))`,
    [sessionId, characterId]
  );

  await insertMessage(oldImageId, new Date(now.getTime() - 181 * 86400000), { contentType: "image_generation" });
  await insertVoiceAsset(aiVoiceAssetId, oldAiVoiceId, "ai_reply", `/uploads/voice/ai/${aiVoiceName}`);
  await insertMessage(oldAiVoiceId, new Date(now.getTime() - 181 * 86400000), { voiceAssetId: aiVoiceAssetId });
  await insertVoiceAsset(userVoiceAssetId, null, "user_message", `/uploads/voice/${userVoiceName}`);
  await insertMessage(oldUserVoiceId, new Date(now.getTime() - 181 * 86400000), { voiceAssetId: userVoiceAssetId });
  await insertMessage(oldAttachmentId, new Date(now.getTime() - 181 * 86400000), {
    contentType: "attachment",
    payload: { kind: "document", storedName: attachmentName, url: `/api/uploads/chat/${attachmentName}` },
  });
  await insertMessage(recentId, new Date(now.getTime() - 179 * 86400000));
  await insertMessage(activeId, new Date(now.getTime() - 181 * 86400000));

  await db.execute(
    `INSERT INTO chat_image_assets (id, message_id, session_id, character_id, status, storage_path, mime_type)
     VALUES (?, ?, ?, ?, 'ready', ?, 'image/webp'), (?, ?, ?, ?, 'queued', ?, 'image/webp')`,
    [imageId, oldImageId, sessionId, characterId, imageName, `img_retention_active_${suffix}`, activeId, sessionId, characterId, `active-${imageName}`]
  );

  for (const path of mediaPaths) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, Buffer.from("retention self-check fixture"));
  }

  const releasedLocks = [];
  const lockFactory = async (lockedImageId) => async () => {
    const [[row]] = await db.execute("SELECT id FROM chat_messages WHERE id = ?", [oldImageId]);
    releasedLocks.push({ lockedImageId, messageStillExists: Boolean(row?.id) });
  };

  let failImageDelete = true;
  const firstAttempt = await cleanupExpiredChatMessages({
    cutoff: new Date(now.getTime() - 180 * 86400000),
    limit: 20,
    sessionId,
    acquireImageLock: lockFactory,
    deleteImage: async ({ assetId: deletingId }) => {
      if (deletingId === imageId && failImageDelete) throw new Error("simulated file deletion failure");
      return deleteStoredChatImageAsset({ assetId: deletingId });
    },
  });
  assert.equal(firstAttempt.deletedMessages, 3, "other expired messages should proceed when one media deletion fails");
  assert.equal(firstAttempt.skippedMessages, 1, "a message with a failed file deletion must remain retryable");
  assert.equal(await exists(mediaPaths[0]), true, "failed image deletion must keep the media file");
  const [[failedMessage]] = await db.execute("SELECT id FROM chat_messages WHERE id = ?", [oldImageId]);
  const [[failedImage]] = await db.execute("SELECT id FROM chat_image_assets WHERE id = ?", [imageId]);
  assert.equal(failedMessage?.id, oldImageId, "failed media cleanup must leave the message intact");
  assert.equal(failedImage?.id, imageId, "failed media cleanup must leave the metadata intact");
  assert.equal(releasedLocks.some((lock) => lock.lockedImageId === imageId && lock.messageStillExists), true, "failed cleanup releases its image lock without deleting its database rows");

  failImageDelete = false;
  const retry = await cleanupExpiredChatMessages({
    cutoff: new Date(now.getTime() - 180 * 86400000),
    limit: 20,
    sessionId,
    acquireImageLock: lockFactory,
  });
  assert.equal(retry.deletedMessages, 1, "retry should delete the retained message after file cleanup succeeds");
  assert.equal(retry.scannedMessages, 1, "queued image generation must be excluded from cleanup candidates");

  const [[recentRow]] = await db.execute("SELECT id FROM chat_messages WHERE id = ?", [recentId]);
  const [[activeRow]] = await db.execute("SELECT id FROM chat_messages WHERE id = ?", [activeId]);
  assert.equal(recentRow?.id, recentId, "179-day message must be retained");
  assert.equal(activeRow?.id, activeId, "an active image generation must not be removed");
  for (const assetId of [aiVoiceAssetId, userVoiceAssetId]) {
    const [[row]] = await db.execute("SELECT id FROM character_voice_assets WHERE id = ?", [assetId]);
    assert.equal(row, undefined, "voice metadata linked to an expired message must be removed");
  }
  for (const path of mediaPaths) {
    assert.equal(await exists(path), false, "expired message media file must be removed");
  }
  assert.equal(releasedLocks.some((lock) => lock.lockedImageId === imageId && lock.messageStillExists === false), true, "image worker lock must be released after the message deletion commits");
  console.log("chat retention cleanup self-check passed");
} finally {
  await db.execute("DELETE FROM chat_image_assets WHERE message_id IN (?)", [oldImageId]).catch(() => {});
  await db.execute(
    `DELETE FROM chat_messages WHERE id IN (${fixtureMessageIds.map(() => "?").join(", ")})`,
    fixtureMessageIds
  ).catch(() => {});
  await db.execute("DELETE FROM character_voice_assets WHERE id IN (?, ?)", [aiVoiceAssetId, userVoiceAssetId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await Promise.all(mediaPaths.map((path) => rm(path, { force: true }).catch(() => {})));
  await closeDbPool();
}

async function insertMessage(id, sentAt, { contentType = "text", payload = null, voiceAssetId = null } = {}) {
  await db.execute(
    `INSERT INTO chat_messages (id, session_id, character_id, sender_type, sender_label, content_type, text_content, voice_asset_id, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at)
     VALUES (?, ?, ?, 'user', 'Self-check', ?, 'retention cleanup fixture', ?, ?, 1, 'sent', 'user', 'retention-cleanup', ?)`,
    [id, sessionId, characterId, contentType, voiceAssetId, payload ? JSON.stringify(payload) : null, sentAt]
  );
}

async function insertVoiceAsset(id, messageId, assetType, audioUrl) {
  await db.execute(
    `INSERT INTO character_voice_assets (id, character_id, asset_type, title, transcript, duration_seconds, audio_url, asset_status, source_type, source_ref, message_id)
     VALUES (?, ?, ?, 'Retention self-check', 'fixture', 1, ?, 'ready', 'self-check', 'retention-cleanup', ?)`,
    [id, characterId, assetType, audioUrl, messageId]
  );
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
