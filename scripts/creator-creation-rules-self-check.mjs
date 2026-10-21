import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createUserCharacter } from "../server/character-creation-service.js";
import { hashSecret } from "../server/security.js";

// This suite verifies account/site/uniqueness rules, not text quality. Keep
// configured-provider paths deterministic without any paid/network generation.
globalThis.fetch = async () => new Response(JSON.stringify({
  choices: [{ message: { content: 'Fixture football companion bio' } }],
  output_text: 'Fixture football companion bio',
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

const PERSONAL_ID = "u_site_creator_rule_personal";
const CREATOR_UNBOUND_ID = "u_site_creator_rule_unbound";
const CREATOR_BOUND_ID = "u_site_creator_rule_bound";
const ADMIN_ID = "u_site_creator_rule_admin";
const TEST_EMAILS = [
  "site-creator-rule-personal@example.local",
  "site-creator-rule-unbound@example.local",
  "site-creator-rule-bound@example.local",
  "site-creator-rule-admin@example.local",
];

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await seedUser({ id: PERSONAL_ID, email: TEST_EMAILS[0], accountType: "personal", siteId: null });
  await seedUser({ id: CREATOR_UNBOUND_ID, email: TEST_EMAILS[1], accountType: "creator", siteId: null });
  await seedUser({ id: CREATOR_BOUND_ID, email: TEST_EMAILS[2], accountType: "creator", siteId: "site_fkk" });
  await seedUser({ id: ADMIN_ID, email: TEST_EMAILS[3], accountType: "admin", siteId: null });

  await assertRejectsUserError(
    () => createUserCharacter(PERSONAL_ID, creatorPayload("Personal Creator Blocked")),
    /普通用户不能创建网红角色|creator/i,
    "personal users cannot create creator characters"
  );

  await assertRejectsUserError(
    () => createUserCharacter(CREATOR_UNBOUND_ID, creatorPayload("Unbound Creator Blocked")),
    /绑定站点|site/i,
    "creator users without a site cannot create creator characters"
  );

  const created = await createUserCharacter(CREATOR_BOUND_ID, creatorPayload("Bound Creator Allowed"));
  assert.equal(created.item.category.id, "creator");
  assert.equal(created.item.siteId, "site_fkk");

  await assertRejectsUserError(
    () => createUserCharacter(CREATOR_BOUND_ID, creatorPayload("Second Creator Blocked")),
    /只能创建一个|already/i,
    "creator users cannot create a second creator character"
  );

  const adminCreated = await createUserCharacter(ADMIN_ID, creatorPayload("Admin Creator Allowed"));
  assert.equal(adminCreated.item.category.id, "creator");
  assert.equal(adminCreated.item.siteId, "");

  await cleanup();
  console.log("creator creation rules self-check passed");
} finally {
  await cleanup().catch(() => {});
  await closeDbPool();
}

function creatorPayload(name) {
  return {
    name,
    categoryId: "creator",
    personality: "Cheeky banter",
    voiceStyle: "nova",
    language: "English",
    visibility: "public",
    openingLine: "Hello, welcome to my football corner.",
    backstory: "This is a temporary creator character used to verify site binding and creator creation rules.",
    avatarUrl: "assets/char_fan.png",
  };
}

async function seedUser({ id, email, accountType, siteId }) {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_status, account_type,
       site_id, created_at, updated_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, ?, ?, NOW(3), 'email', 'active', ?, ?, NOW(3), NOW(3))`,
    [id, email, email, hashSecret("AioveTest#0605"), id, email, accountType, siteId]
  );
  await db.execute(
    `INSERT INTO billing_accounts (internal_uid, balance, currency)
     VALUES (?, 0, 'credits')
     ON DUPLICATE KEY UPDATE balance = VALUES(balance)`,
    [id]
  );
}

async function cleanup() {
  await db.execute("DELETE FROM ai_characters WHERE owner_uid IN (?, ?, ?, ?) OR source_ref = 'creator-rule-self-check'", [PERSONAL_ID, CREATOR_UNBOUND_ID, CREATOR_BOUND_ID, ADMIN_ID]);
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid IN (?, ?, ?, ?)", [PERSONAL_ID, CREATOR_UNBOUND_ID, CREATOR_BOUND_ID, ADMIN_ID]);
  await db.execute(`DELETE FROM users WHERE id IN (?, ?, ?, ?) OR email IN (${TEST_EMAILS.map(() => "?").join(",")})`, [PERSONAL_ID, CREATOR_UNBOUND_ID, CREATOR_BOUND_ID, ADMIN_ID, ...TEST_EMAILS]);
}

async function assertRejectsUserError(work, pattern, message) {
  await assert.rejects(work, (error) => {
    assert.match(String(error?.message || ""), pattern, message);
    return true;
  });
}
