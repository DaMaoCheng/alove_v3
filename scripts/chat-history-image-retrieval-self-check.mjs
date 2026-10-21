import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { indexChatMessage } from "../server/chat-memory-service.js";
import { findRelevantHistoryImageAttachments } from "../server/chat-history-image-retrieval-service.js";
import { collectVisionInputsForAttachments } from "../server/chat-vision-input-service.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "../server/upload-policies.js";

const suffix = Date.now();
const userId = `u_history_image_${suffix}`;
const characterId = `char_history_image_${suffix}`;
const sessionId = `chat_history_image_${suffix}`;
const attachmentMessageId = `msg_history_image_attachment_${suffix}`;
const replyMessageId = `msg_history_image_reply_${suffix}`;
const fileName = `history-image-${suffix}.webp`;
const filePath = join(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, fileName);

await initializeDatabase();
const db = getDbPool();

try {
  await mkdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { recursive: true });
  await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 3,
      background: { r: 180, g: 20, b: 30 },
    },
  }).webp({ quality: 80 }).toFile(filePath);

  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, last_seen_at)
     VALUES (?, ?, ?, 'x', ?, 'active', 'personal', NOW(3))`,
    [userId, userId, userId, `${userId}@example.test`]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, slug, name, role_title, avatar_url, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', ?, 'History Image Millie', 'Site Guide · Mascot', 'assets/char_coach.png', 'public', 'published', 'self-check', 'history-image-retrieval', NOW(3))`,
    [characterId, `history-image-millie-${suffix}`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'history image self-check', 'active', 'user', 'history-image-retrieval', 'English', NOW(3))`,
    [sessionId, userId, characterId]
  );

  const attachment = {
    kind: "image",
    name: "stage-look-reference.webp",
    storedName: fileName,
    url: `/uploads/chat/${fileName}`,
    size: 120,
    mimeType: "image/webp",
  };
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES
       (?, ?, NULL, 'user', 'You', 'attachment', '[Image] stage-look-reference.webp', ?, 10, 'sent', 'user', 'history-image-retrieval', NOW(3)),
       (?, ?, ?, 'character', 'History Image Millie', 'text', 'Yeah, I can see the red-carpet steps and the black suit beside the white outfit.', NULL, 20, 'sent', 'ai', 'history-image-retrieval', NOW(3))`,
    [
      attachmentMessageId,
      sessionId,
      JSON.stringify(attachment),
      replyMessageId,
      sessionId,
      characterId,
    ]
  );
  await indexChatMessage(db, {
    message: {
      id: attachmentMessageId,
      sessionId,
      senderType: "user",
      contentType: "attachment",
      text: "[Image] stage-look-reference.webp",
      attachment,
    },
    session: { id: sessionId, internal_uid: userId, character_id: characterId },
    userId,
    characterId,
  });

  const matches = await findRelevantHistoryImageAttachments(db, {
    userId,
    characterId,
    sessionId,
    queryText: "do you remember the red carpet picture from before?",
  });
  assert.equal(matches.length, 1, "history image retrieval should find the referenced prior image");
  assert.equal(matches[0].messageId, attachmentMessageId, "history image retrieval should return the attachment message");
  assert.match(matches[0].contextText, /red-carpet/i, "history image retrieval should use nearby visual description text");

  const visionInputs = await collectVisionInputsForAttachments(matches.map((match) => match.attachment));
  assert.equal(visionInputs.length, 1, "matched history image should become a vision input");
  assert.equal(visionInputs[0].mimeType, "image/jpeg", "vision input should be normalized for the reply model");
  assert.match(visionInputs[0].dataUrl, /^data:image\/jpeg;base64,/, "vision input should contain an inline image data URL");

  console.log("chat history image retrieval self-check passed");
} finally {
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  await rm(filePath, { force: true }).catch(() => {});
  await closeDbPool().catch(() => {});
}
