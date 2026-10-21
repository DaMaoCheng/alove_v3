import { getDbPool } from "./db-core.js";
import { addColumnIfMissing, addIndexIfMissing } from "./db-schema-utils.js";

export async function ensureUserAccountTypeMigration() {
  const [columns] = await getDbPool().query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'account_type'
    LIMIT 1
  `);

  if (!columns.length) {
    await getDbPool().query(`
      ALTER TABLE users
        ADD COLUMN account_type VARCHAR(32) NOT NULL DEFAULT 'personal' AFTER account_status
    `);
  }

  await getDbPool().query(`
    UPDATE users
    SET account_type = 'personal'
    WHERE account_type IS NULL OR account_type NOT IN ('personal', 'creator', 'admin')
  `);

  await addIndexIfMissing("users", "idx_users_account_type", "CREATE INDEX idx_users_account_type ON users(account_type)");
}

export async function addCharacterSettingsColumnsIfMissing() {
  await addColumnIfMissing("ai_characters", "speaking_style", "TEXT NULL AFTER persona_prompt");
  await addColumnIfMissing("ai_characters", "site_id", "VARCHAR(64) NULL AFTER owner_uid");
  await addIndexIfMissing("ai_characters", "idx_ai_characters_site", "CREATE INDEX idx_ai_characters_site ON ai_characters(site_id, character_status, visibility)");
}

export async function ensureCreatorCharacterOwnerUniqueness() {
  await addColumnIfMissing(
    "ai_characters",
    "active_creator_marker",
    `TINYINT GENERATED ALWAYS AS (
      CASE
        WHEN category_id = 'creator' AND character_status <> 'archived' THEN 1
        ELSE NULL
      END
    ) VIRTUAL AFTER character_status`
  );

  const [duplicates] = await getDbPool().query(`
    SELECT owner_uid, COUNT(*) AS character_count
    FROM ai_characters
    WHERE category_id = 'creator'
      AND character_status <> 'archived'
      AND owner_uid IS NOT NULL
    GROUP BY owner_uid
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (duplicates.length) {
    throw new Error(`Cannot enforce creator character uniqueness: owner ${duplicates[0].owner_uid} has ${duplicates[0].character_count} active creator characters`);
  }

  await addIndexIfMissing(
    "ai_characters",
    "uniq_ai_characters_active_creator_owner",
    "CREATE UNIQUE INDEX uniq_ai_characters_active_creator_owner ON ai_characters(owner_uid, active_creator_marker)"
  );
}

export async function addChatSessionPreferenceColumnsIfMissing() {
  await addColumnIfMissing("chat_sessions", "preferred_language", "VARCHAR(128) NULL AFTER source_ref");
}

export async function addGuestExternalSourceContextColumnIfMissing() {
  await addColumnIfMissing("guest_sessions", "external_source_context_json", "JSON NULL AFTER target_chat_session_id");
}

export async function addCharacterVoiceAssetColumnsIfMissing() {
  await addColumnIfMissing("character_voice_assets", "model", "VARCHAR(128) NULL AFTER voice_id");
  await addColumnIfMissing("character_voice_assets", "language_code", "VARCHAR(32) NULL AFTER model");
  await addColumnIfMissing("character_voice_assets", "language_label", "VARCHAR(128) NULL AFTER language_code");
  await addColumnIfMissing("character_voice_assets", "audio_bytes", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER audio_url");
  await addColumnIfMissing("character_voice_assets", "character_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER audio_bytes");
  await addColumnIfMissing("character_voice_assets", "estimated_credits", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER character_count");
  await addColumnIfMissing("character_voice_assets", "output_format", "VARCHAR(64) NULL AFTER estimated_credits");
  await addColumnIfMissing("character_voice_assets", "error_message", "VARCHAR(500) NULL AFTER output_format");
  await addColumnIfMissing("character_voice_assets", "provider_request_id", "VARCHAR(128) NULL AFTER error_message");
  await addColumnIfMissing("character_voice_assets", "provider_error_raw", "TEXT NULL AFTER provider_request_id");
  await addColumnIfMissing("character_voice_assets", "retry_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER provider_error_raw");
  await addColumnIfMissing("character_voice_assets", "last_attempt_at", "DATETIME(3) NULL AFTER retry_count");
  await addColumnIfMissing("character_voice_assets", "attempt_token", "VARCHAR(64) NULL AFTER last_attempt_at");
  await addColumnIfMissing("character_voice_assets", "message_id", "VARCHAR(64) NULL AFTER attempt_token");
  await addIndexIfMissing("character_voice_assets", "idx_character_voice_assets_message", "CREATE INDEX idx_character_voice_assets_message ON character_voice_assets(message_id)");
}

export async function addUserCharacterActivationPreferenceColumnsIfMissing() {
  await addColumnIfMissing("user_character_activations", "preferred_language_code", "VARCHAR(32) NULL AFTER source_ref");
  await addColumnIfMissing("user_character_activations", "preferred_language_label", "VARCHAR(128) NULL AFTER preferred_language_code");
}

export async function addHomeCarouselColumnsIfMissing() {
  await addColumnIfMissing("home_carousel_items", "site_id", "VARCHAR(64) NULL AFTER image_url");
  await addIndexIfMissing(
    "home_carousel_items",
    "idx_home_carousel_site_status_order",
    "CREATE INDEX idx_home_carousel_site_status_order ON home_carousel_items(site_id, item_status, display_order, starts_at, ends_at)"
  );
}

export async function addUserProfileColumnsIfMissing() {
  await addColumnIfMissing("users", "favorite_club", "VARCHAR(128) NULL AFTER avatar_emoji");
  await addColumnIfMissing("users", "site_id", "VARCHAR(64) NULL AFTER account_type");
  await addIndexIfMissing("users", "idx_users_site", "CREATE INDEX idx_users_site ON users(site_id)");
}

export async function addAdminAccountColumnsIfMissing() {
  await addColumnIfMissing("users", "account_status_note", "VARCHAR(255) NULL AFTER account_status");
  await addColumnIfMissing("billing_accounts", "recharge_balance", "DECIMAL(18, 3) NOT NULL DEFAULT 0.000 AFTER balance");
  await addColumnIfMissing("billing_accounts", "bonus_balance", "DECIMAL(18, 3) NOT NULL DEFAULT 0.000 AFTER recharge_balance");
}

export async function addSiteColumnsIfMissing() {
  await addColumnIfMissing("sites", "site_url", "VARCHAR(512) NULL AFTER slug");
  await addColumnIfMissing("sites", "site_logo_url", "VARCHAR(512) NULL AFTER site_url");
  await addColumnIfMissing("sites", "time_zone", "VARCHAR(64) NULL AFTER currency");
  await addColumnIfMissing("sites", "product_source_type", "VARCHAR(32) NULL AFTER product_api_url");
  await addColumnIfMissing("sites", "product_shop_domain", "VARCHAR(255) NULL AFTER product_source_type");
  await addColumnIfMissing("sites", "product_api_version", "VARCHAR(32) NULL AFTER product_shop_domain");
  await addColumnIfMissing("sites", "product_access_token_encrypted", "TEXT NULL AFTER product_api_version");
  await addColumnIfMissing("sites", "shopify_login_enabled", "TINYINT(1) NOT NULL DEFAULT 1 AFTER product_access_token_encrypted");
  await addColumnIfMissing("sites", "payment_methods_json", "JSON NULL AFTER shopify_login_enabled");
  await addColumnIfMissing("sites", "commerce_enabled", "TINYINT(1) NOT NULL DEFAULT 1 AFTER payment_methods_json");
  await addColumnIfMissing("sites", "guest_chat_enabled", "TINYINT(1) NOT NULL DEFAULT 0 AFTER commerce_enabled");
}

export async function addMascotSettingsColumnsIfMissing() {
  await addColumnIfMissing("mascot_settings", "avatar_url", "VARCHAR(512) NULL AFTER name");
  await addColumnIfMissing("mascot_settings", "currency", "VARCHAR(16) NULL AFTER cta");
  await getDbPool().query("ALTER TABLE mascot_settings MODIFY COLUMN tone TEXT NULL");
}
