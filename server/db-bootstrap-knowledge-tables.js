import { getDbPool } from "./db-core.js";

export async function createKnowledgeBaseTablesIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      label VARCHAR(128) NOT NULL,
      summary TEXT NULL,
      category VARCHAR(64) NOT NULL DEFAULT 'general',
      scope VARCHAR(32) NOT NULL DEFAULT 'global',
      site_id VARCHAR(64) NULL,
      knowledge_status VARCHAR(32) NOT NULL DEFAULT 'active',
      language VARCHAR(64) NULL,
      priority INT NOT NULL DEFAULT 50,
      max_sections INT UNSIGNED NOT NULL DEFAULT 6,
      max_chars_per_section INT UNSIGNED NOT NULL DEFAULT 1200,
      keywords_json JSON NULL,
      fuzzy_keywords_json JSON NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
      source_ref VARCHAR(512) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_knowledge_bases_status_category (knowledge_status, category),
      KEY idx_knowledge_bases_scope_site (scope, site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS knowledge_sections (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      knowledge_base_id VARCHAR(64) NOT NULL,
      section_key VARCHAR(128) NOT NULL,
      title VARCHAR(255) NOT NULL,
      summary TEXT NULL,
      content MEDIUMTEXT NOT NULL,
      keywords_json JSON NULL,
      fuzzy_keywords_json JSON NULL,
      display_order INT NOT NULL DEFAULT 100,
      section_status VARCHAR(32) NOT NULL DEFAULT 'active',
      source_heading VARCHAR(255) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_knowledge_section_key (knowledge_base_id, section_key),
      KEY idx_knowledge_sections_base_order (knowledge_base_id, display_order),
      KEY idx_knowledge_sections_status (section_status),
      CONSTRAINT fk_knowledge_sections_base FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createKnowledgeBaseBindingsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS knowledge_base_bindings (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      knowledge_base_id VARCHAR(64) NOT NULL,
      target_type VARCHAR(32) NOT NULL,
      target_id VARCHAR(64) NOT NULL,
      binding_status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_knowledge_binding_target (knowledge_base_id, target_type, target_id),
      KEY idx_knowledge_bindings_base_status (knowledge_base_id, binding_status),
      KEY idx_knowledge_bindings_target (target_type, target_id, binding_status),
      CONSTRAINT fk_knowledge_bindings_base FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

