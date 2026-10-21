import assert from "node:assert/strict";
import { buildChatImageGenerationContext, buildChatImagePromptContextPayload } from "../server/chat-image-context-builder.js";
import { buildChatImagePrompt } from "../server/chat-image-provider-service.js";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";

const USER_ID = "user_chat_image_context_self_check";
const CHARACTER_ID = "char_chat_image_context_self_check";
const SESSION_ID = "sess_chat_image_context_self_check";
const IMAGE_MESSAGE_ID = "msg_chat_image_context_self_check_image";
const ASSET_ID = "chat_img_context_self_check";
const SOURCE_REF = "chat-image-context-builder-self-check";
const MOCK_OPENAI_KEY = "sk-" + "testSensitiveValue1234567890";
const MOCK_SHOPIFY_CUSTOM_APP_TOKEN = "shpca_" + "testSensitiveValue1234567890";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await seed();

  const context = await buildChatImageGenerationContext(db, {
    assetId: ASSET_ID,
    messageId: IMAGE_MESSAGE_ID,
  });
  const payload = buildChatImagePromptContextPayload(context);
  const serializedPayload = JSON.stringify(payload);
  const prompt = buildChatImagePrompt(context);

  assert.equal(payload.character.name, "Millie Context Check", "context should include character name");
  assert.equal(payload.character.category, "mascot", "context should include character category");
  assert.match(payload.character.avatarUrl, /^https:\/\/cdn\.example\.test\/avatars\/millie\.webp$/, "avatar URL should be sanitized");
  assert.equal(payload.latestProduct.name, "Barcelona Third Away Football Shirt - UCL", "context should include product title");
  assert.equal(payload.latestProduct.selectedSize, "M", "context should infer selected size from recent user text");
  assert.equal(payload.latestProduct.imageUrl, "https://cdn.example.test/products/barca-front.jpg", "context should include sanitized product image");
  assert.equal(payload.latestProduct.imageUrls.length, 2, "context should keep a small product image gallery");
  assert.ok(payload.latestProduct.sizes.some((size) => size.label === "M" && size.available === false), "context should include size availability");
  assert.equal(payload.latestUserImage.name, "user outfit reference.jpg", "context should include latest user image attachment");
  assert.equal(payload.imageRequestConstraints.usesProductReference, true, "try-on context should explicitly opt into the current product reference");
  assert.equal(payload.variation.code.split("-").length, 6, "context should persist a six-dimension variation code for tracing");
  assert.equal(payload.latestUserImage.imageUrl, "/api/uploads/chat/user-outfit-reference.webp", "context should include user uploaded image reference");

  assert.doesNotMatch(serializedPayload, /shpat_|shpca_|sk-[A-Za-z0-9_-]{16,}|secret-value|Authorization|product_access_token|product_api_url|internal_uid/i, "prompt context must not include sensitive keys or values");
  assert.doesNotMatch(prompt, /shpat_|shpca_|sk-[A-Za-z0-9_-]{16,}|secret-value|Authorization|product_access_token|product_api_url|internal_uid/i, "prompt must not include sensitive keys or values");
  assert.match(prompt, /Millie Context Check/, "prompt should include character context");
  assert.match(prompt, /Barcelona Third Away Football Shirt/, "prompt should include product context");
  assert.match(prompt, /Selected size: M/, "prompt should include selected size");
  assert.match(prompt, /I am wearing Barcelona Third Away Football Shirt - UCL in size M/, "prompt should use first-person wearing scene");
  assert.match(prompt, /person from the user's uploaded image reference/, "prompt should include group-photo user image reference");
  assert.match(prompt, /using the product reference image/, "prompt should distinguish product try-on source");
  assert.match(prompt, /photorealistic, natural color grading, shot on 50mm f\/1\.4/, "prompt should include fixed camera style");

  const uploadedClothingPrompt = buildChatImagePrompt({
    character: payload.character,
    userText: "can you wear this jacket for me?",
    latestUserImage: payload.latestUserImage,
  });
  assert.match(uploadedClothingPrompt, /clothing from the user's uploaded image reference/, "prompt should distinguish user uploaded clothing try-on");
  assert.doesNotMatch(uploadedClothingPrompt, /standing together with the person/, "uploaded clothing try-on should not become a group photo");

  const ordinaryPrompt = buildChatImagePrompt({
    character: payload.character,
    userText: "Take a relaxed portrait photo for me.",
    latestProduct: payload.latestProduct,
  });
  assert.doesNotMatch(ordinaryPrompt, /Barcelona Third Away Football Shirt/, "ordinary photos must not inherit a prior product as clothing context");

  console.log("chat image context builder self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seed() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_auth_provider, account_type, account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, 'hash', 'Chat Image Context User',
       'chat-image-context@example.test', 'email', 'personal', 'active', NOW(3))`,
    [USER_ID, USER_ID, USER_ID]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, voice_provider, voice_id, voice_style, voice_sample_url,
       tags_json, profile_json, metrics_json, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, 'site_fkk', ?, 'Millie Context Check', 'Front desk',
       'Warm football shop host.', 'https://cdn.example.test/avatars/millie.webp?token=secret-value', '',
       '', 'Friendly matchday companion with clean styling cues.', 'Natural, playful, and casual.',
       'system', 'mock', 'Mock', '', JSON_ARRAY('self-check'),
       JSON_OBJECT('language', 'English', 'defaultLanguageCode', 'en', 'defaultLanguageLabel', 'English'),
       JSON_OBJECT(), 'public', 'published', 'self-check', ?, NOW(3))`,
    [CHARACTER_ID, CHARACTER_ID, SOURCE_REF]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref,
       preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'Chat image context self-check', 'active', 'self-check', ?, 'English', NOW(3))`,
    [SESSION_ID, USER_ID, CHARACTER_ID, SOURCE_REF]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES
       ('msg_chat_image_context_user_1', ?, ?, 'user', 'User', 'text', 'show me Barcelona Third Away Football kit',
        NULL, 10, 'sent', 'user', 'user-input', NOW(3)),
       ('msg_chat_image_context_product', ?, ?, 'character', 'Millie Context Check', 'product', 'Barcelona Third Away Football Shirt - UCL',
        ?, 20, 'sent', 'product_api', 'site-product-context', NOW(3)),
       ('msg_chat_image_context_size', ?, ?, 'user', 'User', 'text', 'M',
        NULL, 30, 'sent', 'user', 'user-input', NOW(3)),
       ('msg_chat_image_context_attachment', ?, ?, 'user', 'User', 'attachment', '[Image] user outfit reference.jpg',
        ?, 40, 'sent', 'user', 'user-attachment', NOW(3)),
       ('msg_chat_image_context_user_2', ?, ?, 'user', 'User', 'text', 'can you wear it for me and take a photo together?',
        NULL, 50, 'sent', 'user', 'user-input', NOW(3)),
       (?, ?, ?, 'character', 'Millie Context Check', 'image_generation', 'Taking the shot...',
        NULL, 60, 'queued', 'system', 'chat-image-generation', NOW(3))`,
    [
      SESSION_ID,
      CHARACTER_ID,
      SESSION_ID,
      CHARACTER_ID,
      JSON.stringify(buildProductPayload()),
      SESSION_ID,
      CHARACTER_ID,
      SESSION_ID,
      CHARACTER_ID,
      JSON.stringify(buildUserImagePayload()),
      SESSION_ID,
      CHARACTER_ID,
      IMAGE_MESSAGE_ID,
      SESSION_ID,
      CHARACTER_ID,
    ]
  );
  await db.execute(
    `INSERT INTO chat_image_assets (
       id, message_id, session_id, internal_uid, character_id, status, prompt_summary, provider
     ) VALUES (?, ?, ?, ?, ?, 'queued', 'can you wear it for me?', 'mock')`,
    [ASSET_ID, IMAGE_MESSAGE_ID, SESSION_ID, USER_ID, CHARACTER_ID]
  );
}

function buildUserImagePayload() {
  return {
    kind: "image",
    name: "user outfit reference.jpg",
    url: "/api/uploads/chat/user-outfit-reference.webp",
    mimeType: "image/webp",
    token: "user-image-token-should-not-leak",
  };
}

function buildProductPayload() {
  return {
    name: "Barcelona Third Away Football Shirt - UCL",
    subtitle: "Barcelona",
    imageUrl: "https://cdn.example.test/products/barca-front.jpg?token=secret-value",
    imageUrls: [
      "https://cdn.example.test/products/barca-front.jpg?token=secret-value",
      "https://cdn.example.test/products/barca-back.jpg#debug",
    ],
    sizes: [
      { label: "S", available: true, sku: "BARCA-S" },
      { label: "M", available: false, sku: "BARCA-M" },
      { label: "L", available: true, sku: "BARCA-L" },
    ],
    features: [
      "UCL edition",
      "green accents",
      `supplier note ${MOCK_OPENAI_KEY} should not leak`,
      `readonly token ${MOCK_SHOPIFY_CUSTOM_APP_TOKEN} should not leak`,
    ],
    product_access_token: "shpat_should_not_leak",
    product_api_url: "https://admin.example.test/private",
    Authorization: "Bearer secret-value",
  };
}

async function cleanup() {
  await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ? OR character_id = ?", [USER_ID, CHARACTER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_image_usage WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_image_assets WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [SESSION_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ? OR source_ref = ?", [CHARACTER_ID, SOURCE_REF]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
}
