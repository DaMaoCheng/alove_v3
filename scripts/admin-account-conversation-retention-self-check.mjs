import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminAccountConversations, getAdminAccountConversation } from "../server/admin-account-service.js";
import { MEMORY_RETENTION_DAYS } from "../server/memory-cleanup-service.js";
import { accountConversationModalHtml } from "../src/features/admin-console/admin-console-accounts-template.js";

const suffix = Date.now();
const userId = `u_admin_convo_retention_${suffix}`;
const characterId = `char_admin_convo_retention_${suffix}`;
const sessionId = `chat_admin_convo_retention_${suffix}`;
const imageMessageId = `msg_admin_convo_image_${suffix}`;
const greetingImageMessageId = `msg_admin_convo_greeting_${suffix}`;
const email = `${userId}@example.test`;

await initializeDatabase();
const db = getDbPool();

try {
  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, last_seen_at)
     VALUES (?, ?, ?, 'x', ?, 'active', 'personal', NOW(3))`,
    [userId, userId, userId, email]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, slug, name, role_title, avatar_url, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', ?, 'Retention Millie', 'Site Guide · Mascot', 'assets/char_coach.png', 'public', 'published', 'self-check', 'admin-account-conversation-retention', NOW(3))`,
    [characterId, `retention-millie-${suffix}`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'retention self-check', 'active', 'user', 'admin-account-conversation-retention', 'English', NOW(3))`,
    [sessionId, userId, characterId]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES
       (?, ?, ?, 'character', 'Retention Millie', 'mascot_greeting_image', '', 5, 'sent', 'system', 'mascot-greeting-image:admin-order', ?),
       (?, ?, ?, 'character', 'Retention Millie', 'text', 'Welcome after the greeting image', 8, 'sent', 'system', 'opening-line', ?),
       (?, ?, ?, 'user', 'You', 'text', 'today user message', 10, 'sent', 'user', 'admin-account-conversation-retention', ?),
       (?, ?, ?, 'character', 'Retention Millie', 'text', 'today character reply', 20, 'sent', 'ai', 'admin-account-conversation-retention', ?),
       (?, ?, ?, 'character', 'Retention Millie', 'product', 'AC Milan Home Shirt', 30, 'sent', 'ai', 'admin-account-conversation-retention', ?),
       (?, ?, ?, 'character', 'Retention Millie', 'image_generation', 'Photo ready', 40, 'sent', 'ai', 'admin-account-conversation-retention', ?),
       (?, ?, ?, 'user', 'You', 'attachment', 'uploaded shirt image', 50, 'sent', 'user', 'admin-account-conversation-retention', ?),
       (?, ?, ?, 'user', 'You', 'text', 'five days ago user message', 30, 'sent', 'user', 'admin-account-conversation-retention', ?),
       (?, ?, ?, 'character', 'Retention Millie', 'text', 'five days ago character reply', 40, 'sent', 'ai', 'admin-account-conversation-retention', ?),
       (?, ?, ?, 'user', 'You', 'text', 'thirty one days ago message', 50, 'sent', 'user', 'admin-account-conversation-retention', ?)`,
    [
      greetingImageMessageId, sessionId, characterId, daysAgo(0, 9, 1),
      `msg_admin_convo_opening_${suffix}`, sessionId, characterId, daysAgo(0, 9, 0),
      `msg_admin_convo_today_user_${suffix}`, sessionId, characterId, daysAgo(0, 10),
      `msg_admin_convo_today_ai_${suffix}`, sessionId, characterId, daysAgo(0, 11),
      `msg_admin_convo_product_${suffix}`, sessionId, characterId, daysAgo(0, 12),
      imageMessageId, sessionId, characterId, daysAgo(0, 13),
      `msg_admin_convo_attachment_${suffix}`, sessionId, characterId, daysAgo(0, 14),
      `msg_admin_convo_five_user_${suffix}`, sessionId, characterId, daysAgo(5, 10),
      `msg_admin_convo_five_ai_${suffix}`, sessionId, characterId, daysAgo(5, 11),
      `msg_admin_convo_old_${suffix}`, sessionId, characterId, daysAgo(MEMORY_RETENTION_DAYS.ADMIN_CONVERSATION_DEFAULT + 1, 10),
    ]
  );
  await db.execute(
    `UPDATE chat_messages
       SET product_payload_json = CASE id
       WHEN ? THEN ?
       WHEN ? THEN ?
       WHEN ? THEN ?
       ELSE product_payload_json
     END
     WHERE session_id = ?`,
    [
      `msg_admin_convo_product_${suffix}`,
      JSON.stringify({
        name: "AC Milan Home Shirt",
        subtitle: "Supporter edition",
        imageUrl: "/assets/jersey_product.png",
        priceNow: "$65.99",
        priceWas: "$115.00",
        url: "https://footballkituk.example/products/ac-milan-home",
      }),
      greetingImageMessageId,
      JSON.stringify({
        imageId: "admin-greeting-image",
        imageUrl: "/uploads/mascot-greetings/admin-order.webp",
        mediaType: "image",
        publicGreetingMedia: true,
        publicGreetingImage: true,
      }),
      `msg_admin_convo_attachment_${suffix}`,
      JSON.stringify({
        originalName: "shirt-reference.png",
        storedName: "shirt-reference.png",
        mimeType: "image/png",
        url: "/uploads/chat/shirt-reference.png",
      }),
      sessionId,
    ]
  );
  await db.execute(
    `INSERT INTO chat_image_assets (
       id, message_id, session_id, internal_uid, character_id, status, storage_path, protected_path,
       width, height, bytes, mime_type, prompt_summary, provider, completed_at
     ) VALUES (?, ?, ?, ?, ?, 'ready', 'generated-retention.webp', 'generated-retention.webp',
       512, 768, 1200, 'image/webp', 'RAW_PROVIDER_PROMPT_MUST_NEVER_RENDER', 'self-check', NOW(3))`,
    [`img_admin_convo_${suffix}`, imageMessageId, sessionId, userId, characterId]
  );

  const list = await listAdminAccountConversations(userId);
  const items = list.items.filter((item) => item.characterId === characterId);
  assert.equal(items.length, 2, "admin account conversation list should show every active day inside raw retention");
  assert.equal(items.some((item) => item.latestText === "uploaded shirt image"), true, "today segment should show its own latest message");
  assert.equal(items.some((item) => item.latestText === "five days ago character reply"), true, "older retained segment should show its own latest message");
  assert.equal(items.some((item) => item.latestText === "thirty one days ago message"), false, "messages outside the admin default window should not appear");
  assert.equal(items.some((item) => item.userMessageCount === 2), true, "today segment should count user text and attachment messages only");
  assert.equal(items.some((item) => item.userMessageCount === 1), true, "older text-only segment should count one user message");

  const today = items.find((item) => item.latestText === "uploaded shirt image");
  const todayDetail = await getAdminAccountConversation(userId, today.id);
  assert.equal(todayDetail.item.messages.length, 7, "opening one retained day should return all same-day message types");
  assert.equal(todayDetail.item.userMessageCount, 2, "day detail user message count should ignore AI replies");
  assert.equal(todayDetail.item.messages[0].contentType, "mascot_greeting_image", "formal admin detail must honor display order even when greeting media is persisted after its opening text");
  assert.equal(todayDetail.item.messages[1].text, "Welcome after the greeting image");
  assert.equal(todayDetail.item.messages.some((message) => message.text === "five days ago user message"), false, "day detail should not mix messages from another day");
  assert.equal(todayDetail.item.messages.some((message) => message.contentType === "product" && message.product?.name === "AC Milan Home Shirt"), true, "day detail should include product payload snapshots");
  assert.equal(todayDetail.item.messages.some((message) => message.contentType === "image_generation" && message.image?.imageUrl === "/api/uploads/chat-images/generated-retention.webp"), true, "day detail should include protected generated image URLs");
  const renderedImage = todayDetail.item.messages.find((message) => message.contentType === "image_generation");
  assert.equal(renderedImage?.image?.promptSummary, undefined, "admin conversation payload must not expose stored image prompts");
  assert.equal(todayDetail.item.messages.some((message) => message.contentType === "attachment" && message.attachment?.url === "/api/uploads/chat/shirt-reference.png"), true, "day detail should include protected attachment URLs");
  const rendered = accountConversationModalHtml({
    account: { username: "Self Check" },
    view: "detail",
    selectedConversation: todayDetail.item,
    conversations: [],
    query: "",
    loading: false,
    error: "",
  });
  assert.match(rendered, /class="cv-product"[\s\S]*<img src="\/assets\/jersey_product\.png"/, "admin conversation detail should render product snapshot images");
  assert.match(rendered, /class="cv-image-card"[\s\S]*<img src="\/api\/uploads\/chat-images\/generated-retention\.webp"/, "admin conversation detail should use the compact admin image preview markup");
  assert.match(rendered, /class="cv-bubble cv-bubble-image"[\s\S]*class="cv-image-card"/, "admin ready image should remove generic bubble spacing");
  assert.doesNotMatch(rendered, /RAW_PROVIDER_PROMPT_MUST_NEVER_RENDER/, "admin conversation detail must never render stored image prompts");
  assert.match(rendered, /class="cv-attachment"[\s\S]*<img src="\/api\/uploads\/chat\/shirt-reference\.png"/, "admin conversation detail should render image attachments when kind is image");

  const searched = await listAdminAccountConversations(userId, { query: "five days ago" });
  const searchedItems = searched.items.filter((item) => item.characterId === characterId);
  assert.equal(searchedItems.length, 1, "message keyword search should only return the matched retained day segment");
  assert.equal(searchedItems[0]?.latestText, "five days ago character reply", "message keyword search should keep the matched day summary");

  console.log("admin account conversation retention self-check passed");
} finally {
  await db.execute("DELETE FROM chat_image_assets WHERE session_id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  await closeDbPool();
}

function daysAgo(days, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - Number(days || 0));
  date.setHours(hour, minute, 0, 0);
  return date;
}
