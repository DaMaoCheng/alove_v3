import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const createDatabaseSql = readFileSync("database/create-database.sql", "utf8");
const schemaSql = readFileSync("database/schema.sql", "utf8");

assert.ok(createDatabaseSql.includes("CREATE DATABASE IF NOT EXISTS aiove_app"), "create-database.sql should create aiove_app database");
assert.ok(createDatabaseSql.includes("CREATE USER IF NOT EXISTS 'aiove_app'@'localhost'"), "create-database.sql should create localhost app user");
assert.ok(createDatabaseSql.includes("CREATE USER IF NOT EXISTS 'aiove_app'@'127.0.0.1'"), "create-database.sql should create 127.0.0.1 app user");
assert.ok(createDatabaseSql.includes("replace_with_strong_production_password"), "create-database.sql should keep a password placeholder");
assert.equal((createDatabaseSql.match(/replace_with_strong_production_password/g) || []).length, 2, "create-database.sql should use the placeholder for both app users");
assert.ok(!/IDENTIFIED\s+BY\s+(['"])(?!replace_with_strong_production_password\1).+?\1/i.test(createDatabaseSql), "create-database.sql should not contain a filled database password");

const requiredTables = [
  "users",
  "sites",
  "geo_regions",
  "site_geo_regions",
  "character_categories",
  "ai_characters",
  "user_character_activations",
  "chat_sessions",
  "chat_messages",
  "knowledge_bases",
  "knowledge_sections",
  "knowledge_base_bindings",
  "mascot_settings",
  "mascot_ad_deliveries",
  "app_error_logs",
  "user_feedback",
  "admin_operation_logs",
];

for (const tableName of requiredTables) {
  assert.ok(hasCreateTable(tableName), `schema.sql should create ${tableName}`);
  const block = extractCreateTableBlock(tableName);
  assert.ok(block, `schema.sql should have a complete CREATE TABLE block for ${tableName}`);
  assert.ok(!/\n\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i.test(block.slice(1)), `schema.sql should not nest another CREATE TABLE inside ${tableName}`);
}

const feedbackTable = extractCreateTableBlock("user_feedback");
assert.match(feedbackTable, /internal_uid\s+VARCHAR\(64\)\s+NULL/i, "fresh schema must allow guest feedback without an internal user id");

for (const requiredSnippet of [
  "('site_gg', 'GG', 'gogoalshop'",
  "('site_fkk', 'FKK', 'footballkituk'",
  "SELECT id FROM sites WHERE is_default = 1 LIMIT 1",
  "UNIQUE KEY uniq_sites_slug (slug)",
  "shopify_login_enabled TINYINT(1) NOT NULL DEFAULT 1",
  "KEY idx_users_site (site_id)",
  "KEY idx_ai_characters_site (site_id, character_status, visibility)",
  "UNIQUE KEY uniq_user_character_activation (internal_uid, character_id)",
  "UNIQUE KEY uniq_ai_characters_active_creator_owner (owner_uid, active_creator_marker)",
  "preferred_language_code VARCHAR(32) NULL",
  "preferred_language_label VARCHAR(128) NULL",
  "message_id VARCHAR(64) NULL",
  "audio_bytes INT UNSIGNED NOT NULL DEFAULT 0",
  "character_count INT UNSIGNED NOT NULL DEFAULT 0",
  "UNIQUE KEY uniq_site_geo_region_region (region_id)",
  "UNIQUE KEY uniq_knowledge_binding_target (knowledge_base_id, target_type, target_id)",
  "UNIQUE KEY uniq_mascot_settings_site (site_id)",
  "KEY idx_mascot_ad_site_status (site_id, delivery_status, created_at)",
  "KEY idx_user_feedback_status_created (feedback_status, created_at)",
  "CONSTRAINT fk_site_geo_regions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE",
  "CONSTRAINT fk_knowledge_sections_base FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE",
  "CONSTRAINT fk_knowledge_bindings_base FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE",
]) {
  assert.ok(schemaSql.includes(requiredSnippet), `schema.sql should include: ${requiredSnippet}`);
}

console.log("database deployment self-check passed");

function hasCreateTable(tableName) {
  const pattern = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\s*\\(`, "i");
  return pattern.test(schemaSql);
}

function extractCreateTableBlock(tableName) {
  const pattern = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\s*\\([\\s\\S]*?\\)\\s+ENGINE=InnoDB\\s+DEFAULT\\s+CHARSET=utf8mb4\\s+COLLATE=utf8mb4_unicode_ci;`, "i");
  return schemaSql.match(pattern)?.[0] || "";
}
