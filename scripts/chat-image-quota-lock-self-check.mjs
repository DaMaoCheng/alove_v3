import { assertFixtureTransport, restore } from "./fixtures/chat-image-classifier-fixture.mjs";
import { claimNextMemoryJob } from "../server/memory-job-service.js";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createUserMessage } from "../server/chat-text-message-service.js";
import { generateChatImageFromJob } from "../server/chat-image-job-service.js";
import { CHAT_IMAGE_WINDOW_LIMIT, countReadyChatImagesForUsageDate, getChatImageUsageDate } from "../server/chat-image-quota-service.js";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { CHAT_IMAGE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { extractFileName } from "../server/protected-upload-url-service.js";

const USER_ID = "user_chat_image_quota_self_check";
const CHARACTER_ID = "char_chat_image_quota_self_check";
const SECOND_CHARACTER_ID = "char_chat_image_quota_self_check_2";
const SOURCE_REF = "chat-image-quota-lock-self-check";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await seed();

  await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "hello, how are you?",
  });
  const [[ordinaryQuotaWindow]] = await db.execute(
    "SELECT internal_uid FROM chat_image_quota_windows WHERE internal_uid = ?",
    [USER_ID]
  );
  assert.equal(ordinaryQuotaWindow, undefined, "ordinary chat must not create a chat-image quota window");

  const first = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "take a photo with this kit #mock-image",
  });
  const firstImage = findImage(first);
  assert.ok(firstImage?.id, "first allowed image request should create placeholder");

  const locked = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "take another photo with this kit #mock-image",
  });
  assert.equal(findImage(locked), null, "active queued image should lock second generation");

  await db.execute("UPDATE chat_messages SET delivery_status = 'failed', text_content = 'Could not finish the photo.' WHERE id = ?", [firstImage.id]);
  await db.execute("UPDATE chat_image_assets SET status = 'failed', error_message = 'self-check failed release' WHERE message_id = ?", [firstImage.id]);
  // The local app worker may be running alongside this script. Mark the
  // intentionally failed fixture job terminal so it cannot resurrect the
  // failed asset while the lock-release path is being checked.
  await db.execute(
    "UPDATE memory_jobs SET job_status = 'failed', failed_at = NOW(3), updated_at = NOW(3) WHERE job_type = 'generate_chat_image' AND internal_uid = ? AND payload_json LIKE ? AND job_status IN ('queued', 'running')",
    [USER_ID, `%${firstImage.id}%`]
  );

  const retry = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "take a photo with this kit #mock-image",
  });
  const retryImage = findImage(retry);
  assert.ok(retryImage?.id, "failed image should release generation lock");

  const [jobRows] = await db.execute(
    `SELECT *
     FROM memory_jobs
     WHERE session_id = ?
       AND job_type = 'generate_chat_image'
       AND payload_json LIKE ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [retry.session.id, `%${retryImage.image.id}%`]
  );
  assert.ok(jobRows[0], "retry image job should exist");
  const retryJob = await claimNextMemoryJob({ jobId: jobRows[0].id });
  assert.ok(retryJob?.claimToken, "retry fixture must claim its own execution lease");
  await generateChatImageFromJob(retryJob);

  const [[windowAfterFirstReady]] = await db.execute(
    "SELECT image_count, window_started_at FROM chat_image_quota_windows WHERE internal_uid = ?",
    [USER_ID]
  );
  assert.equal(Number(windowAfterFirstReady?.image_count || 0), 1, "first successful image should start a quota window");
  assert.ok(windowAfterFirstReady?.window_started_at, "quota window should record its start time");

  const usageCount = await countReadyChatImagesForUsageDate(db, {
    userId: USER_ID,
    characterId: CHARACTER_ID,
    usageDate: getChatImageUsageDate(),
  });
  assert.equal(usageCount, 1, "quota should be consumed only after ready image");

  const stillAllowed = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "take a photo with this kit again #mock-image",
  });
  const secondImage = findImage(stillAllowed);
  const [[windowBeforeSecond]] = await db.execute(
    "SELECT image_count, window_started_at FROM chat_image_quota_windows WHERE internal_uid = ?",
    [USER_ID]
  );
  const [pendingBeforeSecond] = await db.execute(
    "SELECT id, status FROM chat_image_assets WHERE internal_uid = ? AND status IN ('queued', 'generating')",
    [USER_ID]
  );
  assert.ok(secondImage?.id, `one ready image should not exhaust the window quota: ${JSON.stringify({ windowBeforeSecond, pendingBeforeSecond })}`);

  await db.execute("UPDATE chat_messages SET delivery_status = 'failed', text_content = 'Could not finish the photo.' WHERE id = ?", [secondImage.id]);
  await db.execute("UPDATE chat_image_assets SET status = 'failed', error_message = 'self-check failed release' WHERE message_id = ?", [secondImage.id]);
  await db.execute(
    "UPDATE memory_jobs SET job_status = 'failed', failed_at = NOW(3), updated_at = NOW(3) WHERE job_type = 'generate_chat_image' AND internal_uid = ? AND payload_json LIKE ? AND job_status IN ('queued', 'running')",
    [USER_ID, `%${secondImage.id}%`]
  );
  await seedReadyUsageRows({
    sessionId: retry.session.id,
    startIndex: usageCount,
    count: CHAT_IMAGE_WINDOW_LIMIT - usageCount,
  });

  const exhausted = await createUserMessage({
    characterId: SECOND_CHARACTER_ID,
    userId: USER_ID,
    text: "take a photo after the account window limit #mock-image",
  });
  assert.equal(findImage(exhausted), null, "ready usage should exhaust the shared account quota across characters");

  await db.execute(
    "UPDATE chat_image_quota_windows SET window_started_at = DATE_SUB(NOW(3), INTERVAL 3 DAY) WHERE internal_uid = ?",
    [USER_ID]
  );
  const afterWindow = await createUserMessage({
    characterId: SECOND_CHARACTER_ID,
    userId: USER_ID,
    text: "take a photo after the three day window #mock-image",
  });
  assert.ok(findImage(afterWindow)?.id, "an expired quota window should allow a new image task");
  const nextWindowImage = findImage(afterWindow);
  const [nextJobs] = await db.execute(
    "SELECT id, payload_json FROM memory_jobs WHERE internal_uid = ? AND job_type = 'generate_chat_image' AND payload_json LIKE ?",
    [USER_ID, `%${nextWindowImage.image.id}%`]
  );
  assert.equal(nextJobs.length, 1);
  const nextJob = await claimNextMemoryJob({ jobId: nextJobs[0].id });
  assert.ok(nextJob?.claimToken, "next-window fixture must claim its own execution lease");
  await generateChatImageFromJob(nextJob);
  const [[resetWindow]] = await db.execute(
    "SELECT image_count, window_started_at FROM chat_image_quota_windows WHERE internal_uid = ?", [USER_ID]
  );
  assert.equal(Number(resetWindow.image_count), 1, "first success after expiry must reset count to one");
  assert.ok(new Date(resetWindow.window_started_at) > new Date(windowAfterFirstReady.window_started_at));
  await generateChatImageFromJob(nextJob);
  const [[replayedWindow]] = await db.execute(
    "SELECT image_count, window_started_at FROM chat_image_quota_windows WHERE internal_uid = ?", [USER_ID]
  );
  assert.equal(Number(replayedWindow.image_count), 1, "replaying a ready job must not consume quota twice");
  assert.equal(new Date(replayedWindow.window_started_at).getTime(), new Date(resetWindow.window_started_at).getTime(), "replay must not move the window start");

  // Two different character conversations compete for the last account slot.
  await db.execute("UPDATE chat_image_quota_windows SET image_count = 9 WHERE internal_uid = ?", [USER_ID]);
  const competing = await Promise.allSettled([CHARACTER_ID, SECOND_CHARACTER_ID].map((characterId) => createUserMessage({
    characterId, userId: USER_ID, text: "take a photo with this kit #mock-image",
  })));
  for (const result of competing) assert.equal(result.status, "fulfilled", result.reason?.message);
  assert.equal(competing.filter((result) => findImage(result.value)).length, 1, "only one cross-character request may reserve the tenth slot");

  console.log("chat image quota and lock self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
  restore();
  assertFixtureTransport();
}

function findImage(result) {
  return result.items.find((message) => message.contentType === "image_generation") || null;
}

async function seed() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_auth_provider, account_type, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, 'hash', 'Chat Image Quota User',
       'chat-image-quota@example.test', 'email', 'personal', 'active', NOW(3))`,
    [USER_ID, USER_ID, USER_ID]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'companion', NULL, NULL, ?, 'Image Quota Check', 'Companion', 'Temporary image quota check.',
       '', '', '', 'Base persona.', 'Friendly', 'system', 'mock', 'Mock', '',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', ?, NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID, SOURCE_REF]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'companion', NULL, NULL, ?, 'Image Quota Check Two', 'Companion', 'Temporary image quota check.',
       '', '', '', 'Base persona.', 'Friendly', 'system', 'mock', 'Mock', '',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', ?, NOW(3))`,
    [SECOND_CHARACTER_ID, SECOND_CHARACTER_ID, `${SOURCE_REF}-2`]
  );
}

async function cleanup() {
  await db.execute(
    "SELECT storage_path, protected_path FROM chat_image_assets WHERE internal_uid = ?",
    [USER_ID]
  ).then(async ([rows]) => {
    for (const row of rows) {
      const fileName = extractFileName(row.storage_path || row.protected_path || "");
      if (fileName) await rm(join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName), { force: true }).catch(() => {});
    }
  }).catch(() => {});
  await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ? OR character_id = ?", [USER_ID, CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_image_usage WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_image_quota_windows WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_image_assets WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE internal_uid = ?)", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?) OR source_ref IN (?, ?)", [CHARACTER_ID, SECOND_CHARACTER_ID, SOURCE_REF, `${SOURCE_REF}-2`]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
}

async function seedReadyUsageRows({ sessionId, startIndex = 0, count = 0 }) {
  const usageDate = getChatImageUsageDate();
  for (let offset = 0; offset < count; offset += 1) {
    const index = startIndex + offset;
    const messageId = `msg_chat_image_quota_seed_${index}`;
    const assetId = `chat_img_quota_seed_${index}`;
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, sender_label, content_type, text_content,
         display_order, delivery_status, source_type, source_ref, sent_at
       ) VALUES (?, ?, ?, 'character', 'Image Quota Check', 'image_generation', 'Photo ready.',
         ?, 'ready', 'self-check', ?, NOW(3))
       ON DUPLICATE KEY UPDATE id = id`,
      [messageId, sessionId, CHARACTER_ID, 1000 + index, SOURCE_REF]
    );
    await db.execute(
      `INSERT INTO chat_image_assets (
         id, message_id, session_id, internal_uid, character_id, status, provider
       ) VALUES (?, ?, ?, ?, ?, 'ready', 'mock')
       ON DUPLICATE KEY UPDATE id = id`,
      [assetId, messageId, sessionId, USER_ID, CHARACTER_ID]
    );
    await db.execute(
      `INSERT INTO chat_image_usage (
         id, internal_uid, session_id, character_id, usage_date, message_id, asset_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [`chat_img_usage_quota_seed_${index}`, USER_ID, sessionId, CHARACTER_ID, usageDate, messageId, assetId]
    );
  }
  await db.execute(
    `INSERT INTO chat_image_quota_windows (internal_uid, window_started_at, image_count)
     VALUES (?, NOW(3), ?)
     ON DUPLICATE KEY UPDATE image_count = VALUES(image_count), window_started_at = VALUES(window_started_at)`,
    [USER_ID, startIndex + count]
  );
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
