import assert from "node:assert/strict";
import { getDbPool, closeDbPool } from "../server/db.js";
import { listUserChatContacts } from "../server/chat-query-service.js";
import { activateUserCharacterForDb } from "../server/character-activation-service.js";
import { hashSecret } from "../server/security.js";

const db = getDbPool();
const USER_ID = "u_contact_site_filter_check";
const EMAIL = "contact-site-filter@example.local";
const GG_CREATOR_ID = "creator_contact_site_gg";
const FKK_CREATOR_ID = "creator_contact_site_fkk";
const COMMON_ID = "common_contact_site_filter";

try {
  await cleanup();
  await seedData();
  await activateUserCharacterForDb(db, { userId: USER_ID, characterId: GG_CREATOR_ID, sourceType: "self-check", sourceRef: "gg" });
  await activateUserCharacterForDb(db, { userId: USER_ID, characterId: FKK_CREATOR_ID, sourceType: "self-check", sourceRef: "fkk" });
  await activateUserCharacterForDb(db, { userId: USER_ID, characterId: COMMON_ID, sourceType: "self-check", sourceRef: "common" });

  const fkkResult = await listUserChatContacts(USER_ID, { siteSlug: "footballkituk" });
  const fkkIds = fkkResult.items.map((item) => item.characterId).sort();
  assert.ok(fkkIds.includes(FKK_CREATOR_ID), "current site creator should remain visible");
  assert.ok(fkkIds.includes(COMMON_ID), "common character should remain visible across sites");
  assert.ok(!fkkIds.includes(GG_CREATOR_ID), "other site creator should be hidden from contacts");

  const ggResult = await listUserChatContacts(USER_ID, { siteSlug: "gogoalshop" });
  const ggIds = ggResult.items.map((item) => item.characterId).sort();
  assert.ok(ggIds.includes(GG_CREATOR_ID), "default site creator should remain visible on GG");
  assert.ok(ggIds.includes(COMMON_ID), "common character should remain visible on GG");
  assert.ok(!ggIds.includes(FKK_CREATOR_ID), "FKK creator should be hidden on GG");

  console.log("contact site filtering self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seedData() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Contact Site Filter', ?, NOW(3), 'email', 'personal', 'site_fkk', NOW(3))`,
    [USER_ID, EMAIL, EMAIL, hashSecret("ContactSite123"), EMAIL]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [USER_ID]);
  await insertCharacter({ id: GG_CREATOR_ID, categoryId: "creator", siteId: "site_gg", name: "GG Contact Creator" });
  await insertCharacter({ id: FKK_CREATOR_ID, categoryId: "creator", siteId: "site_fkk", name: "FKK Contact Creator" });
  await insertCharacter({ id: COMMON_ID, categoryId: "companion", siteId: null, name: "Common Contact Character" });
}

async function insertCharacter({ id, categoryId, siteId, name }) {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'Self Check', 'Temporary contact filtering character.', 'assets/char_fan.png', 'assets/banner_hero.png',
       'Hello.', 'Temporary persona.', 'Friendly.', JSON_ARRAY('self-check'), JSON_OBJECT('style', 'check'),
       JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', '5.0'), 'public', 'published', 'self-check', 'contact-site-filter', NOW(3))`,
    [id, categoryId, siteId, id, name]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE character_id IN (?, ?, ?) OR session_id IN (SELECT id FROM chat_sessions WHERE internal_uid = ?)", [GG_CREATOR_ID, FKK_CREATOR_ID, COMMON_ID, USER_ID]);
  await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ? OR character_id IN (?, ?, ?)", [USER_ID, GG_CREATOR_ID, FKK_CREATOR_ID, COMMON_ID]);
  await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ? OR character_id IN (?, ?, ?)", [USER_ID, GG_CREATOR_ID, FKK_CREATOR_ID, COMMON_ID]);
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [USER_ID]);
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]);
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?, ?)", [GG_CREATOR_ID, FKK_CREATOR_ID, COMMON_ID]);
}
