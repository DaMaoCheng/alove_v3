import assert from "node:assert/strict";
import { getDbPool, closeDbPool } from "../server/db.js";
import { registerUser } from "../server/auth-service.js";
import { hashSecret } from "../server/security.js";

const db = getDbPool();
const CODE = "135790";
const PASSWORD = "MascotRule123";
const SITE_MASCOT_ID = "mascot_site_activation_check";
const EMAILS = [
  "mascot-activation-fkk@example.local",
  "mascot-activation-gg@example.local",
];
const siteSnapshot = await snapshotFkkSiteMascot();

try {
  await cleanup();
  await seedSiteMascot();

  await seedEmailCode(EMAILS[0]);
  const siteUser = await registerUser({
    email: EMAILS[0],
    nickname: "FKK Mascot Activation",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    verificationCode: CODE,
    siteSlug: "footballkituk",
  });
  await assertActivation(siteUser.userId, SITE_MASCOT_ID, "site-specific mascot should be activated for matching site");
  await assertNoActivation(siteUser.userId, "mascot_template", "site-specific mascot should not also activate template");

  await seedEmailCode(EMAILS[1]);
  const defaultUser = await registerUser({
    email: EMAILS[1],
    nickname: "GG Mascot Activation",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    verificationCode: CODE,
    siteSlug: "gogoalshop",
  });
  await assertActivation(defaultUser.userId, "mascot_template", "default site should fall back to template mascot");

  console.log("register mascot activation self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seedSiteMascot() {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio, avatar_url, cover_url,
       opening_line, persona_prompt, speaking_style, tags_json, profile_json, metrics_json,
       visibility, character_status, source_type, source_ref, published_at
     ) VALUES (?, 'mascot', NULL, 'site_fkk', ?, 'FKK Mascot Check', 'Site Guide · Mascot',
       'Temporary mascot for registration activation self-check.', 'assets/char_coach.png', 'assets/banner_hero.png',
       'Welcome to FKK.', 'Temporary mascot persona.', 'Friendly guide.', JSON_ARRAY('mascot'), JSON_OBJECT('style', 'check'),
       JSON_OBJECT('chatCountLabel', '0', 'ratingLabel', '5.0'), 'public', 'published', 'self-check', 'mascot-activation', NOW(3))
     ON DUPLICATE KEY UPDATE
       site_id = VALUES(site_id),
       category_id = VALUES(category_id),
       character_status = VALUES(character_status),
       visibility = VALUES(visibility),
       updated_at = NOW(3)`,
    [SITE_MASCOT_ID, SITE_MASCOT_ID]
  );
  await db.execute(
    `INSERT INTO mascot_settings (
       id, site_id, character_id, name, avatar_url, tone, greeting, cta, knowledge_json, setting_status, source_type, source_ref
     ) VALUES ('mascot_setting_activation_check', 'site_fkk', ?, 'FKK Mascot Check', 'assets/char_coach.png',
       'Friendly guide.', 'Welcome to FKK.', '', JSON_ARRAY(), 'active', 'self-check', 'mascot-activation')
     ON DUPLICATE KEY UPDATE
       character_id = VALUES(character_id),
       setting_status = 'active',
       updated_at = NOW(3)`,
    [SITE_MASCOT_ID]
  );
  await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = 'site_fkk' LIMIT 1", [SITE_MASCOT_ID]);
}

async function seedEmailCode(email) {
  await db.execute(
    `INSERT INTO email_verification_codes (email, scene, code_hash, provider, request_ip, expires_at)
     VALUES (?, 'register', ?, 'self-check', '127.0.0.1', DATE_ADD(NOW(3), INTERVAL 10 MINUTE))`,
    [email, hashSecret(CODE)]
  );
}

async function assertActivation(userId, characterId, message) {
  const [[row]] = await db.execute(
    `SELECT source_type, source_ref
     FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ? AND activation_status = 'active'
     LIMIT 1`,
    [userId, characterId]
  );
  assert.ok(row, message);
  assert.equal(row.source_type, "mascot_auto", "registration mascot activation should use the unified source type");
  assert.equal(row.source_ref, "registration-mascot", "registration mascot activation should keep the source reference");
}

async function assertNoActivation(userId, characterId, message) {
  const [[row]] = await db.execute(
    `SELECT COUNT(*) AS count
     FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ? AND activation_status = 'active'`,
    [userId, characterId]
  );
  assert.equal(Number(row?.count || 0), 0, message);
}

async function cleanup() {
  await restoreFkkSiteMascot();
  await db.execute("DELETE FROM email_verification_codes WHERE email IN (?, ?)", EMAILS);
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid IN (SELECT id FROM users WHERE email IN (?, ?))", EMAILS);
  await db.execute("DELETE FROM users WHERE email IN (?, ?)", EMAILS);
  await db.execute("DELETE FROM mascot_settings WHERE id = 'mascot_setting_activation_check'");
  await db.execute("DELETE FROM ai_characters WHERE id = ?", [SITE_MASCOT_ID]);
}

async function snapshotFkkSiteMascot() {
  const [[row]] = await db.execute("SELECT mascot_character_id FROM sites WHERE id = 'site_fkk' LIMIT 1");
  const [[setting]] = await db.execute(
    `SELECT character_id, source_type, source_ref, setting_status
     FROM mascot_settings
     WHERE site_id = 'site_fkk'
     LIMIT 1`
  );
  return {
    mascotCharacterId: row?.mascot_character_id || null,
    setting: setting ? {
      characterId: setting.character_id || null,
      sourceType: setting.source_type || null,
      sourceRef: setting.source_ref || null,
      status: setting.setting_status || "active",
    } : null,
  };
}

async function restoreFkkSiteMascot() {
  await db.execute(
    "UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = 'site_fkk' LIMIT 1",
    [siteSnapshot.mascotCharacterId]
  );
  if (siteSnapshot.setting?.characterId) {
    await db.execute(
      `UPDATE mascot_settings
       SET character_id = ?,
           source_type = ?,
           source_ref = ?,
           setting_status = ?,
           updated_at = NOW(3)
       WHERE site_id = 'site_fkk'
       LIMIT 1`,
      [
        siteSnapshot.setting.characterId,
        siteSnapshot.setting.sourceType,
        siteSnapshot.setting.sourceRef,
        siteSnapshot.setting.status,
      ]
    );
  }
}
