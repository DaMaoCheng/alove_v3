import { classifiedMessages, restore, assertFixtureTransport } from "./fixtures/chat-image-classifier-fixture.mjs";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const { claimNextMemoryJob } = await import("../server/memory-job-service.js");
const { createUserMessage } = await import("../server/chat-text-message-service.js");
const { generateChatImageFromJob } = await import("../server/chat-image-job-service.js");
const { listMessagesForSessionWithDb } = await import("../server/chat-message-store.js");
const { closeDbPool, getDbPool, initializeDatabase } = await import("../server/db.js");
const { CHAT_IMAGE_UPLOAD_POLICY } = await import("../server/upload-policies.js");
const { extractFileName } = await import("../server/protected-upload-url-service.js");
const { SERVER_CONFIG } = await import("../server/config.js");
assert.equal(SERVER_CONFIG.typeSafe.enabled, false, "JEV must be disabled for this isolated provider fixture");

const USER_ID = "user_chat_image_final_self_check";
const CHARACTER_ID = "char_chat_image_final_self_check";
const SOURCE_REF = "chat-image-final-regression-self-check";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await seed();

  const normalReply = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "Tell me about matchday mood.",
  });
  assert.equal(findImageMessage(normalReply), null, "ordinary text chat should not create image generation message");

  const attachmentOnly = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "",
    attachments: [buildAttachmentPayload("matchday reference.webp")],
  });
  assert.equal(attachmentOnly.items[0]?.contentType, "attachment", "attachment-only send should create an attachment message");
  assert.equal(findImageMessage(attachmentOnly), null, "attachment-only send without image intent should not create an image task");

  await insertProductMessage({
    sessionId: normalReply.session.id,
    displayOrder: 25,
  });
  await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "M",
  });

  const imageResult = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "can you wear it for me? #mock-image",
  });
  const imageMessage = findImageMessage(imageResult);
  assert.ok(imageMessage?.id, "allowed image request should create placeholder");

  const activeBlocked = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "take another photo with this kit #mock-image",
  });
  assert.equal(findImageMessage(activeBlocked), null, "active generation should block a second image task");

  const normalDuringGeneration = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "No rush, tell me why this kit works.",
  });
  assert.equal(findImageMessage(normalDuringGeneration), null, "normal chat should continue during active image generation");

  const [jobRows] = await db.execute(
    `SELECT id, payload_json
     FROM memory_jobs
     WHERE session_id = ?
       AND job_type = 'generate_chat_image'
     ORDER BY created_at DESC
     LIMIT 1`,
    [imageResult.session.id]
  );
  assert.ok(jobRows[0], "image generation job should exist");
  const imageJob = await claimNextMemoryJob({ jobId: jobRows[0].id });
  assert.ok(imageJob?.claimToken, "image fixture must claim its own execution lease");
  await generateChatImageFromJob(imageJob);

  const refreshedMessages = await listMessagesForSessionWithDb(db, imageResult.session.id);
  const readyImage = refreshedMessages.find((message) => message.id === imageMessage.id);
  assert.equal(readyImage?.deliveryStatus, "ready", "refreshed conversation should keep ready image message");
  assert.match(readyImage?.image?.imageUrl || "", /^\/api\/uploads\/chat-images\//, "ready image should use protected URL");

  const [contextRows] = await db.execute(
    "SELECT prompt_summary, prompt_context_json FROM chat_image_assets WHERE message_id = ? LIMIT 1",
    [imageMessage.id]
  );
  const context = parseJson(contextRows[0]?.prompt_context_json, {});
  assert.equal(contextRows[0]?.prompt_summary, `Chat image variation ${context.variation?.code}`, "asset should store only a safe variation summary, never the provider prompt");
  assert.doesNotMatch(contextRows[0]?.prompt_summary || "", /wear it|Generate one English-prompted/i, "asset summary must not contain the original user request or provider prompt");
  assert.equal(context.latestProduct?.name, "Barcelona Third Away Football Shirt - UCL", "final regression should keep product context");
  assert.equal(context.selectedSize, "M", "final regression should keep selected size");
  assert.equal(readyImage?.image?.promptSummary, undefined, "normal chat image payload must not expose any prompt summary");

  const secondImageResult = await createUserMessage({
    characterId: CHARACTER_ID,
    userId: USER_ID,
    text: "take one more photo with this kit #mock-image",
  });
  assert.ok(findImageMessage(secondImageResult)?.id, "one ready image should not exhaust the shared account window quota");
  assert.ok(classifiedMessages.includes("Tell me about matchday mood."), "ordinary chat must exercise semantic image classification");
  assert.ok(classifiedMessages.includes("No rush, tell me why this kit works."), "normal chat during generation must still exercise semantic classification");

  assertFixtureTransport();
  console.log("chat image final regression self-check passed");
} finally {
  restore();
  await cleanup();
  await closeDbPool();
}

function findImageMessage(result) {
  return result.items.find((message) => message.contentType === "image_generation") || null;
}

function buildAttachmentPayload(name) {
  return {
    kind: "image",
    name,
    storedName: "chat-image-final-reference.webp",
    url: "/api/uploads/chat/chat-image-final-reference.webp",
    size: 1234,
    mimeType: "image/webp",
    sha256: "a".repeat(64),
  };
}

async function seed() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_auth_provider, account_type, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, 'hash', 'Chat Image Final User',
       'chat-image-final@example.test', 'email', 'personal', 'active', NOW(3))`,
    [USER_ID, USER_ID, USER_ID]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, 'site_fkk', ?, 'Millie Final Check', 'Front desk', 'Temporary chat image final check.',
       'https://cdn.example.test/avatars/millie.webp', '', '', 'Friendly matchday companion.', 'Natural and playful.',
       'system', 'mock', 'Mock', '', JSON_ARRAY('self-check'),
       JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', ?, NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID, SOURCE_REF]
  );
}

async function insertProductMessage({ sessionId, displayOrder }) {
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES ('msg_chat_image_final_product', ?, ?, 'character', 'Millie Final Check', 'product', ?, ?, ?, 'sent', 'product_api', 'site-product-context', NOW(3))`,
    [
      sessionId,
      CHARACTER_ID,
      "Barcelona Third Away Football Shirt - UCL",
      JSON.stringify({
        name: "Barcelona Third Away Football Shirt - UCL",
        subtitle: "Barcelona",
        imageUrl: "https://cdn.example.test/products/barca-front.jpg",
        sizes: [
          { label: "S", available: true },
          { label: "M", available: true },
          { label: "L", available: true },
        ],
      }),
      displayOrder,
    ]
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
