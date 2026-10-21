export const GUEST_IMAGE_NETWORK_LIMIT = 3;
export const GUEST_IMAGE_WINDOW_HOURS = 5;
export const GUEST_IMAGE_WINDOW_MS = GUEST_IMAGE_WINDOW_HOURS * 60 * 60 * 1000;
export const GUEST_IMAGE_DAILY_LIMIT = GUEST_IMAGE_NETWORK_LIMIT;

export const GUEST_IMAGE_DAILY_QUOTA_STATUSES = Object.freeze({
  AVAILABLE: "available",
  RESERVED: "reserved",
  CONSUMED: "consumed",
});

export function getGuestImageQuotaWindow(date = new Date()) {
  const value = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(value.getTime())) return getGuestImageQuotaWindow(new Date());
  return { windowStartedAt: value, windowExpiresAt: new Date(value.getTime() + GUEST_IMAGE_WINDOW_MS) };
}

export async function getGuestImageDailyQuota(db, { siteId = "", networkHash = "" } = {}) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedNetworkHash = String(networkHash || "").trim();
  const fallback = getGuestImageQuotaWindow();
  if (!normalizedSiteId || !normalizedNetworkHash) return buildQuotaSnapshot(null, fallback);
  const [rows] = await db.execute(
    `SELECT window_started_at, window_expires_at, used_count, reserved_count
     FROM guest_image_network_quota_windows
     WHERE site_id = ? AND network_hash = ? LIMIT 1`,
    [normalizedSiteId, normalizedNetworkHash]
  );
  const row = rows[0] || null;
  if (row && isExpired(row) && Number(row.reserved_count || 0) === 0) {
    return buildQuotaSnapshot(null, fallback);
  }
  return buildQuotaSnapshot(row, fallback);
}

export async function lockGuestImageDailyQuota(db, { siteId = "", networkHash = "" } = {}) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedNetworkHash = String(networkHash || "").trim();
  if (!normalizedSiteId || !normalizedNetworkHash) return null;
  await db.execute(
    `INSERT IGNORE INTO guest_image_network_quota_windows (site_id, network_hash)
     VALUES (?, ?)`,
    [normalizedSiteId, normalizedNetworkHash]
  );
  const [rows] = await db.execute(
    `SELECT site_id, network_hash, window_started_at, window_expires_at, used_count, reserved_count
     FROM guest_image_network_quota_windows
     WHERE site_id = ? AND network_hash = ? LIMIT 1 FOR UPDATE`,
    [normalizedSiteId, normalizedNetworkHash]
  );
  const row = rows[0] || null;
  if (!row) return null;
  if (isExpired(row) && Number(row.reserved_count || 0) === 0) {
    await db.execute(
      `UPDATE guest_image_network_quota_windows
       SET window_started_at = NULL, window_expires_at = NULL, used_count = 0, reserved_count = 0, updated_at = NOW(3)
       WHERE site_id = ? AND network_hash = ?`,
      [normalizedSiteId, normalizedNetworkHash]
    );
    return buildQuotaSnapshot(null, getGuestImageQuotaWindow());
  }
  return buildQuotaSnapshot(row, getGuestImageQuotaWindow());
}

export async function reserveGuestImageDailyQuota(db, {
  siteId = "", networkHash = "", guestSessionId = "", assetId = "", requestKey = "",
} = {}) {
  const normalizedSiteId = String(siteId || "").trim();
  const normalizedNetworkHash = String(networkHash || "").trim();
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedSiteId || !normalizedNetworkHash || !normalizedAssetId) return false;
  const [windowRows] = await db.execute(
    `SELECT window_expires_at, used_count, reserved_count
     FROM guest_image_network_quota_windows
     WHERE site_id = ? AND network_hash = ? LIMIT 1 FOR UPDATE`,
    [normalizedSiteId, normalizedNetworkHash]
  );
  const row = windowRows[0] || null;
  if (!row || isExpired(row) || Number(row.used_count || 0) + Number(row.reserved_count || 0) >= GUEST_IMAGE_NETWORK_LIMIT) return false;
  const [result] = await db.execute(
    `INSERT INTO guest_image_network_quota_reservations
       (asset_id, site_id, network_hash, guest_session_id, request_key, reservation_status, reserved_at)
     VALUES (?, ?, ?, ?, ?, 'reserved', NOW(3))`,
    [normalizedAssetId, normalizedSiteId, normalizedNetworkHash, String(guestSessionId || "").trim() || null, String(requestKey || "").trim() || null]
  );
  if (Number(result.affectedRows || 0) !== 1) return false;
  await db.execute(
    `UPDATE guest_image_network_quota_windows
     SET reserved_count = reserved_count + 1,
         window_started_at = COALESCE(window_started_at, NOW(3)),
         window_expires_at = COALESCE(window_expires_at, DATE_ADD(NOW(3), INTERVAL 5 HOUR)),
         updated_at = NOW(3)
     WHERE site_id = ? AND network_hash = ?`,
    [normalizedSiteId, normalizedNetworkHash]
  );
  return true;
}

export async function consumeGuestImageDailyQuotaForAsset(db, assetId = "") {
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedAssetId) return { enforced: false, consumed: false };
  const [rows] = await db.execute(
    `SELECT asset_id, site_id, network_hash, reservation_status
     FROM guest_image_network_quota_reservations WHERE asset_id = ? LIMIT 1 FOR UPDATE`,
    [normalizedAssetId]
  );
  const row = rows[0] || null;
  if (!row) return { enforced: false, consumed: true };
  if (row.reservation_status === GUEST_IMAGE_DAILY_QUOTA_STATUSES.CONSUMED) return { enforced: true, consumed: true };
  const [result] = await db.execute(
    `UPDATE guest_image_network_quota_reservations
     SET reservation_status = 'consumed', consumed_at = COALESCE(consumed_at, NOW(3))
     WHERE asset_id = ? AND reservation_status = 'reserved'`,
    [normalizedAssetId]
  );
  if (Number(result.affectedRows || 0) !== 1) return { enforced: true, consumed: false };
  await db.execute(
    `UPDATE guest_image_network_quota_windows
     SET reserved_count = GREATEST(0, reserved_count - 1), used_count = used_count + 1, updated_at = NOW(3)
     WHERE site_id = ? AND network_hash = ?`,
    [row.site_id, row.network_hash]
  );
  return { enforced: true, consumed: true };
}

export async function releaseGuestImageDailyQuotaForAsset(db, assetId = "") {
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedAssetId) return false;
  const [rows] = await db.execute(
    `SELECT site_id, network_hash FROM guest_image_network_quota_reservations
     WHERE asset_id = ? AND reservation_status = 'reserved' LIMIT 1 FOR UPDATE`,
    [normalizedAssetId]
  );
  const row = rows[0] || null;
  if (!row) return false;
  const [result] = await db.execute(
    `UPDATE guest_image_network_quota_reservations SET reservation_status = 'released'
     WHERE asset_id = ? AND reservation_status = 'reserved'`,
    [normalizedAssetId]
  );
  if (Number(result.affectedRows || 0) !== 1) return false;
  await db.execute(
    `UPDATE guest_image_network_quota_windows
     SET reserved_count = GREATEST(0, reserved_count - 1), updated_at = NOW(3)
     WHERE site_id = ? AND network_hash = ?`,
    [row.site_id, row.network_hash]
  );
  return true;
}

function buildQuotaSnapshot(row, fallback) {
  const used = Math.max(0, Number(row?.used_count || 0));
  const pending = Math.max(0, Number(row?.reserved_count || 0));
  const remaining = Math.max(0, GUEST_IMAGE_NETWORK_LIMIT - used - pending);
  const expires = row?.window_expires_at ? new Date(row.window_expires_at) : fallback.windowExpiresAt;
  return {
    configured: Boolean(row),
    quota_status: used >= GUEST_IMAGE_NETWORK_LIMIT ? GUEST_IMAGE_DAILY_QUOTA_STATUSES.CONSUMED : (pending ? GUEST_IMAGE_DAILY_QUOTA_STATUSES.RESERVED : GUEST_IMAGE_DAILY_QUOTA_STATUSES.AVAILABLE),
    used,
    remaining,
    pending,
    windowExpiresAt: Number.isNaN(expires.getTime()) ? fallback.windowExpiresAt : expires,
    windowStartedAt: row?.window_started_at || null,
  };
}

function isExpired(row) {
  return Boolean(row?.window_expires_at && new Date(row.window_expires_at).getTime() <= Date.now());
}
