import { getDbPool } from "./db-core.js";
import { addColumnIfMissing } from "./db-schema-utils.js";

export async function createSiteExternalEmbedsTableIfMissing() {
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS site_external_embeds (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      public_id VARCHAR(64) NOT NULL,
      site_id VARCHAR(64) NOT NULL,
      external_origin VARCHAR(255) NOT NULL,
      embed_status VARCHAR(32) NOT NULL DEFAULT 'draft',
      launcher_image_url VARCHAR(512) NULL,
      show_badge TINYINT(1) NOT NULL DEFAULT 1,
      desktop_right_px SMALLINT UNSIGNED NOT NULL DEFAULT 24,
      desktop_bottom_px SMALLINT UNSIGNED NOT NULL DEFAULT 84,
      mobile_right_px SMALLINT UNSIGNED NOT NULL DEFAULT 16,
      mobile_bottom_px SMALLINT UNSIGNED NOT NULL DEFAULT 84,
      accent_color CHAR(7) NOT NULL DEFAULT '#00E95C',
      surface_color CHAR(7) NOT NULL DEFAULT '#101312',
      text_color CHAR(7) NOT NULL DEFAULT '#FFFFFF',
      corner_radius_px TINYINT UNSIGNED NOT NULL DEFAULT 22,
      title VARCHAR(96) NOT NULL DEFAULT 'Chat with AIOVE',
      title_rich_text TEXT NULL,
      show_beta TINYINT(1) NOT NULL DEFAULT 1,
      beta_text VARCHAR(24) NULL,
      description VARCHAR(500) NOT NULL DEFAULT 'Talk football. Share life. Anytime, anywhere—with your ALOVE companion.',
      description_rich_text TEXT NULL,
      cta_text VARCHAR(64) NOT NULL DEFAULT 'Start chat',
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uniq_site_external_embeds_public_id (public_id),
      UNIQUE KEY uniq_site_external_embeds_site (site_id),
      KEY idx_site_external_embeds_status_origin (embed_status, external_origin),
      CONSTRAINT fk_site_external_embeds_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumnIfMissing("site_external_embeds", "title_rich_text", "TEXT NULL AFTER title");
  await addColumnIfMissing("site_external_embeds", "description_rich_text", "TEXT NULL AFTER description");
  await ensureTitleDefault();
}

async function ensureTitleDefault() {
  const db = getDbPool();
  const [rows] = await db.execute(`
    SELECT COLUMN_DEFAULT
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'site_external_embeds' AND column_name = 'title'
    LIMIT 1
  `);
  if (String(rows[0]?.COLUMN_DEFAULT || "") === "Chat with AIOVE") return;
  await db.query("ALTER TABLE site_external_embeds ALTER COLUMN title SET DEFAULT 'Chat with AIOVE'");
}
