import { getDbPool } from "./db-core.js";
import { addColumnIfMissing, addIndexIfMissing } from "./db-schema-utils.js";

export async function createSiteProductCacheTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS site_product_cache (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_id VARCHAR(64) NOT NULL,
      site_slug VARCHAR(96) NOT NULL,
      external_product_key VARCHAR(191) NOT NULL,
      product_title VARCHAR(255) NOT NULL,
      product_subtitle VARCHAR(255) NULL,
      product_url VARCHAR(512) NULL,
      image_url VARCHAR(512) NULL,
      image_urls_json JSON NULL,
      price_now VARCHAR(64) NULL,
      price_was VARCHAR(64) NULL,
      stock_text VARCHAR(128) NULL,
      available TINYINT(1) NULL,
      sizes_json JSON NULL,
      features_json JSON NULL,
      product_payload_json JSON NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'site_source',
      source_rank INT NOT NULL DEFAULT 100,
      cached_status VARCHAR(32) NOT NULL DEFAULT 'active',
      last_synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_site_product_cache_external (site_id, external_product_key),
      KEY idx_site_product_cache_site_rank (site_id, cached_status, source_rank, updated_at),
      KEY idx_site_product_cache_slug_rank (site_slug, cached_status, source_rank, updated_at),
      KEY idx_site_product_cache_sync (site_id, last_synced_at),
      CONSTRAINT fk_site_product_cache_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "site_product_cache",
    "idx_site_product_cache_site_rank",
    "CREATE INDEX idx_site_product_cache_site_rank ON site_product_cache(site_id, cached_status, source_rank, updated_at)"
  );
  await addIndexIfMissing(
    "site_product_cache",
    "idx_site_product_cache_slug_rank",
    "CREATE INDEX idx_site_product_cache_slug_rank ON site_product_cache(site_slug, cached_status, source_rank, updated_at)"
  );
  await addIndexIfMissing(
    "site_product_cache",
    "idx_site_product_cache_sync",
    "CREATE INDEX idx_site_product_cache_sync ON site_product_cache(site_id, last_synced_at)"
  );
}

export async function createSiteHomeProductSectionsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS site_home_product_sections (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_id VARCHAR(64) NOT NULL,
      site_slug VARCHAR(96) NOT NULL,
      theme_id VARCHAR(64) NULL,
      theme_name VARCHAR(128) NULL,
      section_key VARCHAR(128) NOT NULL,
      section_type VARCHAR(96) NOT NULL,
      section_title VARCHAR(255) NULL,
      collection_handles_json JSON NULL,
      product_handles_json JSON NULL,
      product_keys_json JSON NULL,
      source_rank INT NOT NULL DEFAULT 100,
      section_status VARCHAR(32) NOT NULL DEFAULT 'active',
      raw_section_json JSON NULL,
      last_synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_home_product_section_site_key (site_id, section_key),
      KEY idx_home_product_sections_site_rank (site_id, section_status, source_rank),
      KEY idx_home_product_sections_slug_rank (site_slug, section_status, source_rank),
      KEY idx_home_product_sections_sync (site_id, last_synced_at),
      CONSTRAINT fk_home_product_sections_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "site_home_product_sections",
    "idx_home_product_sections_site_rank",
    "CREATE INDEX idx_home_product_sections_site_rank ON site_home_product_sections(site_id, section_status, source_rank)"
  );
  await addIndexIfMissing(
    "site_home_product_sections",
    "idx_home_product_sections_slug_rank",
    "CREATE INDEX idx_home_product_sections_slug_rank ON site_home_product_sections(site_slug, section_status, source_rank)"
  );
  await addIndexIfMissing(
    "site_home_product_sections",
    "idx_home_product_sections_sync",
    "CREATE INDEX idx_home_product_sections_sync ON site_home_product_sections(site_id, last_synced_at)"
  );
}

export async function createSiteKitshopSalesCacheTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS site_kitshop_sales_cache (
      site_id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_slug VARCHAR(96) NOT NULL,
      rank_30d_json JSON NULL,
      rank_60d_json JSON NULL,
      shuffle_seed VARCHAR(64) NOT NULL,
      included_order_count INT UNSIGNED NOT NULL DEFAULT 0,
      sync_status VARCHAR(32) NOT NULL DEFAULT 'ready',
      last_attempt_at DATETIME(3) NULL,
      last_synced_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_kitshop_sales_cache_slug_sync (site_slug, last_synced_at),
      CONSTRAINT fk_kitshop_sales_cache_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("site_kitshop_sales_cache", "sync_status", "VARCHAR(32) NOT NULL DEFAULT 'ready' AFTER included_order_count");
  await addColumnIfMissing("site_kitshop_sales_cache", "last_attempt_at", "DATETIME(3) NULL AFTER sync_status");
  const [lastSyncedColumns] = await getDbPool().query(`
    SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_kitshop_sales_cache' AND COLUMN_NAME = 'last_synced_at'
    LIMIT 1
  `);
  if (lastSyncedColumns[0]?.IS_NULLABLE === "NO") {
    await getDbPool().query("ALTER TABLE site_kitshop_sales_cache MODIFY COLUMN last_synced_at DATETIME(3) NULL");
  }
  await getDbPool().query("UPDATE site_kitshop_sales_cache SET last_attempt_at = COALESCE(last_attempt_at, last_synced_at) WHERE last_attempt_at IS NULL");
  await addIndexIfMissing(
    "site_kitshop_sales_cache",
    "idx_kitshop_sales_cache_slug_sync",
    "CREATE INDEX idx_kitshop_sales_cache_slug_sync ON site_kitshop_sales_cache(site_slug, last_synced_at)"
  );
}

export async function createTtmallCartSessionsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS ttmall_cart_sessions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      source_cache_key VARCHAR(191) NOT NULL,
      cart_hash VARCHAR(255) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_ttmall_cart_sessions_owner (user_id, site_id, source_cache_key),
      KEY idx_ttmall_cart_sessions_site_updated (site_id, updated_at),
      CONSTRAINT fk_ttmall_cart_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ttmall_cart_sessions_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "ttmall_cart_sessions",
    "idx_ttmall_cart_sessions_site_updated",
    "CREATE INDEX idx_ttmall_cart_sessions_site_updated ON ttmall_cart_sessions(site_id, updated_at)"
  );
}

export async function createTtmallAccountBindingsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS ttmall_account_bindings (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      source_cache_key VARCHAR(191) NOT NULL,
      ttmall_user_id VARCHAR(191) NOT NULL,
      ttmall_email VARCHAR(254) NOT NULL,
      access_token_encrypted TEXT NULL,
      token_status VARCHAR(16) NOT NULL DEFAULT 'active',
      provider_code VARCHAR(64) NULL,
      access_token_expires_at DATETIME(3) NULL,
      last_checked_at DATETIME(3) NULL,
      last_error_code VARCHAR(64) NULL,
      verified_at DATETIME(3) NULL,
      stale_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_ttmall_account_binding_owner (user_id, site_id),
      UNIQUE KEY uniq_ttmall_account_binding_external (site_id, ttmall_user_id),
      KEY idx_ttmall_account_binding_status (site_id, token_status, updated_at),
      CONSTRAINT fk_ttmall_account_binding_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ttmall_account_binding_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "ttmall_account_bindings",
    "idx_ttmall_account_binding_status",
    "CREATE INDEX idx_ttmall_account_binding_status ON ttmall_account_bindings(site_id, token_status, updated_at)"
  );
  await addColumnIfMissing("ttmall_account_bindings", "access_token_expires_at", "DATETIME(3) NULL AFTER provider_code");
  await addColumnIfMissing("ttmall_account_bindings", "last_checked_at", "DATETIME(3) NULL AFTER access_token_expires_at");
  await addColumnIfMissing("ttmall_account_bindings", "last_error_code", "VARCHAR(64) NULL AFTER last_checked_at");
}

export async function createTtmallBindingCandidatesTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS ttmall_binding_candidates (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      source_cache_key VARCHAR(191) NOT NULL,
      email VARCHAR(254) NOT NULL,
      candidate_status VARCHAR(16) NOT NULL DEFAULT 'pending_auth',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_ttmall_binding_candidate_owner (user_id, site_id),
      KEY idx_ttmall_binding_candidates_site_status (site_id, candidate_status, updated_at),
      CONSTRAINT fk_ttmall_binding_candidates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ttmall_binding_candidates_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "ttmall_binding_candidates",
    "idx_ttmall_binding_candidates_site_status",
    "CREATE INDEX idx_ttmall_binding_candidates_site_status ON ttmall_binding_candidates(site_id, candidate_status, updated_at)"
  );
}

// A checkout attempt is separate from the cart hash. The same user can change
// their cart after an order has been created, so the provider order state must
// never be inferred from the mutable cart session.
export async function createTtmallCheckoutAttemptsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS ttmall_checkout_attempts (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      source_cache_key VARCHAR(191) NOT NULL,
      cart_snapshot_hash VARCHAR(128) NOT NULL,
      attempt_status VARCHAR(32) NOT NULL DEFAULT 'creating',
      order_number_encrypted TEXT NULL,
      next_cart_hash_encrypted TEXT NULL,
      payment_type TINYINT NULL,
      safe_error_code VARCHAR(64) NULL,
      upstream_http_status SMALLINT UNSIGNED NULL,
      upstream_outcome VARCHAR(32) NULL,
      upstream_business_code VARCHAR(64) NULL,
      upstream_response_shape VARCHAR(500) NULL,
      upstream_safe_message VARCHAR(500) NULL,
      active_snapshot_key CHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_ttmall_checkout_attempts_owner (user_id, site_id, updated_at),
      KEY idx_ttmall_checkout_attempts_status (site_id, attempt_status, updated_at),
      UNIQUE KEY uniq_ttmall_checkout_attempt_active_snapshot (active_snapshot_key),
      CONSTRAINT fk_ttmall_checkout_attempts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ttmall_checkout_attempts_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "ttmall_checkout_attempts",
    "idx_ttmall_checkout_attempts_owner",
    "CREATE INDEX idx_ttmall_checkout_attempts_owner ON ttmall_checkout_attempts(user_id, site_id, updated_at)",
  );
  await addColumnIfMissing("ttmall_checkout_attempts", "upstream_http_status", "SMALLINT UNSIGNED NULL AFTER safe_error_code");
  await addColumnIfMissing("ttmall_checkout_attempts", "upstream_outcome", "VARCHAR(32) NULL AFTER upstream_http_status");
  await addColumnIfMissing("ttmall_checkout_attempts", "upstream_business_code", "VARCHAR(64) NULL AFTER upstream_outcome");
  await addColumnIfMissing("ttmall_checkout_attempts", "upstream_response_shape", "VARCHAR(500) NULL AFTER upstream_business_code");
  await addColumnIfMissing("ttmall_checkout_attempts", "upstream_safe_message", "VARCHAR(500) NULL AFTER upstream_response_shape");
  await addColumnIfMissing("ttmall_checkout_attempts", "active_snapshot_key", "CHAR(64) NULL AFTER safe_error_code");
  await addIndexIfMissing(
    "ttmall_checkout_attempts",
    "uniq_ttmall_checkout_attempt_active_snapshot",
    "CREATE UNIQUE INDEX uniq_ttmall_checkout_attempt_active_snapshot ON ttmall_checkout_attempts(active_snapshot_key)",
  );
}

export async function createShopifyCustomerBindingsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS shopify_customer_bindings (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      shopify_customer_id VARCHAR(191) NOT NULL,
      binding_status VARCHAR(16) NOT NULL DEFAULT 'active',
      verified_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_shopify_customer_binding_owner (user_id, site_id),
      UNIQUE KEY uniq_shopify_customer_binding_external (site_id, shopify_customer_id),
      CONSTRAINT fk_shopify_customer_binding_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_shopify_customer_binding_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createShopifyCustomerSyncAuditsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS shopify_customer_sync_audits (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operation_id VARCHAR(64) NOT NULL,
      event_sequence INT UNSIGNED NOT NULL DEFAULT 1,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      binding_id VARCHAR(64) NULL,
      event_type VARCHAR(32) NOT NULL,
      lookup_result VARCHAR(16) NULL,
      shopify_customer_id VARCHAR(191) NULL,
      failure_code VARCHAR(64) NULL,
      api_version VARCHAR(16) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_shopify_customer_sync_audits_owner_time (user_id, site_id, created_at),
      KEY idx_shopify_customer_sync_audits_operation (operation_id, created_at),
      KEY idx_shopify_customer_sync_audits_operation_sequence (operation_id, event_sequence),
      CONSTRAINT fk_shopify_customer_sync_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_shopify_customer_sync_audit_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
      CONSTRAINT fk_shopify_customer_sync_audit_binding FOREIGN KEY (binding_id) REFERENCES shopify_customer_bindings(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing(
    "shopify_customer_sync_audits",
    "event_sequence",
    "INT UNSIGNED NOT NULL DEFAULT 1 AFTER operation_id"
  );
  await addIndexIfMissing(
    "shopify_customer_sync_audits",
    "idx_shopify_customer_sync_audits_owner_time",
    "CREATE INDEX idx_shopify_customer_sync_audits_owner_time ON shopify_customer_sync_audits(user_id, site_id, created_at)"
  );
  await addIndexIfMissing(
    "shopify_customer_sync_audits",
    "idx_shopify_customer_sync_audits_operation",
    "CREATE INDEX idx_shopify_customer_sync_audits_operation ON shopify_customer_sync_audits(operation_id, created_at)"
  );
  await addIndexIfMissing(
    "shopify_customer_sync_audits",
    "idx_shopify_customer_sync_audits_operation_sequence",
    "CREATE INDEX idx_shopify_customer_sync_audits_operation_sequence ON shopify_customer_sync_audits(operation_id, event_sequence)"
  );
}

export async function createShopifyCartSessionsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS shopify_cart_sessions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      source_cache_key VARCHAR(191) NOT NULL,
      cart_id_encrypted TEXT NOT NULL,
      discount_context_json JSON NULL,
      draft_order_attempt_id VARCHAR(64) NULL,
      draft_order_snapshot_hash CHAR(64) NULL,
      draft_order_id VARCHAR(191) NULL,
      cart_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_shopify_cart_session_owner (user_id, site_id, source_cache_key),
      CONSTRAINT fk_shopify_cart_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_shopify_cart_session_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("shopify_cart_sessions", "discount_context_json", "JSON NULL AFTER cart_id_encrypted");
  await addColumnIfMissing("shopify_cart_sessions", "draft_order_attempt_id", "VARCHAR(64) NULL AFTER discount_context_json");
  await addColumnIfMissing("shopify_cart_sessions", "draft_order_snapshot_hash", "CHAR(64) NULL AFTER draft_order_attempt_id");
  await addColumnIfMissing("shopify_cart_sessions", "draft_order_id", "VARCHAR(191) NULL AFTER draft_order_snapshot_hash");
  await addColumnIfMissing("shopify_cart_sessions", "cart_revision", "BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER draft_order_id");
}

export async function createShopifyDraftOrderAttemptsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS shopify_draft_order_attempts (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      source_cache_key VARCHAR(191) NOT NULL,
      shopify_draft_order_id VARCHAR(191) NULL,
      shopify_order_id VARCHAR(191) NULL,
      cart_id_hash CHAR(64) NOT NULL,
      cart_revision BIGINT UNSIGNED NOT NULL,
      snapshot_hash CHAR(64) NOT NULL,
      discount_snapshot_json JSON NULL,
      attempt_status VARCHAR(32) NOT NULL DEFAULT 'creating',
      cart_clear_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      last_checked_at DATETIME(3) NULL,
      detected_at DATETIME(3) NULL,
      reconciled_at DATETIME(3) NULL,
      safe_error_code VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_shopify_draft_attempt_draft (site_id, shopify_draft_order_id),
      UNIQUE KEY uniq_shopify_draft_attempt_order (site_id, shopify_order_id),
      KEY idx_shopify_draft_attempt_owner_status (user_id, site_id, attempt_status, updated_at),
      CONSTRAINT fk_shopify_draft_attempt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_shopify_draft_attempt_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("shopify_draft_order_attempts", "discount_snapshot_json", "JSON NULL AFTER snapshot_hash");
  await addIndexIfMissing(
    "shopify_draft_order_attempts",
    "idx_shopify_draft_attempt_owner_status",
    "CREATE INDEX idx_shopify_draft_attempt_owner_status ON shopify_draft_order_attempts(user_id, site_id, attempt_status, updated_at)"
  );
}

export async function createDiscountCodeTablesIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS discount_codes (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_id VARCHAR(64) NOT NULL,
      code VARCHAR(64) NOT NULL,
      ownership_type VARCHAR(32) NOT NULL DEFAULT 'site',
      creator_uid VARCHAR(64) NULL,
      offer_description VARCHAR(255) NOT NULL,
      validity_mode VARCHAR(32) NOT NULL DEFAULT 'indefinite',
      starts_at DATETIME(3) NULL,
      ends_at DATETIME(3) NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      notes TEXT NULL,
      shopify_discount_id VARCHAR(255) NULL,
      shopify_discount_type VARCHAR(32) NULL,
      shopify_status VARCHAR(32) NULL,
      shopify_rule_json JSON NULL,
      shopify_synced_at DATETIME(3) NULL,
      created_by_uid VARCHAR(64) NULL,
      updated_by_uid VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_discount_codes_site_code (site_id, code),
      KEY idx_discount_codes_site_owner (site_id, ownership_type, creator_uid),
      KEY idx_discount_codes_status_time (is_enabled, starts_at, ends_at),
      KEY idx_discount_codes_shopify_id (shopify_discount_id),
      CONSTRAINT fk_discount_codes_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
      CONSTRAINT fk_discount_codes_creator FOREIGN KEY (creator_uid) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_discount_codes_created_by FOREIGN KEY (created_by_uid) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_discount_codes_updated_by FOREIGN KEY (updated_by_uid) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("discount_codes", "shopify_discount_id", "VARCHAR(255) NULL AFTER notes");
  await addColumnIfMissing("discount_codes", "shopify_discount_type", "VARCHAR(32) NULL AFTER shopify_discount_id");
  await addColumnIfMissing("discount_codes", "shopify_status", "VARCHAR(32) NULL AFTER shopify_discount_type");
  await addColumnIfMissing("discount_codes", "shopify_rule_json", "JSON NULL AFTER shopify_status");
  await addColumnIfMissing("discount_codes", "shopify_synced_at", "DATETIME(3) NULL AFTER shopify_rule_json");
  await addIndexIfMissing(
    "discount_codes",
    "idx_discount_codes_shopify_id",
    "CREATE INDEX idx_discount_codes_shopify_id ON discount_codes(shopify_discount_id)"
  );
}

export async function createPromotionCampaignTablesIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS promotion_campaigns (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_id VARCHAR(64) NOT NULL,
      title VARCHAR(128) NOT NULL,
      role_target VARCHAR(32) NOT NULL DEFAULT 'all',
      product_id VARCHAR(128) NULL,
      product_title VARCHAR(255) NOT NULL,
      product_url VARCHAR(512) NULL,
      product_snapshot_json JSON NULL,
      discount_code VARCHAR(64) NULL,
      message_text TEXT NOT NULL,
      keywords_json JSON NULL,
      priority INT NOT NULL DEFAULT 100,
      campaign_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      starts_at DATETIME(3) NULL,
      ends_at DATETIME(3) NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'admin',
      source_ref VARCHAR(128) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_promotion_campaigns_site_status_time (site_id, campaign_status, starts_at, ends_at),
      KEY idx_promotion_campaigns_priority (priority, ends_at, created_at),
      CONSTRAINT fk_promotion_campaigns_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("promotion_campaigns", "discount_code", "VARCHAR(64) NULL AFTER product_url");
  await addColumnIfMissing("promotion_campaigns", "product_snapshot_json", "JSON NULL AFTER product_url");
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS promotion_campaign_deliveries (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      campaign_id VARCHAR(64) NOT NULL,
      internal_uid VARCHAR(64) NOT NULL,
      character_id VARCHAR(64) NULL,
      session_id VARCHAR(64) NULL,
      message_id VARCHAR(64) NULL,
      site_id VARCHAR(64) NOT NULL,
      delivery_status VARCHAR(32) NOT NULL DEFAULT 'reserved',
      match_score INT NOT NULL DEFAULT 0,
      match_reason VARCHAR(255) NULL,
      sent_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_promotion_campaign_user (campaign_id, internal_uid),
      KEY idx_promotion_deliveries_user_created (internal_uid, created_at),
      KEY idx_promotion_deliveries_site_created (site_id, created_at),
      KEY idx_promotion_deliveries_message (message_id),
      CONSTRAINT fk_promotion_deliveries_campaign FOREIGN KEY (campaign_id) REFERENCES promotion_campaigns(id) ON DELETE CASCADE,
      CONSTRAINT fk_promotion_deliveries_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createProductAnalyticsEventsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS product_analytics_events (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      event_type VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NULL,
      site_slug VARCHAR(96) NULL,
      character_id VARCHAR(64) NULL,
      character_name VARCHAR(128) NULL,
      owner_user_id VARCHAR(64) NULL,
      user_id VARCHAR(64) NULL,
      session_id VARCHAR(64) NULL,
      message_id VARCHAR(64) NULL,
      product_id VARCHAR(128) NULL,
      product_title VARCHAR(255) NULL,
      product_url VARCHAR(512) NULL,
      source VARCHAR(64) NULL,
      metadata_json JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_product_analytics_type_created (event_type, created_at),
      KEY idx_product_analytics_site_created (site_id, created_at),
      KEY idx_product_analytics_site_slug_created (site_slug, created_at),
      KEY idx_product_analytics_character_created (character_id, created_at),
      KEY idx_product_analytics_owner_created (owner_user_id, created_at),
      KEY idx_product_analytics_product_created (product_id, created_at),
      KEY idx_product_analytics_message_type (message_id, event_type),
      KEY idx_product_analytics_event_user_message (event_type, user_id, message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "product_analytics_events",
    "idx_product_analytics_event_user_message",
    "CREATE INDEX idx_product_analytics_event_user_message ON product_analytics_events(event_type, user_id, message_id)"
  );
}
