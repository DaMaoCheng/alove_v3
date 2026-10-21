import { getDbPool } from "./db-core.js";

export async function createUserCharacterActivationsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS user_character_activations (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      internal_uid VARCHAR(64) NULL,
      guest_session_id VARCHAR(64) NULL,
      character_id VARCHAR(64) NOT NULL,
      activation_status VARCHAR(32) NOT NULL DEFAULT 'active',
      source_type VARCHAR(32) NOT NULL DEFAULT 'user',
      source_ref VARCHAR(128) NULL,
      preferred_language_code VARCHAR(32) NULL,
      preferred_language_label VARCHAR(128) NULL,
      activated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_user_character_activation (internal_uid, character_id),
      KEY idx_user_character_activations_user_updated (internal_uid, updated_at),
      KEY idx_user_character_activations_character (character_id, activation_status),
      CONSTRAINT fk_user_character_activations_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_user_character_activations_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createSitesTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS sites (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      slug VARCHAR(96) NOT NULL,
      site_url VARCHAR(512) NULL,
      site_logo_url VARCHAR(512) NULL,
      default_language VARCHAR(64) NOT NULL DEFAULT 'English',
      currency VARCHAR(16) NOT NULL DEFAULT 'USD',
      time_zone VARCHAR(64) NULL,
      site_status VARCHAR(32) NOT NULL DEFAULT 'active',
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      mascot_character_id VARCHAR(64) NULL,
      product_api_url VARCHAR(512) NULL,
      product_source_type VARCHAR(32) NULL,
      product_shop_domain VARCHAR(255) NULL,
      product_api_version VARCHAR(32) NULL,
      product_access_token_encrypted TEXT NULL,
      shopify_login_enabled TINYINT(1) NOT NULL DEFAULT 1,
      payment_methods_json JSON NULL,
      commerce_enabled TINYINT(1) NOT NULL DEFAULT 1,
      guest_chat_enabled TINYINT(1) NOT NULL DEFAULT 0,
      description VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_sites_slug (slug),
      KEY idx_sites_status_default (site_status, is_default)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createGeoRegionTablesIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS geo_regions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      parent_id VARCHAR(64) NULL,
      level VARCHAR(32) NOT NULL,
      code VARCHAR(32) NOT NULL,
      name_zh VARCHAR(128) NOT NULL,
      name_en VARCHAR(128) NOT NULL,
      aliases_json JSON NULL,
      display_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_geo_regions_code (code),
      KEY idx_geo_regions_parent_order (parent_id, display_order),
      KEY idx_geo_regions_level_active (level, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS site_geo_regions (
      site_id VARCHAR(64) NOT NULL,
      region_id VARCHAR(64) NOT NULL,
      priority INT NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (site_id, region_id),
      UNIQUE KEY uniq_site_geo_region_region (region_id),
      KEY idx_site_geo_regions_site (site_id, priority),
      CONSTRAINT fk_site_geo_regions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
      CONSTRAINT fk_site_geo_regions_region FOREIGN KEY (region_id) REFERENCES geo_regions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
