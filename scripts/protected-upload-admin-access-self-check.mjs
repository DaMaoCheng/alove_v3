import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { requireChatAttachmentAccess, requireChatImageAccess } from "../server/protected-upload-routes.js";

const suffix = Date.now();
const ownerId = `u_upload_owner_${suffix}`;
const otherId = `u_upload_other_${suffix}`;
const adminId = `u_upload_admin_${suffix}`;
const characterId = `char_upload_access_${suffix}`;
const sessionId = `chat_upload_access_${suffix}`;
const attachmentMessageId = `msg_upload_attachment_${suffix}`;
const imageMessageId = `msg_upload_image_${suffix}`;
const attachmentFileName = `admin-access-attachment-${suffix}.webp`;
const imageFileName = `admin-access-image-${suffix}.webp`;

await initializeDatabase();
const db = getDbPool();

try {
  await db.execute(
    `INSERT INTO users (id, platform_uid, username, password_hash, email, account_status, account_type, last_seen_at)
     VALUES
       (?, ?, ?, 'x', ?, 'active', 'personal', NOW(3)),
       (?, ?, ?, 'x', ?, 'active', 'personal', NOW(3)),
       (?, ?, ?, 'x', ?, 'active', 'admin', NOW(3))`,
    [
      ownerId, ownerId, ownerId, `${ownerId}@example.test`,
      otherId, otherId, otherId, `${otherId}@example.test`,
      adminId, adminId, adminId, `${adminId}@example.test`,
    ]
  );
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, slug, name, role_title, avatar_url, visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', ?, 'Upload Access Mascot', 'Site Guide · Mascot', 'assets/char_coach.png', 'public', 'published', 'self-check', 'protected-upload-admin-access', NOW(3))`,
    [characterId, `upload-access-mascot-${suffix}`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, 'protected upload admin access self-check', 'active', 'user', 'protected-upload-admin-access', 'English', NOW(3))`,
    [sessionId, ownerId, characterId]
  );
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES
       (?, ?, NULL, 'user', 'You', 'attachment', '[Image] protected attachment', ?, 10, 'sent', 'user', 'protected-upload-admin-access', NOW(3)),
       (?, ?, ?, 'character', 'Upload Access Mascot', 'image_generation', 'Photo ready', NULL, 20, 'sent', 'ai', 'protected-upload-admin-access', NOW(3))`,
    [
      attachmentMessageId,
      sessionId,
      JSON.stringify({
        kind: "image",
        name: "protected attachment",
        storedName: attachmentFileName,
        url: `/api/uploads/chat/${attachmentFileName}`,
        mimeType: "image/webp",
      }),
      imageMessageId,
      sessionId,
      characterId,
    ]
  );
  await db.execute(
    `INSERT INTO chat_image_assets (
       id, message_id, session_id, internal_uid, character_id, status, storage_path, protected_path,
       width, height, bytes, mime_type, prompt_summary, provider, completed_at
     ) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, 512, 768, 1200, 'image/webp', 'Protected upload admin access image', 'self-check', NOW(3))`,
    [
      `img_upload_access_${suffix}`,
      imageMessageId,
      sessionId,
      ownerId,
      characterId,
      imageFileName,
      `/api/uploads/chat-images/${imageFileName}`,
    ]
  );

  await requireChatAttachmentAccess({ id: ownerId, account_type: "personal" }, attachmentFileName);
  await requireChatImageAccess({ id: ownerId, account_type: "personal" }, imageFileName);

  await assert.rejects(
    () => requireChatAttachmentAccess({ id: otherId, account_type: "personal" }, attachmentFileName),
    (error) => error?.statusCode === 403,
    "unrelated personal users should not access another user's chat attachment"
  );
  await assert.rejects(
    () => requireChatImageAccess({ id: otherId, account_type: "personal" }, imageFileName),
    (error) => error?.statusCode === 403,
    "unrelated personal users should not access another user's generated chat image"
  );

  await requireChatAttachmentAccess({ id: adminId, account_type: "admin" }, attachmentFileName);
  await requireChatImageAccess({ id: adminId, account_type: "admin" }, imageFileName);

  console.log("protected upload admin access self-check passed");
} finally {
  await db.execute("DELETE FROM chat_image_assets WHERE session_id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?, ?)", [ownerId, otherId, adminId]).catch(() => {});
  await closeDbPool().catch(() => {});
}
