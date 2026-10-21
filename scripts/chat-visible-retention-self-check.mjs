import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { getMessagesForSession } from "../server/chat-message-store.js";
import { MEMORY_RETENTION_DAYS } from "../server/memory-cleanup-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "chat visible retention self-check" });
await initializeDatabase();
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const characterId = `char_visible_retention_${suffix}`.slice(0, 64);
const userSessionId = `chat_visible_user_${suffix}`.slice(0, 64);
const guestSessionId = `chat_visible_guest_${suffix}`.slice(0, 64);
const userMessageIds = [`msg_visible_user_new_${suffix}`, `msg_visible_user_old_${suffix}`].map((id) => id.slice(0, 64));
const guestMessageIds = [`msg_visible_guest_new_${suffix}`, `msg_visible_guest_old_${suffix}`].map((id) => id.slice(0, 64));

try {
  const [[site]] = await db.execute(
    `SELECT s.id, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk' LIMIT 1`
  );
  assert.ok(site?.id && site?.character_id, "FKK site and mascot are required");
  await db.execute(
    `INSERT INTO ai_characters (id, category_id, slug, name, role_title, avatar_url, visibility, character_status, source_type, source_ref, published_at)
     VALUES (?, 'mascot', ?, 'Visible retention self-check', 'Self-check', 'assets/char_coach.png', 'public', 'published', 'self-check', 'visible-retention', NOW(3))`,
    [characterId, `visible-retention-${suffix}`]
  );
  await db.execute(
    `INSERT INTO chat_sessions (id, internal_uid, guest_session_id, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at)
     VALUES (?, NULL, NULL, ?, 'Visible user session', 'active', 'user', 'visible-retention', 'English', NOW(3)),
            (?, NULL, ?, ?, 'Visible guest session', 'active', 'guest', 'visible-retention', 'English', NOW(3))`,
    [userSessionId, characterId, guestSessionId, `guest_visible_${suffix}`.slice(0, 64), characterId]
  );
  await insertMessage(userMessageIds[0], userSessionId, null, characterId, "user visible within 30 days", 10, daysAgo(MEMORY_RETENTION_DAYS.USER_VISIBLE_MESSAGES - 1));
  await insertMessage(userMessageIds[1], userSessionId, null, characterId, "user hidden after 30 days", 20, daysAgo(MEMORY_RETENTION_DAYS.USER_VISIBLE_MESSAGES + 1));
  const guestId = `guest_visible_${suffix}`.slice(0, 64);
  await insertMessage(guestMessageIds[0], guestSessionId, guestId, characterId, "guest visible within 14 days", 10, daysAgo(MEMORY_RETENTION_DAYS.GUEST_VISIBLE_MESSAGES - 1));
  await insertMessage(guestMessageIds[1], guestSessionId, guestId, characterId, "guest hidden after 14 days", 20, daysAgo(MEMORY_RETENTION_DAYS.GUEST_VISIBLE_MESSAGES + 1));

  const userVisible = await getMessagesForSession({ id: userSessionId, character_id: characterId, session_status: "active", source_type: "user" });
  assert.deepEqual(userVisible.items.map((message) => message.text), ["user visible within 30 days"], "registered users must only receive the latest 30 days");
  const guestVisible = await getMessagesForSession({ id: guestSessionId, guest_session_id: guestId, character_id: characterId, session_status: "active", source_type: "guest" });
  assert.deepEqual(guestVisible.items.map((message) => message.text), ["guest visible within 14 days"], "guests must only receive the latest 14 days");
  console.log("chat visible retention self-check passed");
} finally {
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (?, ?)", [userSessionId, guestSessionId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE id IN (?, ?)", [userSessionId, guestSessionId]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [characterId]).catch(() => {});
  await closeDbPool();
}

async function insertMessage(id, sessionId, guestSessionId, characterId, text, displayOrder, sentAt) {
  await db.execute(
    `INSERT INTO chat_messages (id, session_id, guest_session_id, character_id, sender_type, sender_label, content_type, text_content, display_order, delivery_status, source_type, source_ref, sent_at)
     VALUES (?, ?, ?, ?, 'user', 'Self-check', 'text', ?, ?, 'sent', 'user', 'visible-retention', ?)`,
    [id, sessionId, guestSessionId, characterId, text, displayOrder, sentAt]
  );
}

function daysAgo(days) {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
}
