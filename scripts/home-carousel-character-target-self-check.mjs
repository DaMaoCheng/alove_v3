import assert from "node:assert/strict";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { listPublishedHomeCarouselItems } from "../server/home-carousel-service.js";

const SITE_ID = "site_fkk";
const SITE_SLUG = "footballkituk";
const SITE_MASCOT_ID = "test_carousel_site_mascot";
const BANNER_ID = "test_carousel_template_mascot_target";
const SOURCE_REF = "carousel-character-target-self-check";

await initializeDatabase();
const db = getDbPool();
let siteSnapshot = null;

try {
  siteSnapshot = await snapshotSite();
  await cleanup();
  await seedMascot();
  await disableActiveMascotSettings();
  await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [SITE_MASCOT_ID, SITE_ID]);
  await seedCarousel();

  const result = await listPublishedHomeCarouselItems({ siteSlug: SITE_SLUG });
  const item = result.items.find((entry) => entry.id === BANNER_ID);
  assert.ok(item, "published carousel should include the temporary site banner");
  assert.equal(item.ctaType, "character", "temporary banner should be a character CTA");
  assert.equal(item.ctaTarget, SITE_MASCOT_ID, "template mascot CTA should resolve to the current site mascot");

  await cleanup();
  console.log("home carousel character target self-check passed");
} finally {
  if (siteSnapshot) await restoreSite(siteSnapshot).catch(() => {});
  await cleanup().catch(() => {});
  await closeDbPool();
}

async function seedMascot() {
  await db.execute(
    `INSERT INTO ai_characters (
       id, category_id, owner_uid, site_id, slug, name, role_title, short_bio,
       avatar_url, opening_line, persona_prompt, speaking_style, tags_json,
       profile_json, metrics_json, visibility, character_status, source_type,
       source_ref, published_at
     ) VALUES (?, 'mascot', NULL, ?, 'test-carousel-site-mascot', 'Carousel Site Mascot',
       'Site Frontdesk', 'Temporary mascot for carousel target checks.',
       '/assets/mascot_kit.png', 'Hello from the carousel target check.',
       'Temporary persona.', 'Direct and concise.', JSON_ARRAY('carousel-test'),
       JSON_OBJECT('language', 'English'), JSON_OBJECT(), 'public', 'published',
       'system', ?, NOW(3))`,
    [SITE_MASCOT_ID, SITE_ID, SOURCE_REF]
  );
}

async function seedCarousel() {
  await db.execute(
    `INSERT INTO home_carousel_items (
       id, title, subtitle, eyebrow, image_url, site_id, cta_text, cta_type, cta_target,
       display_order, item_status, source_type, source_ref
     ) VALUES (?, 'Carousel Target Check', 'Temporary carousel target check.', 'Self-check',
       'assets/banner_hero.png', ?, 'Chat', 'character', 'mascot_template',
       1, 'published', 'system', ?)`,
    [BANNER_ID, SITE_ID, SOURCE_REF]
  );
}

async function snapshotSite() {
  const [[site]] = await db.execute("SELECT id, mascot_character_id FROM sites WHERE id = ? LIMIT 1", [SITE_ID]);
  const [settings] = await db.execute("SELECT id, setting_status FROM mascot_settings WHERE site_id = ?", [SITE_ID]);
  return {
    mascotCharacterId: site?.mascot_character_id || "mascot_template",
    settings: settings.map((row) => ({ id: row.id, status: row.setting_status || "active" })),
  };
}

async function restoreSite(snapshot) {
  await db.execute("UPDATE sites SET mascot_character_id = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [snapshot.mascotCharacterId, SITE_ID]);
  for (const setting of snapshot.settings || []) {
    await db.execute("UPDATE mascot_settings SET setting_status = ?, updated_at = NOW(3) WHERE id = ? LIMIT 1", [setting.status, setting.id]);
  }
}

async function disableActiveMascotSettings() {
  await db.execute("UPDATE mascot_settings SET setting_status = 'disabled', updated_at = NOW(3) WHERE site_id = ? AND setting_status = 'active'", [SITE_ID]);
}

async function cleanup() {
  await db.execute("DELETE FROM home_carousel_items WHERE id = ? OR source_ref = ?", [BANNER_ID, SOURCE_REF]);
  await db.execute("DELETE FROM mascot_settings WHERE character_id = ?", [SITE_MASCOT_ID]).catch(() => {});
  await db.execute("DELETE FROM ai_characters WHERE id = ? OR source_ref = ?", [SITE_MASCOT_ID, SOURCE_REF]);
}
