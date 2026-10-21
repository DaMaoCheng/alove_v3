import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { listPublicCharacters } from "../server/character-public-service.js";
import { resolveAvailableCharacterCategory } from "../src/app/character-load-actions.js";

const COMMON_ID = "test_site_common_character";
const GG_ID = "test_site_creator_gg";
const FKK_ID = "test_site_creator_fkk";
const TEMPLATE_MASCOT_ID = "mascot_template";
const FKK_MASCOT_ID = "test_site_mascot_fkk";
const EMPTY_SITE_ID = "site_creator_category_empty_self_check";
const EMPTY_SITE_SLUG = "creator-category-empty-self-check";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  await db.execute(
    `INSERT INTO sites (id, name, slug, site_status, is_default)
     VALUES (?, 'Creator Category Empty Test', ?, 'active', 0)`,
    [EMPTY_SITE_ID, EMPTY_SITE_SLUG]
  );
  await seedCharacter({
    id: COMMON_ID,
    slug: "test-site-common-character",
    categoryId: "companion",
    siteId: null,
    name: "Site Common Character",
  });
  await seedCharacter({
    id: GG_ID,
    slug: "test-site-creator-gg",
    categoryId: "creator",
    siteId: "site_gg",
    name: "GG Creator Character",
  });
  await seedCharacter({
    id: FKK_ID,
    slug: "test-site-creator-fkk",
    categoryId: "creator",
    siteId: "site_fkk",
    name: "FKK Creator Character",
  });
  await seedCharacter({
    id: FKK_MASCOT_ID,
    slug: "test-site-mascot-fkk",
    categoryId: "mascot",
    siteId: "site_fkk",
    name: "FKK Mascot Character",
  });
  const siteSnapshot = await snapshotSiteMascots();
  await setSiteMascot("site_fkk", FKK_MASCOT_ID);
  await setSiteMascot("site_gg", TEMPLATE_MASCOT_ID);

  const gg = await listPublicCharacters({ siteSlug: "gogoalshop" });
  const fkk = await listPublicCharacters({ siteSlug: "footballkituk" });
  const defaultSite = await listPublicCharacters({});
  const emptySite = await listPublicCharacters({ siteSlug: EMPTY_SITE_SLUG });

  assertCharacterSet(gg.items, {
    present: [COMMON_ID, GG_ID, TEMPLATE_MASCOT_ID],
    absent: [FKK_ID, FKK_MASCOT_ID],
    label: "GG site",
  });
  assertCharacterSet(fkk.items, {
    present: [COMMON_ID, FKK_ID, FKK_MASCOT_ID],
    absent: [GG_ID, TEMPLATE_MASCOT_ID],
    label: "FKK site",
  });
  assertCharacterSet(defaultSite.items, {
    present: [COMMON_ID, GG_ID, TEMPLATE_MASCOT_ID],
    absent: [FKK_ID, FKK_MASCOT_ID],
    label: "default site",
  });
  assertCategoryState(gg.categories, "creator", true, "GG site");
  assertCategoryState(fkk.categories, "creator", true, "FKK site");
  assertCategoryState(emptySite.categories, "creator", false, "site without creator characters");
  assert.notEqual(
    resolveAvailableCharacterCategory("Creator", emptySite.categories),
    "Creator",
    "an unavailable active Creator category should fall back to the first visible category"
  );

  await restoreSiteMascots(siteSnapshot);
  await cleanup();
  console.log("site character filtering self-check passed");
} finally {
  await cleanup().catch(() => {});
  await closeDbPool();
}

async function seedCharacter({ id, slug, categoryId, siteId, name }) {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio,
       avatar_url, opening_line, persona_prompt, speaking_style, tags_json,
       profile_json, metrics_json, visibility, character_status, source_type,
       source_ref, published_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'Test · Site', 'Temporary character for site filtering checks.',
       '/assets/char_fan.png', 'Hello from a site test character.', 'Temporary persona.',
       'Direct and concise.', JSON_ARRAY('site-test'), JSON_OBJECT('language', 'English'),
       JSON_OBJECT(), 'public', 'published', 'system', 'site-filter-self-check', NOW(3))`,
    [id, categoryId, siteId, slug, name]
  );
}

function assertCategoryState(categories, categoryId, expected, label) {
  const ids = new Set(categories.map((item) => String(item.id || "").toLowerCase()));
  assert.equal(ids.has(categoryId), expected, `${label} Creator category visibility should be ${expected}`);
}

async function cleanup() {
  await db.execute(
    `DELETE FROM ai_characters WHERE id IN (?, ?, ?, ?) OR source_ref = 'site-filter-self-check'`,
    [COMMON_ID, GG_ID, FKK_ID, FKK_MASCOT_ID]
  );
  await db.execute("DELETE FROM sites WHERE id = ?", [EMPTY_SITE_ID]);
}

async function snapshotSiteMascots() {
  const [rows] = await db.execute("SELECT id, mascot_character_id FROM sites WHERE id IN ('site_gg','site_fkk') ORDER BY id ASC");
  return rows.map((row) => ({ id: row.id, mascotCharacterId: row.mascot_character_id || TEMPLATE_MASCOT_ID }));
}

async function setSiteMascot(siteId, characterId) {
  await db.execute("DELETE FROM mascot_settings WHERE site_id = ?", [siteId]);
  await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [characterId, siteId]);
}

async function restoreSiteMascots(snapshot = []) {
  for (const item of snapshot) {
    await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [item.mascotCharacterId, item.id]);
  }
}

function assertCharacterSet(items, { present, absent, label }) {
  const ids = new Set(items.map((item) => item.id));
  for (const id of present) {
    assert.equal(ids.has(id), true, `${label} should include ${id}`);
  }
  for (const id of absent) {
    assert.equal(ids.has(id), false, `${label} should not include ${id}`);
  }
}
