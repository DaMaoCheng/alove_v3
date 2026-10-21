import { getDbPool } from "./db-core.js";
import { addColumnIfMissing, addIndexIfMissing, ensureIndexColumns, ensureNonUniqueIndex } from "./db-schema-utils.js";

export async function createMascotSettingsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS mascot_settings (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_id VARCHAR(64) NULL,
      character_id VARCHAR(64) NOT NULL,
      name VARCHAR(96) NOT NULL,
      avatar_url VARCHAR(512) NULL,
      tone TEXT NULL,
      greeting VARCHAR(512) NULL,
      cta VARCHAR(512) NULL,
      currency VARCHAR(16) NULL,
      knowledge_json JSON NULL,
      setting_status VARCHAR(32) NOT NULL DEFAULT 'active',
      source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
      source_ref VARCHAR(128) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_mascot_settings_site (site_id),
      KEY idx_mascot_settings_character (character_id),
      KEY idx_mascot_settings_status (setting_status, site_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createMascotGreetingImageTablesIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS mascot_greeting_images (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      character_id VARCHAR(64) NOT NULL,
      slot_index TINYINT UNSIGNED NOT NULL,
      image_url VARCHAR(512) NULL,
      generation_status VARCHAR(32) NOT NULL DEFAULT 'empty',
      source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
      prompt_summary VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_mascot_greeting_images_slot (character_id, slot_index),
      KEY idx_mascot_greeting_images_ready (character_id, generation_status, slot_index),
      CONSTRAINT chk_mascot_greeting_images_slot CHECK (slot_index BETWEEN 1 AND 5),
      CONSTRAINT fk_mascot_greeting_images_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS mascot_greeting_message_deliveries (
      session_id VARCHAR(64) NOT NULL PRIMARY KEY,
      message_id VARCHAR(64) NULL,
      image_id VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_mascot_greeting_delivery_message (message_id),
      CONSTRAINT fk_mascot_greeting_delivery_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_mascot_greeting_delivery_image FOREIGN KEY (image_id) REFERENCES mascot_greeting_images(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createChatQuickRepliesTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS chat_quick_replies (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      quick_reply_type VARCHAR(32) NOT NULL,
      text VARCHAR(120) NOT NULL,
      locale VARCHAR(32) NOT NULL DEFAULT 'en',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT NOT NULL DEFAULT 0,
      source_type VARCHAR(32) NOT NULL DEFAULT 'system',
      source_ref VARCHAR(128) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_chat_quick_replies_type_active (quick_reply_type, is_active, locale, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function createChatImageTablesIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS chat_image_assets (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      message_id VARCHAR(64) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      internal_uid VARCHAR(64) NULL,
      guest_session_id VARCHAR(64) NULL,
      character_id VARCHAR(64) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      storage_path VARCHAR(512) NULL,
      protected_path VARCHAR(512) NULL,
      width INT UNSIGNED NULL,
      height INT UNSIGNED NULL,
      bytes INT UNSIGNED NULL,
      mime_type VARCHAR(64) NULL,
      prompt_summary VARCHAR(500) NULL,
      prompt_context_json JSON NULL,
      prompt_full_text MEDIUMTEXT NULL,
      provider VARCHAR(64) NULL,
      provider_request_id VARCHAR(128) NULL,
      error_message VARCHAR(500) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      completed_at DATETIME(3) NULL,
      UNIQUE KEY uniq_chat_image_assets_message (message_id),
      KEY idx_chat_image_assets_session_status (session_id, status, created_at),
      KEY idx_chat_image_assets_user_date (internal_uid, created_at),
      KEY idx_chat_image_assets_guest_status (guest_session_id, status),
      CONSTRAINT fk_chat_image_assets_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_image_assets_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_image_assets_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_image_assets_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("chat_image_assets", "prompt_context_json", "JSON NULL AFTER prompt_summary");
  await addColumnIfMissing("chat_image_assets", "prompt_full_text", "MEDIUMTEXT NULL AFTER prompt_context_json");

  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS chat_image_usage (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      internal_uid VARCHAR(64) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      character_id VARCHAR(64) NULL,
      usage_date DATE NOT NULL,
      message_id VARCHAR(64) NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_chat_image_usage_message (message_id),
      KEY idx_chat_image_usage_user_session_date (internal_uid, session_id, usage_date),
      KEY idx_chat_image_usage_user_character_date (internal_uid, character_id, usage_date),
      CONSTRAINT fk_chat_image_usage_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_image_usage_session FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_image_usage_character FOREIGN KEY (character_id) REFERENCES ai_characters(id) ON DELETE SET NULL,
      CONSTRAINT fk_chat_image_usage_message FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
      CONSTRAINT fk_chat_image_usage_asset FOREIGN KEY (asset_id) REFERENCES chat_image_assets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS chat_image_quota_windows (
      internal_uid VARCHAR(64) NOT NULL,
      window_started_at DATETIME(3) NULL,
      image_count INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (internal_uid),
      KEY idx_chat_image_quota_windows_expiry (window_started_at),
      CONSTRAINT fk_chat_image_quota_windows_user FOREIGN KEY (internal_uid) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addIndexIfMissing(
    "chat_image_usage",
    "idx_chat_image_usage_user_character_date",
    "CREATE INDEX idx_chat_image_usage_user_character_date ON chat_image_usage(internal_uid, character_id, usage_date)"
  );
}

export async function createGuestChatTablesIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_network_rate_limits (
      network_hash CHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      session_window_started_at DATETIME(3) NULL,
      session_window_count INT UNSIGNED NOT NULL DEFAULT 0,
      message_window_started_at DATETIME(3) NULL,
      message_window_count INT UNSIGNED NOT NULL DEFAULT 0,
      search_window_started_at DATETIME(3) NULL,
      search_window_count INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (network_hash, site_id),
      KEY idx_guest_network_limits_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("guest_network_rate_limits", "search_window_started_at", "DATETIME(3) NULL AFTER message_window_count");
  await addColumnIfMissing("guest_network_rate_limits", "search_window_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER search_window_started_at");
  await addColumnIfMissing("guest_network_rate_limits", "upload_window_started_at", "DATETIME(3) NULL AFTER search_window_count");
  await addColumnIfMissing("guest_network_rate_limits", "upload_window_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER upload_window_started_at");
  await addColumnIfMissing("guest_network_rate_limits", "upload_window_bytes", "BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER upload_window_count");
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_sessions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      token_hash VARCHAR(128) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      mascot_character_id VARCHAR(64) NOT NULL,
      chat_session_id VARCHAR(64) NULL,
      session_status VARCHAR(32) NOT NULL DEFAULT 'active',
      message_window_started_at DATETIME(3) NULL,
      message_window_count INT UNSIGNED NOT NULL DEFAULT 0,
      rate_window_started_at DATETIME(3) NULL,
      rate_window_count INT UNSIGNED NOT NULL DEFAULT 0,
      claimed_user_id VARCHAR(64) NULL,
      claimed_at DATETIME(3) NULL,
      target_chat_session_id VARCHAR(64) NULL,
      external_source_context_json JSON NULL,
      expires_at DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_guest_sessions_token_hash (token_hash),
      UNIQUE KEY uniq_guest_sessions_chat_session (chat_session_id),
      KEY idx_guest_sessions_status_expires (session_status, expires_at),
      KEY idx_guest_sessions_site_status (site_id, session_status),
      KEY idx_guest_sessions_claimed_source (claimed_user_id, session_status, claimed_at, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("guest_sessions", "external_source_context_json", "JSON NULL AFTER target_chat_session_id");
  await addIndexIfMissing(
    "guest_sessions",
    "idx_guest_sessions_claimed_source",
    "CREATE INDEX idx_guest_sessions_claimed_source ON guest_sessions(claimed_user_id, session_status, claimed_at, id)"
  );
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_image_entitlements (
      guest_session_id VARCHAR(64) NOT NULL PRIMARY KEY,
      entitlement_status VARCHAR(32) NOT NULL DEFAULT 'available',
      asset_id VARCHAR(64) NULL,
      request_key VARCHAR(128) NULL,
      reserved_at DATETIME(3) NULL,
      consumed_at DATETIME(3) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_guest_image_asset (asset_id),
      UNIQUE KEY uniq_guest_image_request (guest_session_id, request_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_image_network_quota_windows (
      site_id VARCHAR(64) NOT NULL,
      network_hash CHAR(64) NOT NULL,
      window_started_at DATETIME(3) NULL,
      window_expires_at DATETIME(3) NULL,
      used_count INT UNSIGNED NOT NULL DEFAULT 0,
      reserved_count INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (site_id, network_hash),
      KEY idx_guest_image_network_window (window_expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_image_network_quota_reservations (
      asset_id VARCHAR(64) NOT NULL PRIMARY KEY,
      site_id VARCHAR(64) NOT NULL,
      network_hash CHAR(64) NOT NULL,
      guest_session_id VARCHAR(64) NULL,
      request_key VARCHAR(128) NULL,
      reservation_status VARCHAR(32) NOT NULL DEFAULT 'reserved',
      reserved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      consumed_at DATETIME(3) NULL,
      KEY idx_guest_image_network_reservation_window (site_id, network_hash, reservation_status),
      KEY idx_guest_image_network_reservation_guest (guest_session_id, reservation_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_character_sessions (
      guest_session_id VARCHAR(64) NOT NULL,
      character_id VARCHAR(64) NOT NULL,
      chat_session_id VARCHAR(64) NOT NULL,
      message_window_started_at DATETIME(3) NULL,
      message_window_count INT UNSIGNED NOT NULL DEFAULT 0,
      rate_window_started_at DATETIME(3) NULL,
      rate_window_count INT UNSIGNED NOT NULL DEFAULT 0,
      target_chat_session_id VARCHAR(64) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (guest_session_id, character_id),
      UNIQUE KEY uniq_guest_character_chat_session (chat_session_id),
      KEY idx_guest_character_sessions_guest_activity (guest_session_id, updated_at),
      KEY idx_guest_character_sessions_target (target_chat_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("guest_sessions", "attachment_window_started_at", "DATETIME(3) NULL AFTER rate_window_count");
  await addColumnIfMissing("guest_sessions", "attachment_window_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER attachment_window_started_at");
  await addColumnIfMissing("guest_sessions", "attachment_window_bytes", "BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER attachment_window_count");
  await addColumnIfMissing("guest_sessions", "call_window_started_at", "DATETIME(3) NULL AFTER attachment_window_bytes");
  await addColumnIfMissing("guest_sessions", "call_window_milliseconds", "BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER call_window_started_at");
  await addColumnIfMissing("guest_sessions", "active_call_id", "VARCHAR(64) NULL AFTER call_window_milliseconds");
  await addColumnIfMissing("guest_sessions", "last_ip", "VARCHAR(64) NULL AFTER target_chat_session_id");
  await addColumnIfMissing("guest_sessions", "last_ip_region", "VARCHAR(96) NULL AFTER last_ip");
  await addColumnIfMissing("guest_sessions", "last_ip_at", "DATETIME(3) NULL AFTER last_ip_region");
  await addColumnIfMissing("guest_sessions", "last_user_agent", "VARCHAR(500) NULL AFTER last_ip_at");
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_chat_attachments (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      guest_session_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      character_id VARCHAR(64) NOT NULL,
      network_hash CHAR(64) NOT NULL,
      client_upload_id VARCHAR(128) NOT NULL,
      stored_name VARCHAR(180) NOT NULL,
      attempt_token VARCHAR(64) NULL,
      attachment_json JSON NOT NULL,
      asset_status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
      request_key VARCHAR(128) NULL,
      message_id VARCHAR(64) NULL,
      expires_at DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_guest_chat_attachment_stored (stored_name),
      UNIQUE KEY uniq_guest_chat_attachment_request (guest_session_id, character_id, client_upload_id),
      KEY idx_guest_chat_attachments_guest_status (guest_session_id, asset_status, created_at),
      KEY idx_guest_chat_attachments_request (guest_session_id, request_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("guest_chat_attachments", "client_upload_id", "VARCHAR(128) NULL AFTER character_id");
  await addColumnIfMissing("guest_chat_attachments", "network_hash", "CHAR(64) NULL AFTER character_id");
  await addColumnIfMissing("guest_chat_attachments", "attempt_token", "VARCHAR(64) NULL AFTER stored_name");
  await ensureIndexColumns(
    "guest_chat_attachments",
    "uniq_guest_chat_attachment_request",
    ["guest_session_id", "character_id", "client_upload_id"],
    "CREATE UNIQUE INDEX uniq_guest_chat_attachment_request ON guest_chat_attachments(guest_session_id, character_id, client_upload_id)"
  );
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_voice_requests (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      guest_session_id VARCHAR(64) NOT NULL,
      network_hash CHAR(64) NOT NULL,
      request_key VARCHAR(128) NOT NULL,
      request_status VARCHAR(32) NOT NULL DEFAULT 'processing',
      attempt_token VARCHAR(64) NULL,
      attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
      transcript_text TEXT NULL,
      error_message VARCHAR(500) NULL,
      expires_at DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_guest_voice_request (guest_session_id, request_key),
      KEY idx_guest_voice_requests_status_updated (request_status, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("guest_voice_requests", "network_hash", "CHAR(64) NULL AFTER guest_session_id");
  await addColumnIfMissing("guest_voice_requests", "character_id", "VARCHAR(64) NULL AFTER guest_session_id");
  await getDbPool().query(`
    UPDATE guest_voice_requests request_row
    INNER JOIN guest_sessions guest ON guest.id = request_row.guest_session_id
       SET request_row.character_id = guest.mascot_character_id
     WHERE request_row.character_id IS NULL OR request_row.character_id = ''
  `);
  await addIndexIfMissing("guest_voice_requests", "idx_guest_voice_requests_character_status", "CREATE INDEX idx_guest_voice_requests_character_status ON guest_voice_requests(guest_session_id, character_id, request_status, updated_at)");
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS guest_call_sessions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      guest_session_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      character_id VARCHAR(64) NOT NULL,
      network_hash CHAR(64) NULL,
      lease_token VARCHAR(64) NOT NULL,
      call_status VARCHAR(32) NOT NULL DEFAULT 'active',
      duration_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
      guarded_input_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
      guarded_input_updated_at DATETIME(3) NULL,
      pending_input_milliseconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
      pending_input_epoch INT UNSIGNED NOT NULL DEFAULT 0,
      turn_count INT UNSIGNED NOT NULL DEFAULT 0,
      claimed_user_id VARCHAR(64) NULL,
      target_chat_session_id VARCHAR(64) NULL,
      started_at DATETIME(3) NOT NULL,
      last_accounted_at DATETIME(3) NOT NULL,
      ended_at DATETIME(3) NULL,
      expires_at DATETIME(3) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_guest_call_sessions_guest_status (guest_session_id, call_status, started_at),
      KEY idx_guest_call_sessions_network_active (network_hash, call_status, last_accounted_at),
      KEY idx_guest_call_sessions_claimed_user (claimed_user_id, ended_at),
      KEY idx_guest_call_sessions_expiry (expires_at, call_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("guest_call_sessions", "network_hash", "CHAR(64) NULL AFTER character_id");
  await addColumnIfMissing("guest_call_sessions", "guarded_input_milliseconds", "BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER duration_milliseconds");
  await addColumnIfMissing("guest_call_sessions", "guarded_input_updated_at", "DATETIME(3) NULL AFTER guarded_input_milliseconds");
  await addColumnIfMissing("guest_call_sessions", "pending_input_milliseconds", "BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER guarded_input_updated_at");
  await addColumnIfMissing("guest_call_sessions", "pending_input_epoch", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER pending_input_milliseconds");
  await addColumnIfMissing("guest_call_sessions", "turn_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER pending_input_epoch");
  await addColumnIfMissing("guest_call_sessions", "claimed_user_id", "VARCHAR(64) NULL AFTER turn_count");
  await addColumnIfMissing("guest_call_sessions", "target_chat_session_id", "VARCHAR(64) NULL AFTER claimed_user_id");
  await addIndexIfMissing("guest_call_sessions", "idx_guest_call_sessions_network_active", "CREATE INDEX idx_guest_call_sessions_network_active ON guest_call_sessions(network_hash, call_status, last_accounted_at)");
  await addIndexIfMissing("guest_call_sessions", "idx_guest_call_sessions_claimed_user", "CREATE INDEX idx_guest_call_sessions_claimed_user ON guest_call_sessions(claimed_user_id, ended_at)");
  await addColumnIfMissing("chat_sessions", "guest_session_id", "VARCHAR(64) NULL AFTER internal_uid");
  await ensureNonUniqueIndex("chat_sessions", "idx_chat_sessions_guest", "CREATE INDEX idx_chat_sessions_guest ON chat_sessions(guest_session_id)");
  await addColumnIfMissing("chat_messages", "client_message_id", "VARCHAR(128) NULL AFTER id");
  await addIndexIfMissing("chat_messages", "idx_chat_messages_guest_client", "CREATE UNIQUE INDEX idx_chat_messages_guest_client ON chat_messages(session_id, client_message_id)");
  await addColumnIfMissing("chat_messages", "guest_session_id", "VARCHAR(64) NULL AFTER session_id");
  await addIndexIfMissing(
    "chat_messages",
    "idx_chat_messages_guest_sent",
    "CREATE INDEX idx_chat_messages_guest_sent ON chat_messages(guest_session_id, sent_at)"
  );
  await getDbPool().query(`
    UPDATE chat_messages message
    INNER JOIN chat_sessions session ON session.id = message.session_id
    SET message.guest_session_id = session.guest_session_id
    WHERE message.guest_session_id IS NULL
      AND session.guest_session_id IS NOT NULL
      AND (
        session.internal_uid IS NULL
        OR message.source_type = 'guest'
        OR message.source_ref LIKE 'guest-%'
        OR message.source_ref LIKE 'guest:%'
      )
  `);
  await addColumnIfMissing("chat_image_assets", "guest_session_id", "VARCHAR(64) NULL AFTER internal_uid");
  await addIndexIfMissing(
    "chat_image_assets",
    "idx_chat_image_assets_guest_status",
    "CREATE INDEX idx_chat_image_assets_guest_status ON chat_image_assets(guest_session_id, status)"
  );
  const [imageOwnerColumn] = await getDbPool().query(`
    SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_image_assets' AND COLUMN_NAME = 'internal_uid'
    LIMIT 1
  `);
  if (imageOwnerColumn[0]?.IS_NULLABLE === "NO") {
    await getDbPool().query("ALTER TABLE chat_image_assets MODIFY COLUMN internal_uid VARCHAR(64) NULL");
  }
}
