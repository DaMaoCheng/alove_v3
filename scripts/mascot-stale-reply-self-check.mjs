import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { createUserReply, createUserMessage } from "../server/chat-service.js";
import { activateUserCharacterForDb } from "../server/character-activation-service.js";
import { createId, hashSecret } from "../server/security.js";
import { STALE_MASCOT_NOTICE_TEXT } from "../server/mascot-site-guard-service.js";

const db = getDbPool();
const userId = createId("u");
const email = `mascot-stale-reply-${Date.now()}@example.test`;
const oldMascotId = "mascot_stale_reply_old";
const newMascotId = "mascot_stale_reply_new";

await initializeDatabase();
const snapshot = await snapshotSites();

try {
  await cleanup();
  await seedMascots();
  await seedUser();

  await activateUserCharacterForDb(db, {
    userId,
    characterId: oldMascotId,
    sourceType: "mascot_auto",
    sourceRef: "self-check-old",
  });
  await db.execute(
    "UPDATE user_character_activations SET activation_status = 'inactive', updated_at = NOW(3) WHERE internal_uid = ? AND character_id = ?",
    [userId, oldMascotId]
  );
  await activateUserCharacterForDb(db, {
    userId,
    characterId: newMascotId,
    sourceType: "mascot_auto",
    sourceRef: "self-check-new",
  });

  const userSend = await createUserMessage({
    characterId: oldMascotId,
    userId,
    text: "hello old mascot",
  });
  const userMessage = userSend.items.find((item) => item.senderType === "user");
  assert.ok(userMessage?.id, "user message should be created before stale reply guard");

  const reply = await createUserReply({
    characterId: oldMascotId,
    userId,
    sinceMessageId: userMessage.id,
  });
  const staleReply = reply.items.find((item) => item.senderType === "character");
  assert.ok(staleReply, "stale mascot should return a character-side system reply");
  assert.equal(staleReply.text, STALE_MASCOT_NOTICE_TEXT, "stale mascot reply should use fixed notice text");

  console.log("mascot stale reply self-check passed");
} finally {
  await cleanup();
  await restoreSites(snapshot);
  await closeDbPool();
}

async function seedUser() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, 'Mascot Stale Reply', ?, NOW(3), 'self-check', 'personal', 'site_fkk', NOW(3))`,
    [userId, email, email, hashSecret("MascotStale123"), email]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [userId]);
}

async function seedMascots() {
  await upsertMascot(oldMascotId, "site_gg", "Old Mascot");
  await upsertMascot(newMascotId, "site_fkk", "New Mascot");
  await db.execute("UPDATE sites SET mascot_character_id = ? WHERE id = 'site_gg' LIMIT 1", [oldMascotId]);
  await db.execute("UPDATE sites SET mascot_character_id = ? WHERE id = 'site_fkk' LIMIT 1", [newMascotId]);
  await upsertMascotSetting("site_gg", oldMascotId);
  await upsertMascotSetting("site_fkk", newMascotId);
}

async function upsertMascot(id, siteId, name) {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, ?, ?, ?, 'Site Mascot', 'Self-check mascot', 'assets/char_coach.png', 'assets/banner_hero.png',
       'Hello.', 'Self-check mascot.', 'System', JSON_ARRAY('mascot'), JSON_OBJECT('style', 'check'),
       JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', '5.0'), 'public', 'published', 'self-check', 'mascot-stale-reply', NOW(3))
     ON DUPLICATE KEY UPDATE
       site_id = VALUES(site_id),
       name = VALUES(name),
       visibility = 'public',
       character_status = 'published',
       updated_at = NOW(3)`,
    [id, siteId, id, name]
  );
}

async function upsertMascotSetting(siteId, characterId) {
  await db.execute(
    `INSERT INTO mascot_settings (
       id, site_id, character_id, name, avatar_url, tone, greeting, cta, knowledge_json, setting_status, source_type, source_ref
     ) VALUES (?, ?, ?, 'Reply Mascot', 'assets/char_coach.png', 'System', 'Hello.', '', JSON_ARRAY(), 'active', 'self-check', 'mascot-stale-reply')
     ON DUPLICATE KEY UPDATE
       character_id = VALUES(character_id),
       setting_status = 'active',
       updated_at = NOW(3)`,
    [`mascot_reply_${siteId}`, siteId, characterId]
  );
}

async function snapshotSites() {
  const [rows] = await db.execute(`SELECT id, mascot_character_id FROM sites WHERE id IN ('site_fkk', 'site_gg')`);
  const [settings] = await db.execute(`SELECT id, site_id, character_id FROM mascot_settings WHERE site_id IN ('site_fkk', 'site_gg')`);
  return { rows, settings };
}

async function restoreSites(snapshot) {
  for (const row of snapshot.rows) {
    await db.execute("UPDATE sites SET mascot_character_id = ? WHERE id = ? LIMIT 1", [row.mascot_character_id || null, row.id]);
  }
  for (const setting of snapshot.settings) {
    await db.execute("UPDATE mascot_settings SET character_id = ? WHERE id = ? LIMIT 1", [setting.character_id || null, setting.id]);
  }
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE internal_uid = ?)", [userId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM mascot_settings WHERE id IN ('mascot_reply_site_gg', 'mascot_reply_site_fkk')").catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?)", [oldMascotId, newMascotId]).catch(() => {});
}
