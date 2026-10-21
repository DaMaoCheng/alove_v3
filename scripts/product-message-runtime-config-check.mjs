import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";

const CHARACTER_ID = process.argv[2] || "fan";

await initializeDatabase();
const db = getDbPool();

try {
  const [[character]] = await db.execute(
    `SELECT c.id, c.name, c.category_id, c.site_id, s.slug AS site_slug, s.product_api_url
     FROM ai_characters c
     LEFT JOIN sites s ON s.id = c.site_id
     WHERE c.id = ?
     LIMIT 1`,
    [CHARACTER_ID]
  );
  assert.ok(character?.id, `character ${CHARACTER_ID} should exist`);

  const [[defaultSite]] = await db.execute(
    `SELECT id, slug, product_api_url
     FROM sites
     WHERE is_default = 1 AND site_status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`
  );

  const canSendProduct = character.category_id === "creator" || character.category_id === "mascot" || character.id === "mascot_template" || String(character.id || "").startsWith("mascot_");
  const effectiveProductApiUrl = character.category_id === "creator"
    ? character.product_api_url
    : defaultSite?.product_api_url;

  const result = {
    characterId: character.id,
    characterName: character.name,
    categoryId: character.category_id,
    characterSiteId: character.site_id || "",
    characterSiteSlug: character.site_slug || "",
    canSendProduct,
    hasProductApiUrl: Boolean(effectiveProductApiUrl),
    defaultSiteSlug: defaultSite?.slug || "",
  };

  console.log(JSON.stringify(result, null, 2));

  assert.equal(canSendProduct, true, "character must be creator/mascot to send product cards");
  assert.ok(effectiveProductApiUrl, "effective site must have product_api_url configured");
  if (character.category_id === "creator") {
    assert.ok(character.site_id, "creator character must be bound to a site");
  }
} finally {
  await closeDbPool();
}
