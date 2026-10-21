import assert from "node:assert/strict";
import { initializeDatabase, getDbPool } from "../server/db.js";
import { createAdminCharacter, listAdminCharacters, updateAdminCharacterSettings } from "../server/character-admin-service.js";

const TEST_NAME = "Creator Admin Create Check";
const TEST_SOURCE_REF = "admin-creator-create-self-check";
const CREATOR_OWNER_ID = "u_admin_creator_owner_self_check";
const CREATOR_OWNER_EMAIL = "admin-creator-owner-self-check@example.local";
const SECOND_CREATOR_OWNER_ID = "u_admin_creator_owner_second_self_check";
const SECOND_CREATOR_OWNER_EMAIL = "admin-creator-owner-second-self-check@example.local";

await initializeDatabase();
const pool = getDbPool();
let createdId = "";
let siteStatusRestoreId = "";

try {
  await cleanupTestRows(pool);
  const [sites] = await pool.execute("SELECT id, name FROM sites WHERE site_status = 'active' ORDER BY is_default DESC, created_at ASC LIMIT 2");
  assert.ok(sites.length, "at least one active site should exist before creator admin self-check");
  const firstSite = sites[0];
  const secondSite = sites[1] || sites[0];
  siteStatusRestoreId = firstSite.id;
  await seedCreatorOwner(pool, firstSite.id);
  await seedCreatorOwner(pool, firstSite.id, {
    id: SECOND_CREATOR_OWNER_ID,
    email: SECOND_CREATOR_OWNER_EMAIL,
  });

  const created = await createAdminCharacter(null, {
    name: TEST_NAME,
    category: "creator",
    ownerUid: CREATOR_OWNER_ID,
    siteId: secondSite.id,
    avatarUrl: "",
    openingLine: "Temporary opener.",
    backstory: "Temporary creator persona for admin creation verification.",
    personality: "Cheeky banter",
    voiceStyle: "Bright & playful",
    visibility: "public",
    characterStatus: "published",
    language: "English",
  });
  createdId = created.item.id;

  assert.equal(created.item.category.id, "creator");
  assert.equal(created.item.ownerUid, CREATOR_OWNER_ID, "admin creator create should persist selected creator account as owner");
  assert.equal(created.item.siteId, firstSite.id, "admin creator create should derive site from selected creator account");
  assert.equal(created.item.characterStatus, "published");
  assert.equal(created.item.visibility, "public");
  assert.ok(String(created.item.roleTitle || "").trim(), "admin creator create should auto-generate a role title");

  await pool.execute("UPDATE ai_characters SET source_ref = ? WHERE id = ?", [TEST_SOURCE_REF, createdId]);

  await assert.rejects(
    () => createAdminCharacter(null, {
      name: `${TEST_NAME} Duplicate`,
      category: "creator",
      ownerUid: CREATOR_OWNER_ID,
      avatarUrl: "",
      openingLine: "Temporary duplicate opener.",
      backstory: "Temporary duplicate creator persona for admin creation verification.",
      personality: "Cheeky banter",
      voiceStyle: "Bright & playful",
      visibility: "public",
      characterStatus: "published",
      language: "English",
    }),
    /已绑定网红角色|只能绑定一个网红角色/,
    "same creator account should not create a second active creator character"
  );

  const initial = await listAdminCharacters({ type: "creator", query: "Create Check" });
  const creator = initial.items.find((item) => item.id === createdId);
  assert.ok(creator, "created creator should be found by real admin creator search");
  assert.equal(creator.ownerUid, CREATOR_OWNER_ID);
  assert.equal(creator.siteId, firstSite.id);

  await assert.rejects(
    () => updateAdminCharacterSettings(createdId, {
      name: TEST_NAME,
      category: "fan",
      avatarUrl: "",
      openingLine: "Temporary opener.",
      backstory: "Temporary creator persona for admin creation verification.",
      personality: "Cheeky banter",
      voiceStyle: "Bright & playful",
      visibility: "public",
      characterStatus: "published",
      language: "English",
    }),
    /不能通过普通编辑变更角色分类/,
    "creator edit must not use category changes to bypass owner immutability"
  );

  await assert.rejects(
    () => updateAdminCharacterSettings(createdId, {
      name: TEST_NAME,
      category: "creator",
      ownerUid: SECOND_CREATOR_OWNER_ID,
      avatarUrl: "",
      openingLine: "Temporary opener.",
      backstory: "Temporary creator persona for admin creation verification.",
      personality: "Cheeky banter",
      voiceStyle: "Bright & playful",
      visibility: "public",
      characterStatus: "published",
      language: "English",
    }),
    /不能更换绑定账号/,
    "creator edit must not transfer historical data to another owner"
  );

  await pool.execute("UPDATE users SET account_status = 'disabled' WHERE id = ?", [CREATOR_OWNER_ID]);

  const updated = await updateAdminCharacterSettings(createdId, {
    name: "Creator Admin Create Check Updated",
    category: "creator",
    siteId: secondSite.id,
    roleTitle: "Creator · Updated",
    shortBio: "Updated temporary creator for admin interface verification.",
    avatarUrl: "",
    openingLine: "Updated opener.",
    backstory: "Updated creator persona.",
    personality: "Cheeky banter",
    voiceProvider: "system",
    voiceId: "bright_playful",
    voiceStyle: "Bright & playful",
    visibility: "public",
    characterStatus: "archived",
    language: "English",
  });

  assert.equal(updated.item.id, createdId);
  assert.equal(updated.item.category.id, "creator");
  assert.equal(updated.item.ownerUid, CREATOR_OWNER_ID);
  assert.equal(updated.item.siteId, firstSite.id, "creator edit should keep site derived from owner account");
  assert.equal(updated.item.characterStatus, "archived");

  await pool.execute("UPDATE users SET account_status = 'active' WHERE id = ?", [CREATOR_OWNER_ID]);
  await pool.execute("UPDATE sites SET site_status = 'inactive' WHERE id = ?", [firstSite.id]);
  const archivedWithInactiveSite = await updateAdminCharacterSettings(createdId, {
    name: "Creator Admin Create Check Updated",
    category: "creator",
    roleTitle: "Creator · Updated",
    shortBio: "Updated temporary creator for admin interface verification.",
    avatarUrl: "",
    openingLine: "Updated opener.",
    backstory: "Updated creator persona.",
    personality: "Cheeky banter",
    voiceProvider: "system",
    voiceId: "bright_playful",
    voiceStyle: "Bright & playful",
    visibility: "public",
    characterStatus: "archived",
    language: "English",
  });
  assert.equal(archivedWithInactiveSite.item.characterStatus, "archived", "an inactive site must not block archiving");
  await pool.execute("UPDATE sites SET site_status = 'active' WHERE id = ?", [firstSite.id]);

  await cleanupTestRows(pool);
  createdId = "";

  console.log(JSON.stringify({
    ok: true,
    checked: "creator admin create/search/update/archive/account binding",
    cleanedUp: true,
  }, null, 2));
} catch (error) {
  await cleanupTestRows(pool).catch(() => {});
  throw error;
} finally {
  if (siteStatusRestoreId) {
    await pool.execute("UPDATE sites SET site_status = 'active' WHERE id = ?", [siteStatusRestoreId]).catch(() => {});
  }
  await pool.end();
}

async function seedCreatorOwner(pool, siteId, { id = CREATOR_OWNER_ID, email = CREATOR_OWNER_EMAIL } = {}) {
  await pool.execute(
    `INSERT INTO users (
       id, platform_uid, username, nickname, password_hash,
       email, email_verified_at, email_auth_provider, account_status, account_type,
       site_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'self-check', ?, NOW(3), 'email', 'active', 'creator', ?, NOW(3), NOW(3))`,
    [id, id, id, "Creator Owner Self Check", email, siteId]
  );
}

async function cleanupTestRows(pool) {
  await pool.execute(
    "DELETE FROM ai_characters WHERE id = ? OR name LIKE ? OR source_ref = ? OR owner_uid = ?",
    [createdId || "__none__", `${TEST_NAME}%`, TEST_SOURCE_REF, CREATOR_OWNER_ID]
  );
  await pool.execute("DELETE FROM users WHERE id = ? OR email = ?", [CREATOR_OWNER_ID, CREATOR_OWNER_EMAIL]);
  await pool.execute("DELETE FROM users WHERE id = ? OR email = ?", [SECOND_CREATOR_OWNER_ID, SECOND_CREATOR_OWNER_EMAIL]);
}
