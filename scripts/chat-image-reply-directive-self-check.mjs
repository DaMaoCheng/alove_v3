import { claimNextMemoryJob } from "../server/memory-job-service.js";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createUserMessage } from "../server/chat-text-message-service.js";
import { generateChatImageFromJob } from "../server/chat-image-job-service.js";
import { CHAT_IMAGE_REPLY_REASONS, resolveChatImageReplyDirective } from "../server/chat-image-generation-service.js";
import { CHAT_IMAGE_WINDOW_LIMIT, getChatImageUsageDate } from "../server/chat-image-quota-service.js";
import { CHAT_IMAGE_BLOCK_REASONS } from "../server/chat-image-trigger-service.js";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { CHAT_IMAGE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { extractFileName } from "../server/protected-upload-url-service.js";

const USER_ID = "user_chat_image_directive_self_check";
const CHARACTER_ID = "char_chat_image_directive_self_check";
const SOURCE_REF = "chat-image-reply-directive-self-check";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await seed();

  const first = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "take a photo with this kit #mock-image",
  });
  const userMessage = first.items.find((message) => message.contentType === "text");
  const placeholder = first.items.find((message) => message.contentType === "image_generation");
  assert.ok(placeholder?.id, "placeholder should exist for successful trigger");

  const successfulDirective = await resolveChatImageReplyDirective(db, {
    session: first.session,
    userId: USER_ID,
    userText: userMessage.text,
    userDisplayOrder: Number(userMessage.displayOrder),
  });
  assert.equal(successfulDirective?.reason, CHAT_IMAGE_REPLY_REASONS.IMAGE_TASK_CREATED);
  assert.equal(successfulDirective?.taskCreated, true);
  assert.match(successfulDirective.instruction, /already created a chat photo task/);

  const activeDirective = await resolveChatImageReplyDirective(db, {
    session: first.session,
    userId: USER_ID,
    userText: "take another photo with this kit #mock-image",
    userDisplayOrder: Number(userMessage.displayOrder) + 10,
  });
  assert.equal(activeDirective?.reason, CHAT_IMAGE_BLOCK_REASONS.ACTIVE_GENERATION);
  assert.match(activeDirective.instruction, /already has a queued or generating image task/);

  const [jobRows] = await db.execute(
    `SELECT *
     FROM memory_jobs
     WHERE session_id = ?
       AND job_type = 'generate_chat_image'
     ORDER BY created_at DESC
     LIMIT 1`,
    [first.session.id]
  );
  const imageJob = await claimNextMemoryJob({ jobId: jobRows[0].id });
  assert.ok(imageJob?.claimToken, "image fixture must claim its own execution lease");
  await generateChatImageFromJob(imageJob);

  const allowedAfterOneReady = await resolveChatImageReplyDirective(db, {
    session: first.session,
    userId: USER_ID,
    userText: "take another photo with this kit #mock-image",
    userDisplayOrder: Number(userMessage.displayOrder) + 20,
  });
  assert.equal(allowedAfterOneReady, null, "one ready image should still be under the test quota");

  await seedReadyUsageRows({
    sessionId: first.session.id,
    startIndex: 1,
    count: CHAT_IMAGE_WINDOW_LIMIT - 1,
  });

  const quotaDirective = await resolveChatImageReplyDirective(db, {
    session: first.session,
    userId: USER_ID,
    userText: "take another photo with this kit #mock-image",
    userDisplayOrder: Number(userMessage.displayOrder) + 30,
  });
  assert.equal(quotaDirective?.reason, CHAT_IMAGE_BLOCK_REASONS.QUOTA_EXHAUSTED);
  assert.match(quotaDirective.instruction, /chat-photo limit/);

  const disallowedDirective = await resolveChatImageReplyDirective(db, {
    session: { id: "session_without_usage" },
    userId: USER_ID,
    userText: "make a white background product photo",
    userDisplayOrder: 10,
  });
  assert.equal(disallowedDirective?.reason, CHAT_IMAGE_BLOCK_REASONS.DISALLOWED_REQUEST);
  assert.match(disallowedDirective.instruction, /outside V1 chat-photo rules/);

  console.log("chat image reply directive self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_auth_provider, account_type, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, 'hash', 'Chat Image Directive User',
       'chat-image-directive@example.test', 'email', 'personal', 'active', NOW(3))`,
    [USER_ID, USER_ID, USER_ID]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'companion', NULL, NULL, ?, 'Image Directive Check', 'Companion', 'Temporary image directive check.',
       '', '', '', 'Base persona.', 'Friendly', 'system', 'mock', 'Mock', '',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', ?, NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID, SOURCE_REF]
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
  await db.execute("DELETE FROM ai_characters WHERE id = ? OR source_ref = ?", [CHARACTER_ID, SOURCE_REF]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
}

async function seedReadyUsageRows({ sessionId, startIndex = 0, count = 0 }) {
  const usageDate = getChatImageUsageDate();
  for (let offset = 0; offset < count; offset += 1) {
    const index = startIndex + offset;
    const messageId = `msg_chat_image_directive_seed_${index}`;
    const assetId = `chat_img_directive_seed_${index}`;
    await db.execute(
      `INSERT INTO chat_messages (
         id, session_id, character_id, sender_type, sender_label, content_type, text_content,
         display_order, delivery_status, source_type, source_ref, sent_at
       ) VALUES (?, ?, ?, 'character', 'Image Directive Check', 'image_generation', 'Photo ready.',
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
      [`chat_img_usage_directive_seed_${index}`, USER_ID, sessionId, CHARACTER_ID, usageDate, messageId, assetId]
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
