import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { updateAdminAccountSite } from "../server/admin-account-service.js";
import { createId, hashSecret } from "../server/security.js";

const db = getDbPool();
const userId = createId("u");
const email = `mascot-site-switch-${Date.now()}@example.test`;
const siteFkkMascotId = "mascot_switch_site_fkk";
const siteGgMascotId = "mascot_switch_site_gg";

await initializeDatabase();
const snapshot = await snapshotSites();

try {
  await cleanup();
  await seedMascots();
  await seedUser();
  await seedActivation("mascot_switch_site_gg");
  await seedActivation("mascot_switch_site_fkk", "inactive");

  const result = await updateAdminAccountSite([userId], "site_fkk");
  assert.equal(result.ok, true, "site switch should succeed");
  assert.equal(result.updatedCount, 1, "exactly one account should be updated");

  await assertInactive(siteGgMascotId);
  await assertActive(siteFkkMascotId);

  console.log("mascot site switch self-check passed");
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
     ) VALUES (?, 'web', ?, 'en', ?, ?, 'Mascot Switch Check', ?, NOW(3), 'self-check', 'personal', 'site_gg', NOW(3))`,
    [userId, email, email, hashSecret("MascotSwitch123"), email]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [userId]);
}

async function seedMascots() {
  await upsertMascot(siteFkkMascotId, "site_fkk", "FKK Switch Mascot");
  await upsertMascot(siteGgMascotId, "site_gg", "GG Switch Mascot");
  await db.execute("UPDATE sites SET mascot_character_id = ? WHERE id = 'site_fkk' LIMIT 1", [siteFkkMascotId]);
  await db.execute("UPDATE sites SET mascot_character_id = ? WHERE id = 'site_gg' LIMIT 1", [siteGgMascotId]);
  await upsertMascotSetting("site_fkk", siteFkkMascotId);
  await upsertMascotSetting("site_gg", siteGgMascotId);
}

async function upsertMascot(id, siteId, name) {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, ?, ?, ?, 'Site Mascot', 'Self-check mascot', 'assets/char_coach.png', 'assets/banner_hero.png',
       'Hello.', 'Self-check mascot.', 'System', JSON_ARRAY('mascot'), JSON_OBJECT('style', 'check'),
       JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', '5.0'), 'public', 'published', 'self-check', 'mascot-site-switch', NOW(3))
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
     ) VALUES (?, ?, ?, 'Switch Mascot', 'assets/char_coach.png', 'System', 'Hello.', '', JSON_ARRAY(), 'active', 'self-check', 'mascot-site-switch')
     ON DUPLICATE KEY UPDATE
       character_id = VALUES(character_id),
       setting_status = 'active',
       updated_at = NOW(3)`,
    [`mascot_setting_${siteId}`, siteId, characterId]
  );
}

async function seedActivation(characterId, status = "active") {
  await db.execute(
    `INSERT INTO user_character_activations (
       id, internal_uid, character_id, activation_status, source_type, source_ref, activated_at
     ) VALUES (?, ?, ?, ?, 'mascot_auto', 'self-check', NOW(3))`,
    [createId("act"), userId, characterId, status]
  );
}

async function assertInactive(characterId) {
  const [[row]] = await db.execute(
    `SELECT activation_status FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     ORDER BY updated_at DESC, activated_at DESC
     LIMIT 1`,
    [userId, characterId]
  );
  assert.equal(row?.activation_status, "inactive", "old mascot activation should be inactive");
}

async function assertActive(characterId) {
  const [[row]] = await db.execute(
    `SELECT activation_status FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     ORDER BY updated_at DESC, activated_at DESC
     LIMIT 1`,
    [userId, characterId]
  );
  assert.equal(row?.activation_status, "active", "new mascot activation should be active");
}

async function snapshotSites() {
  const [rows] = await db.execute(
    `SELECT id, mascot_character_id FROM sites WHERE id IN ('site_fkk', 'site_gg')`
  );
  const [settings] = await db.execute(
    `SELECT id, site_id, character_id FROM mascot_settings WHERE site_id IN ('site_fkk', 'site_gg')`
  );
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
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM mascot_settings WHERE id IN ('mascot_setting_site_fkk', 'mascot_setting_site_gg')").catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id IN (?, ?)", [siteFkkMascotId, siteGgMascotId]).catch(() => {});
}
