import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDbPool, closeDbPool } from "../server/db.js";
import { activateUserCharacterForDb } from "../server/character-activation-service.js";
import { listUserChatContacts } from "../server/chat-query-service.js";
import { hashSecret } from "../server/security.js";

const db = getDbPool();
const ADMIN_ID = "u_admin_contact_owner_check";
const ADMIN_EMAIL = "admin-contact-owner-check@example.local";
const ADMIN_OWNED_COMMON_ID = "admin_owned_common_contact_check";
const CROSS_SITE_CREATOR_ID = "admin_cross_site_creator_contact_check";

try {
  await cleanup();
  await seedData();
  await activateUserCharacterForDb(db, { userId: ADMIN_ID, characterId: ADMIN_OWNED_COMMON_ID, sourceType: "self-check", sourceRef: "owned" });
  await activateUserCharacterForDb(db, { userId: ADMIN_ID, characterId: CROSS_SITE_CREATOR_ID, sourceType: "self-check", sourceRef: "creator" });

  const contacts = await listUserChatContacts(ADMIN_ID, { siteSlug: "gogoalshop", accountType: "admin" });
  const ids = new Set(contacts.items.map((item) => item.characterId));
  assert.equal(ids.has(CROSS_SITE_CREATOR_ID), true, "admin contacts should include activated creator characters from another site");

  const ownedContact = contacts.items.find((item) => item.characterId === ADMIN_OWNED_COMMON_ID);
  assert.ok(ownedContact, "admin-owned common character should appear in contacts");
  assert.equal(ownedContact.ownerUid, ADMIN_ID, "contact payload should expose ownerUid");
  assert.equal(ownedContact.isOwnCharacter, true, "contact payload should mark owner-created characters");

  const sidebarSource = readFileSync("src/features/app-shell/app-sidebar.js", "utf8");
  assert.match(sidebarSource, /own-character-tag/, "sidebar should render an owner-created contact tag");
  assert.match(sidebarSource, /isOwnCharacter/, "sidebar owner tag should use the contact ownership flag");

  console.log("admin contact owner visibility self-check passed");
} finally {
  await cleanup().catch(() => {});
  await closeDbPool();
}

async function seedData() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Admin Contact Owner Check', ?, NOW(3), 'email', 'admin', NULL, NOW(3))`,
    [ADMIN_ID, ADMIN_EMAIL, ADMIN_EMAIL, hashSecret("AdminContactOwner123"), ADMIN_EMAIL]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [ADMIN_ID]);
  await insertCharacter({
    id: ADMIN_OWNED_COMMON_ID,
    categoryId: "football_babe",
    ownerUid: ADMIN_ID,
    siteId: null,
    name: "Admin Owned Contact Check",
  });
  await insertCharacter({
    id: CROSS_SITE_CREATOR_ID,
    categoryId: "creator",
    ownerUid: null,
    siteId: "site_fkk",
    name: "Admin Cross Site Creator Check",
  });
}

async function insertCharacter({ id, categoryId, ownerUid, siteId, name }) {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'Self Check', 'Temporary admin contact character.', 'assets/char_fan.png', 'assets/banner_hero.png',
       'Hello.', 'Temporary persona.', 'Friendly.', JSON_ARRAY('self-check'), JSON_OBJECT('style', 'check'),
       JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', '5.0'), 'public', 'published', 'self-check', 'admin-contact-owner', NOW(3))`,
    [id, categoryId, ownerUid, siteId, id, name]
  );
}

async function cleanup() {
  await db.execute(
    "DELETE FROM chat_messages WHERE character_id IN (?, ?) OR session_id IN (SELECT id FROM chat_sessions WHERE internal_uid = ?)",
    [ADMIN_OWNED_COMMON_ID, CROSS_SITE_CREATOR_ID, ADMIN_ID]
  );
  await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ? OR character_id IN (?, ?)", [ADMIN_ID, ADMIN_OWNED_COMMON_ID, CROSS_SITE_CREATOR_ID]);
  await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ? OR character_id IN (?, ?)", [ADMIN_ID, ADMIN_OWNED_COMMON_ID, CROSS_SITE_CREATOR_ID]);
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [ADMIN_ID]);
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?)", [ADMIN_OWNED_COMMON_ID, CROSS_SITE_CREATOR_ID]);
  await db.execute("DELETE FROM users WHERE id = ?", [ADMIN_ID]);
}
