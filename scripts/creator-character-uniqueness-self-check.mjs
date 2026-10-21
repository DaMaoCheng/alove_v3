import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { ACTIVE_CREATOR_OWNER_UNIQUE_INDEX, isActiveCreatorOwnerConflict } from "../server/character-owner-constraint.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "creator character uniqueness self-check" });
await initializeDatabase();

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const ownerId = `u_creator_unique_${suffix}`;
const db = getDbPool();

try {
  const [[column]] = await db.query(`
    SELECT GENERATION_EXPRESSION AS generation_expression
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ai_characters'
      AND COLUMN_NAME = 'active_creator_marker'
    LIMIT 1
  `);
  assert.match(String(column?.generation_expression || ""), /category_id.*creator/i);
  assert.match(String(column?.generation_expression || ""), /character_status.*archived/i);

  const [[index]] = await db.query(`
    SELECT NON_UNIQUE AS non_unique
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ai_characters'
      AND INDEX_NAME = ?
    LIMIT 1
  `, [ACTIVE_CREATOR_OWNER_UNIQUE_INDEX]);
  assert.equal(Number(index?.non_unique), 0, "active creator owner index must be unique");

  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, email,
       account_type, site_id, account_status
     ) VALUES (?, 'web', ?, 'en', ?, 'self-check', ?, 'creator', 'site_fkk', 'active')`,
    [ownerId, ownerId, ownerId, `${ownerId}@example.test`]
  );

  const concurrent = await Promise.allSettled([
    insertCharacter("concurrent_a", "creator", "published"),
    insertCharacter("concurrent_b", "creator", "draft"),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "only one concurrent active creator insert may succeed");
  const rejected = concurrent.find((result) => result.status === "rejected");
  assert.equal(isActiveCreatorOwnerConflict(rejected?.reason), true, "the rejected concurrent insert must identify the owner uniqueness constraint");

  const [[active]] = await db.execute(
    "SELECT id FROM ai_characters WHERE owner_uid = ? AND category_id = 'creator' AND character_status <> 'archived'",
    [ownerId]
  );
  assert.ok(active?.id);
  await db.execute("UPDATE ai_characters SET character_status = 'archived' WHERE id = ?", [active.id]);

  const replacementId = await insertCharacter("replacement", "creator", "published");
  await insertCharacter("ordinary_a", "fan", "published");
  await insertCharacter("ordinary_b", "fan", "published");
  await insertCharacter("archived_creator", "creator", "archived");

  await assert.rejects(
    () => db.execute("UPDATE ai_characters SET character_status = 'published' WHERE id = ?", [active.id]),
    (error) => isActiveCreatorOwnerConflict(error),
    "an archived creator character cannot reactivate while its replacement is active"
  );

  const [[counts]] = await db.execute(
    `SELECT
       SUM(category_id = 'creator' AND character_status <> 'archived') AS active_creators,
       SUM(category_id = 'creator' AND character_status = 'archived') AS archived_creators,
       SUM(category_id = 'fan') AS ordinary_characters
     FROM ai_characters
     WHERE owner_uid = ?`,
    [ownerId]
  );
  assert.equal(Number(counts.active_creators), 1);
  assert.ok(Number(counts.archived_creators) >= 1);
  assert.equal(Number(counts.ordinary_characters), 2);
  assert.ok(replacementId);

  console.log("creator character uniqueness self-check passed");
} finally {
  await db.execute("DELETE FROM ai_characters WHERE owner_uid = ?", [ownerId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [ownerId]).catch(() => {});
  await closeDbPool();
}

async function insertCharacter(key, categoryId, characterStatus) {
  const id = `char_${key}_${suffix}`;
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, visibility,
       character_status, source_type, source_ref
     ) VALUES (?, ?, ?, 'site_fkk', ?, ?, 'private', ?, 'self_check', 'creator-uniqueness')`,
    [id, categoryId, ownerId, `${key}-${suffix}`, `${key} ${suffix}`, characterStatus]
  );
  return id;
}
