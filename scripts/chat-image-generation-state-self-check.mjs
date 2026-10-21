import { claimNextMemoryJob } from "../server/memory-job-service.js";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createUserMessage } from "../server/chat-text-message-service.js";
import { createChatImagePlaceholder } from "../server/chat-image-generation-service.js";
import { generateChatImageFromJob } from "../server/chat-image-job-service.js";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { CHAT_IMAGE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { extractFileName } from "../server/protected-upload-url-service.js";

const USER_ID = "user_chat_image_state_self_check";
const CHARACTER_ID = "char_chat_image_state_self_check";
const SOURCE_REF = "chat-image-state-self-check";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await seed();

  const createResult = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "Please take a test photo #mock-image",
  });

  const userMessage = createResult.items.find((message) => message.contentType === "text");
  const imageMessage = createResult.items.find((message) => message.contentType === "image_generation");
  assert.ok(userMessage?.id, "user text message should be returned");
  assert.ok(imageMessage?.id, "image placeholder should be returned");
  assert.equal(imageMessage.deliveryStatus, "queued");
  assert.equal(imageMessage.image?.status, "queued");
  assert.equal(Number(imageMessage.displayOrder), Number(userMessage.displayOrder) + 1);

  const [jobRows] = await db.execute(
    "SELECT * FROM memory_jobs WHERE session_id = ? AND job_type = 'generate_chat_image' ORDER BY created_at DESC LIMIT 1",
    [createResult.session.id]
  );
  assert.ok(jobRows[0], "image generation memory job should be queued");
  const jobPayload = parseJson(jobRows[0].payload_json, {});

  const claimedJob = await claimNextMemoryJob({ jobId: jobRows[0].id });
  assert.ok(claimedJob?.claimToken, "own image fixture must obtain an execution lease");
  const jobResult = await generateChatImageFromJob({ ...claimedJob, payload: jobPayload });
  assert.equal(jobResult.status, "ready");

  const [readyRows] = await db.execute(
    `SELECT m.content_type, m.delivery_status, a.status, a.protected_path, a.width, a.height, a.bytes
     FROM chat_messages m
     JOIN chat_image_assets a ON a.message_id = m.id
     WHERE m.id = ?
     LIMIT 1`,
    [imageMessage.id]
  );
  assert.equal(readyRows[0]?.content_type, "image_generation");
  assert.equal(readyRows[0]?.delivery_status, "ready");
  assert.equal(readyRows[0]?.status, "ready");
  assert.match(readyRows[0]?.protected_path || "", /^\/api\/uploads\/chat-images\/.+\.webp$/);
  assert.equal(Number(readyRows[0]?.width), 1024);
  assert.equal(Number(readyRows[0]?.height), 1792);
  assert.ok(Number(readyRows[0]?.bytes) > 0, "ready asset should have byte size");

  const failedMessage = await createChatImagePlaceholder(db, {
    session: { id: createResult.session.id, internal_uid: USER_ID },
    character: { id: CHARACTER_ID, name: "Image State Check" },
    userId: USER_ID,
    userText: "Second test #mock-image",
    afterDisplayOrder: Number(imageMessage.displayOrder) + 10,
    sourceRef: "mock-chat-image-failed-self-check",
  });
  await db.execute("UPDATE chat_messages SET delivery_status = 'failed', text_content = 'Could not finish the photo.' WHERE id = ?", [failedMessage.id]);
  await db.execute("UPDATE chat_image_assets SET status = 'failed', error_message = 'mock failed state' WHERE message_id = ?", [failedMessage.id]);

  const [mappedRows] = await db.execute(
    `SELECT COUNT(*) AS count_ready
     FROM chat_messages m
     JOIN chat_image_assets a ON a.message_id = m.id
     WHERE m.session_id = ?
       AND m.content_type = 'image_generation'
       AND a.status IN ('ready', 'failed')`,
    [createResult.session.id]
  );
  assert.equal(Number(mappedRows[0]?.count_ready || 0), 2, "ready and failed image states should persist");

  const generatedFile = extractFileName(readyRows[0].protected_path);
  await rm(join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, generatedFile), { force: true });

  console.log("chat image generation state self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_auth_provider, account_type, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, 'hash', 'Chat Image State User',
       'chat-image-state@example.test', 'email', 'personal', 'active', NOW(3))`,
    [USER_ID, USER_ID, USER_ID]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'companion', NULL, NULL, ?, 'Image State Check', 'Companion', 'Temporary image state check.',
       '', '', '', 'Base persona.', 'Friendly', 'system', 'mock', 'Mock', '',
       JSON_ARRAY('self-check'), JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', ?, NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID, SOURCE_REF]
  );
}

async function cleanup() {
  await db.execute(
    `SELECT storage_path
     FROM chat_image_assets
     WHERE internal_uid = ?`,
    [USER_ID]
  ).then(async ([rows]) => {
    for (const row of rows) {
      const fileName = extractFileName(row.storage_path || "");
      if (fileName) await rm(join(CHAT_IMAGE_UPLOAD_POLICY.uploadDir, fileName), { force: true }).catch(() => {});
    }
  }).catch(() => {});
  await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ? OR character_id = ?", [USER_ID, CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_image_usage WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_image_assets WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE internal_uid = ?)", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ? OR source_ref = ?", [CHARACTER_ID, SOURCE_REF]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
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
