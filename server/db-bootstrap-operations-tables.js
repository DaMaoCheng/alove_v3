import { getDbPool } from "./db-core.js";
import { addColumnIfMissing, addIndexIfMissing } from "./db-schema-utils.js";

export async function createAiReplyLogsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS ai_reply_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      request_id VARCHAR(64) NOT NULL,
      internal_uid VARCHAR(64) NULL,
      session_id VARCHAR(64) NULL,
      character_id VARCHAR(64) NULL,
      provider VARCHAR(32) NOT NULL DEFAULT 'openai',
      model VARCHAR(96) NULL,
      base_url VARCHAR(255) NULL,
      status VARCHAR(32) NOT NULL,
      source_type VARCHAR(32) NULL,
      source_ref VARCHAR(128) NULL,
      degraded TINYINT(1) NOT NULL DEFAULT 0,
      degradation_reason VARCHAR(128) NULL,
      duration_ms INT UNSIGNED NULL,
      prompt_layer_count INT UNSIGNED NOT NULL DEFAULT 0,
      prompt_message_count INT UNSIGNED NOT NULL DEFAULT 0,
      system_prompt_chars INT UNSIGNED NOT NULL DEFAULT 0,
      input_chars INT UNSIGNED NOT NULL DEFAULT 0,
      output_chars INT UNSIGNED NOT NULL DEFAULT 0,
      error_message VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_ai_reply_logs_created (created_at),
      KEY idx_ai_reply_logs_status_created (status, created_at),
      KEY idx_ai_reply_logs_user_created (internal_uid, created_at),
      KEY idx_ai_reply_logs_character_created (character_id, created_at),
      KEY idx_ai_reply_logs_request (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createAppErrorLogsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS app_error_logs (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      source VARCHAR(32) NOT NULL DEFAULT 'server',
      level VARCHAR(32) NOT NULL DEFAULT 'error',
      error_type VARCHAR(96) NOT NULL DEFAULT 'app_error',
      action VARCHAR(128) NULL,
      status_code INT NULL,
      safe_message VARCHAR(500) NULL,
      raw_message VARCHAR(500) NULL,
      stack_trace TEXT NULL,
      page VARCHAR(255) NULL,
      endpoint VARCHAR(255) NULL,
      request_method VARCHAR(16) NULL,
      request_id VARCHAR(128) NULL,
      user_agent VARCHAR(500) NULL,
      client_ip VARCHAR(64) NULL,
      internal_uid VARCHAR(64) NULL,
      context_json JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_app_error_logs_created (created_at),
      KEY idx_app_error_logs_level_created (level, created_at),
      KEY idx_app_error_logs_type_created (error_type, created_at),
      KEY idx_app_error_logs_source_created (source, created_at),
      KEY idx_app_error_logs_user_created (internal_uid, created_at),
      KEY idx_app_error_logs_request (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createAdminOperationLogsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS admin_operation_logs (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      admin_user_id VARCHAR(64) NULL,
      admin_email VARCHAR(255) NULL,
      admin_name VARCHAR(128) NULL,
      action VARCHAR(96) NOT NULL,
      target_type VARCHAR(64) NOT NULL,
      target_id VARCHAR(128) NULL,
      target_label VARCHAR(255) NULL,
      summary VARCHAR(500) NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      request_method VARCHAR(16) NULL,
      endpoint VARCHAR(255) NULL,
      request_id VARCHAR(128) NULL,
      user_agent VARCHAR(500) NULL,
      client_ip VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_admin_operation_logs_created (created_at),
      KEY idx_admin_operation_logs_admin_created (admin_user_id, created_at),
      KEY idx_admin_operation_logs_action_created (action, created_at),
      KEY idx_admin_operation_logs_target_created (target_type, target_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createUserFeedbackTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS user_feedback (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      internal_uid VARCHAR(64) NULL,
      guest_session_id VARCHAR(64) NULL,
      user_email VARCHAR(255) NULL,
      account_type VARCHAR(32) NULL,
      site_id VARCHAR(64) NULL,
      site_slug VARCHAR(96) NULL,
      client_ip VARCHAR(64) NULL,
      client_ip_region VARCHAR(96) NULL,
      subject VARCHAR(120) NOT NULL,
      content TEXT NOT NULL,
      page_path VARCHAR(512) NULL,
      user_agent VARCHAR(500) NULL,
      feedback_status VARCHAR(32) NOT NULL DEFAULT 'new',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_user_feedback_created (created_at),
      KEY idx_user_feedback_status_created (feedback_status, created_at),
      KEY idx_user_feedback_user_created (internal_uid, created_at),
      KEY idx_user_feedback_guest_created (guest_session_id, created_at),
      KEY idx_user_feedback_site_created (site_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("user_feedback", "guest_session_id", "VARCHAR(64) NULL AFTER internal_uid");
  await addIndexIfMissing(
    "user_feedback",
    "idx_user_feedback_status_created",
    "CREATE INDEX idx_user_feedback_status_created ON user_feedback(feedback_status, created_at)"
  );
  await addIndexIfMissing(
    "user_feedback",
    "idx_user_feedback_user_created",
    "CREATE INDEX idx_user_feedback_user_created ON user_feedback(internal_uid, created_at)"
  );
  await addIndexIfMissing(
    "user_feedback",
    "idx_user_feedback_guest_created",
    "CREATE INDEX idx_user_feedback_guest_created ON user_feedback(guest_session_id, created_at)"
  );
  await addIndexIfMissing(
    "user_feedback",
    "idx_user_feedback_site_created",
    "CREATE INDEX idx_user_feedback_site_created ON user_feedback(site_id, created_at)"
  );
  await addColumnIfMissing("user_feedback", "client_ip", "VARCHAR(64) NULL AFTER site_slug");
  await addColumnIfMissing("user_feedback", "client_ip_region", "VARCHAR(96) NULL AFTER client_ip");
  await getDbPool().query("ALTER TABLE user_feedback MODIFY COLUMN internal_uid VARCHAR(64) NULL");
}

export async function createHomeCarouselItemsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS home_carousel_items (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      title VARCHAR(128) NOT NULL,
      subtitle VARCHAR(500) NULL,
      eyebrow VARCHAR(64) NULL,
      image_url VARCHAR(512) NOT NULL,
      site_id VARCHAR(64) NULL,
      cta_text VARCHAR(64) NULL,
      cta_type VARCHAR(32) NOT NULL DEFAULT 'none',
      cta_target VARCHAR(512) NULL,
      display_order INT NOT NULL DEFAULT 100,
      item_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      starts_at DATETIME(3) NULL,
      ends_at DATETIME(3) NULL,
      source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
      source_ref VARCHAR(128) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_home_carousel_site_status_order (site_id, item_status, display_order, starts_at, ends_at),
      KEY idx_home_carousel_status_order (item_status, display_order, starts_at, ends_at),
      KEY idx_home_carousel_source (source_type, source_ref)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createMascotAdDeliveriesTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS mascot_ad_deliveries (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_id VARCHAR(64) NOT NULL,
      mascot_character_id VARCHAR(64) NULL,
      campaign_id VARCHAR(64) NULL,
      title VARCHAR(128) NULL,
      delivery_status VARCHAR(32) NOT NULL DEFAULT 'sent',
      active_key VARCHAR(191) NULL,
      campaign_snapshot_json JSON NULL,
      target_count INT UNSIGNED NOT NULL DEFAULT 0,
      sent_count INT UNSIGNED NOT NULL DEFAULT 0,
      failed_count INT UNSIGNED NOT NULL DEFAULT 0,
      started_at DATETIME(3) NULL,
      completed_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_mascot_ad_active_key (active_key),
      KEY idx_mascot_ad_site_status (site_id, delivery_status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("mascot_ad_deliveries", "campaign_id", "VARCHAR(64) NULL AFTER mascot_character_id");
  await addColumnIfMissing("mascot_ad_deliveries", "active_key", "VARCHAR(191) NULL AFTER delivery_status");
  await addColumnIfMissing("mascot_ad_deliveries", "campaign_snapshot_json", "JSON NULL AFTER active_key");
  await addColumnIfMissing("mascot_ad_deliveries", "target_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER campaign_snapshot_json");
  await addColumnIfMissing("mascot_ad_deliveries", "failed_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER sent_count");
  await addColumnIfMissing("mascot_ad_deliveries", "started_at", "DATETIME(3) NULL AFTER failed_count");
  await addColumnIfMissing("mascot_ad_deliveries", "completed_at", "DATETIME(3) NULL AFTER started_at");
  await addColumnIfMissing("mascot_ad_deliveries", "updated_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at");
  await addIndexIfMissing(
    "mascot_ad_deliveries",
    "uniq_mascot_ad_active_key",
    "CREATE UNIQUE INDEX uniq_mascot_ad_active_key ON mascot_ad_deliveries(active_key)"
  );
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS mascot_ad_delivery_targets (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      delivery_id VARCHAR(64) NOT NULL,
      internal_uid VARCHAR(64) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      target_status VARCHAR(32) NOT NULL DEFAULT 'queued',
      message_id VARCHAR(64) NULL,
      campaign_delivery_id VARCHAR(64) NULL,
      proactive_delivery_id VARCHAR(64) NULL,
      retry_count INT UNSIGNED NOT NULL DEFAULT 0,
      available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      failure_reason VARCHAR(255) NULL,
      started_at DATETIME(3) NULL,
      completed_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_mascot_ad_target_user (delivery_id, internal_uid),
      KEY idx_mascot_ad_targets_status (delivery_id, target_status, created_at),
      KEY idx_mascot_ad_targets_ready (delivery_id, target_status, available_at, created_at),
      CONSTRAINT fk_mascot_ad_targets_delivery FOREIGN KEY (delivery_id) REFERENCES mascot_ad_deliveries(id) ON DELETE CASCADE,
      CONSTRAINT fk_mascot_ad_targets_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_mascot_ad_targets_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("mascot_ad_delivery_targets", "campaign_delivery_id", "VARCHAR(64) NULL AFTER message_id");
  await addColumnIfMissing("mascot_ad_delivery_targets", "proactive_delivery_id", "VARCHAR(64) NULL AFTER campaign_delivery_id");
  await addColumnIfMissing("mascot_ad_delivery_targets", "retry_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER proactive_delivery_id");
  await addColumnIfMissing("mascot_ad_delivery_targets", "available_at", "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER retry_count");
  await addIndexIfMissing(
    "mascot_ad_delivery_targets",
    "idx_mascot_ad_targets_ready",
    "CREATE INDEX idx_mascot_ad_targets_ready ON mascot_ad_delivery_targets(delivery_id, target_status, available_at, created_at)"
  );
}

export async function createProactiveMessageDeliveriesTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS proactive_message_deliveries (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      internal_uid VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NULL,
      character_id VARCHAR(64) NULL,
      session_id VARCHAR(64) NULL,
      message_id VARCHAR(64) NULL,
      delivery_date VARCHAR(10) NOT NULL,
      delivery_status VARCHAR(32) NOT NULL DEFAULT 'reserved',
      source_type VARCHAR(32) NOT NULL,
      source_ref VARCHAR(128) NULL,
      campaign_id VARCHAR(64) NULL,
      slot_index TINYINT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      sent_at DATETIME(3) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_proactive_delivery_slot (internal_uid, delivery_date, slot_index),
      KEY idx_proactive_deliveries_user_date (internal_uid, delivery_date, delivery_status),
      KEY idx_proactive_deliveries_user_character (internal_uid, character_id, sent_at),
      KEY idx_proactive_deliveries_message (message_id),
      KEY idx_proactive_deliveries_campaign (campaign_id, internal_uid),
      CONSTRAINT fk_proactive_deliveries_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
