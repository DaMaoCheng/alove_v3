import { addIndexIfMissing } from './db-schema-utils.js';
import { getDbPool } from './db-core.js';

export async function createGuestVisitorTablesIfMissing(db = getDbPool()) {
  await db.execute(`CREATE TABLE IF NOT EXISTS anonymous_visitors (
    id VARCHAR(64) PRIMARY KEY, site_id VARCHAR(64) NOT NULL, token_hash CHAR(64) NOT NULL,
    first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_visitor_site_token (site_id, token_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.execute(`CREATE TABLE IF NOT EXISTS guest_visitor_links (
    guest_session_id VARCHAR(64) PRIMARY KEY, visitor_id VARCHAR(64) NOT NULL,
    first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_outcome VARCHAR(16) NOT NULL, last_reason VARCHAR(48) NOT NULL,
    guest_cookie_present TINYINT NOT NULL DEFAULT 0, visitor_cookie_present TINYINT NOT NULL DEFAULT 0,
    KEY idx_guest_visitor (visitor_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.execute(`CREATE TABLE IF NOT EXISTS guest_identity_events (
    id VARCHAR(64) PRIMARY KEY, site_slug VARCHAR(128) NOT NULL,
    guest_session_id VARCHAR(64) NULL, outcome VARCHAR(16) NOT NULL, reason VARCHAR(48) NOT NULL,
    guest_cookie_present TINYINT NOT NULL, visitor_cookie_present TINYINT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_guest_identity_created (created_at), KEY idx_guest_identity_guest (guest_session_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await addIndexIfMissing('guest_sessions', 'idx_guest_site_created_id', 'CREATE INDEX idx_guest_site_created_id ON guest_sessions(site_id, created_at, id)');
  await addIndexIfMissing('anonymous_visitors', 'idx_visitor_expires', 'CREATE INDEX idx_visitor_expires ON anonymous_visitors(expires_at)');

}
