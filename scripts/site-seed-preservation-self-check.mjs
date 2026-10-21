import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dbSource = readFileSync("server/db.js", "utf8");
const dbSeedSource = readFileSync("server/db-bootstrap-seeds.js", "utf8");
const schemaSql = readFileSync("database/schema.sql", "utf8");

for (const [label, source] of [
  ["server/db.js", dbSource],
  ["server/db-bootstrap-seeds.js", dbSeedSource],
  ["database/schema.sql", schemaSql],
]) {
  assert.ok(
    !source.includes("WHERE id = 'site_gg' OR is_default = 1"),
    `${label} must not force the default site back to site_gg on every startup`
  );
  assert.ok(
    !/SET\s+is_default\s*=\s*CASE\s+WHEN\s+id\s*=\s*'site_gg'/i.test(source),
    `${label} must not reset existing default-site selections during seed`
  );
}

const seedDefaultSites = extractFunction(dbSeedSource, "seedDefaultSites");
assert.ok(seedDefaultSites, "server/db-bootstrap-seeds.js should define seedDefaultSites()");
assert.ok(
  /ON DUPLICATE KEY UPDATE\s+id\s*=\s*id/i.test(seedDefaultSites),
  "seedDefaultSites() must preserve existing admin-managed site fields"
);
assert.ok(
  /SELECT id FROM sites WHERE is_default = 1 LIMIT 1/.test(seedDefaultSites),
  "seedDefaultSites() should check whether a default site already exists"
);

const schemaSitesSeed = schemaSql.match(/INSERT INTO sites \([\s\S]*?CREATE TABLE IF NOT EXISTS geo_regions/)?.[0] || "";
assert.ok(schemaSitesSeed, "schema.sql should include the default sites seed block");
assert.ok(
  /ON DUPLICATE KEY UPDATE\s+id\s*=\s*id/i.test(schemaSitesSeed),
  "schema.sql default sites seed must preserve existing admin-managed site fields"
);
assert.ok(
  /NOT EXISTS \([\s\S]*SELECT id FROM sites WHERE is_default = 1 LIMIT 1[\s\S]*existing_default_site/.test(schemaSitesSeed),
  "schema.sql should only set the GG default when no default site exists"
);

const protectedSchemaSeeds = [
  {
    label: "schema.sql demo ai_characters seed",
    block: schemaSql.match(/INSERT INTO ai_characters \([\s\S]*?CREATE TABLE IF NOT EXISTS home_carousel_items/)?.[0] || "",
  },
  {
    label: "schema.sql home carousel seed",
    block: schemaSql.match(/INSERT INTO home_carousel_items \([\s\S]*?CREATE TABLE IF NOT EXISTS character_voice_assets/)?.[0] || "",
  },
  {
    label: "schema.sql demo voice asset seed",
    block: schemaSql.match(/INSERT INTO character_voice_assets \([\s\S]*?CREATE TABLE IF NOT EXISTS chat_sessions/)?.[0] || "",
  },
  {
    label: "schema.sql demo chat session seed",
    block: schemaSql.match(/INSERT INTO chat_sessions \([\s\S]*?CREATE TABLE IF NOT EXISTS user_character_activations/)?.[0] || "",
  },
  {
    label: "schema.sql demo chat message seed",
    block: schemaSql.match(/INSERT INTO chat_messages \([\s\S]*?CREATE TABLE IF NOT EXISTS memory_jobs/)?.[0] || "",
  },
  {
    label: "schema.sql quick reply seed",
    block: schemaSql.match(/INSERT INTO chat_quick_replies \([\s\S]*?CREATE TABLE IF NOT EXISTS product_analytics_events/)?.[0] || "",
  },
];

for (const { label, block } of protectedSchemaSeeds) {
  assert.ok(block, `${label} should exist`);
  assertPreserveOnlyDuplicateUpdate(label, block);
}

for (const [label, block] of [
  ["server/db-bootstrap-seeds.js home carousel seed", extractFunction(dbSeedSource, "seedDefaultHomeCarouselItem")],
  ["server/db-bootstrap-seeds.js quick reply seed", extractFunction(dbSeedSource, "seedDefaultChatQuickReplies")],
]) {
  assert.ok(block, `${label} should exist`);
  assertPreserveOnlyDuplicateUpdate(label, block);
}

console.log("site seed preservation self-check passed");

function extractFunction(source, name) {
  const marker = `async function ${name}() {`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("\nexport async function ", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function assertPreserveOnlyDuplicateUpdate(label, block) {
  const duplicateUpdate = block.match(/ON DUPLICATE KEY UPDATE[\s\S]*?(?:;|\n\s*`\);|\n\s*CREATE TABLE|\nasync function)/)?.[0] || "";
  assert.ok(duplicateUpdate, `${label} should have an ON DUPLICATE KEY UPDATE clause`);
  assert.ok(
    /ON DUPLICATE KEY UPDATE\s+id\s*=\s*id/i.test(duplicateUpdate),
    `${label} must preserve existing rows instead of overwriting admin-managed content`
  );
  assert.ok(!/VALUES\s*\(/i.test(duplicateUpdate), `${label} must not overwrite fields from seed VALUES()`);
  assert.ok(!/CURRENT_TIMESTAMP/i.test(duplicateUpdate), `${label} must not touch updated_at for existing rows`);
}
