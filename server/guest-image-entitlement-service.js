import { getGuestImageDailyQuota, GUEST_IMAGE_NETWORK_LIMIT, GUEST_IMAGE_WINDOW_MS } from "./guest-image-daily-quota-service.js";

export const GUEST_IMAGE_ENTITLEMENT_STATUSES = Object.freeze({
  AVAILABLE: "available",
  RESERVED: "reserved",
  CONSUMED: "consumed",
});

export async function getGuestImageEntitlement(db, guestSessionId = "", { siteId = "", networkHash = "" } = {}) {
  const [rows] = await db.execute(
    `SELECT entitlement_status, asset_id, reserved_at, consumed_at
     FROM guest_image_entitlements
     WHERE guest_session_id = ?
     LIMIT 1`,
    [String(guestSessionId || "").trim()]
  );
  const status = String(rows[0]?.entitlement_status || GUEST_IMAGE_ENTITLEMENT_STATUSES.AVAILABLE).trim().toLowerCase();
  const consumedWithinWindow = status === GUEST_IMAGE_ENTITLEMENT_STATUSES.CONSUMED
    && isWithinGuestImageWindow(rows[0]?.consumed_at);
  const dailyQuota = await getGuestImageDailyQuota(db, { siteId, networkHash });
  const used = consumedWithinWindow ? 1 : 0;
  const pending = Math.max(status === GUEST_IMAGE_ENTITLEMENT_STATUSES.RESERVED ? 1 : 0, Number(dailyQuota.pending || 0));
  return {
    mode: "guest",
    limit: 1,
    used,
    remaining: Math.max(0, 1 - used - (pending ? 1 : 0)),
    pending,
    status: consumedWithinWindow ? status : GUEST_IMAGE_ENTITLEMENT_STATUSES.AVAILABLE,
    windowExpiresAt: consumedWithinWindow ? new Date(new Date(rows[0].consumed_at).getTime() + GUEST_IMAGE_WINDOW_MS) : null,
    networkQuotaRemaining: dailyQuota.remaining,
    networkLimit: GUEST_IMAGE_NETWORK_LIMIT,
  };
}

export async function lockGuestImageEntitlement(db, guestSessionId = "") {
  const [rows] = await db.execute(
    `SELECT guest_session_id, entitlement_status, asset_id, request_key, reserved_at, consumed_at
     FROM guest_image_entitlements
     WHERE guest_session_id = ?
     LIMIT 1
     FOR UPDATE`,
    [String(guestSessionId || "").trim()]
  );
  const row = rows[0] || null;
  if (!row) return null;
  if (row.entitlement_status === GUEST_IMAGE_ENTITLEMENT_STATUSES.CONSUMED
    && !isWithinGuestImageWindow(row.consumed_at)) {
    await db.execute(
      `UPDATE guest_image_entitlements
       SET entitlement_status = 'available',
           asset_id = NULL,
           request_key = NULL,
           reserved_at = NULL,
           consumed_at = NULL,
           updated_at = NOW(3)
       WHERE guest_session_id = ?`,
      [String(guestSessionId || "").trim()]
    );
    return {
      ...row,
      entitlement_status: GUEST_IMAGE_ENTITLEMENT_STATUSES.AVAILABLE,
      asset_id: null,
      request_key: null,
      reserved_at: null,
      consumed_at: null,
    };
  }
  return row;
}

function isWithinGuestImageWindow(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < GUEST_IMAGE_WINDOW_MS;
}

export async function reserveGuestImageEntitlement(db, {
  guestSessionId = "",
  assetId = "",
  requestKey = "",
} = {}) {
  const [result] = await db.execute(
    `UPDATE guest_image_entitlements
     SET entitlement_status = 'reserved',
         asset_id = ?,
         request_key = ?,
         reserved_at = NOW(3),
         consumed_at = NULL,
         updated_at = NOW(3)
     WHERE guest_session_id = ?
       AND entitlement_status = 'available'`,
    [assetId, requestKey || null, guestSessionId]
  );
  return Number(result.affectedRows || 0) === 1;
}

export async function consumeGuestImageEntitlementForAsset(db, assetId = "") {
  const normalizedAssetId = String(assetId || "").trim();
  const [assetRows] = await db.execute(
    `SELECT guest_session_id
     FROM chat_image_assets
     WHERE id = ?
       AND status = 'ready'
     LIMIT 1`,
    [normalizedAssetId]
  );
  const guestSessionId = String(assetRows[0]?.guest_session_id || "").trim();
  if (!guestSessionId) return { guest: false, consumed: false };
  await db.execute(
    `UPDATE guest_image_entitlements
     SET entitlement_status = 'consumed',
         consumed_at = COALESCE(consumed_at, NOW(3)),
         updated_at = NOW(3)
     WHERE guest_session_id = ?
       AND asset_id = ?
       AND entitlement_status IN ('reserved', 'consumed')`,
    [guestSessionId, normalizedAssetId]
  );
  const [rows] = await db.execute(
    `SELECT entitlement_status, asset_id
     FROM guest_image_entitlements
     WHERE guest_session_id = ?
     LIMIT 1`,
    [guestSessionId]
  );
  return {
    guest: true,
    consumed: rows[0]?.entitlement_status === GUEST_IMAGE_ENTITLEMENT_STATUSES.CONSUMED
      && String(rows[0]?.asset_id || "") === normalizedAssetId,
  };
}

export async function releaseGuestImageEntitlementForAsset(db, assetId = "") {
  const [result] = await db.execute(
    `UPDATE guest_image_entitlements e
     INNER JOIN chat_image_assets a ON a.guest_session_id = e.guest_session_id
     SET e.entitlement_status = 'available',
         e.asset_id = NULL,
         e.request_key = NULL,
         e.reserved_at = NULL,
         e.consumed_at = NULL,
         e.updated_at = NOW(3)
     WHERE a.id = ?
       AND e.asset_id = a.id
       AND e.entitlement_status = 'reserved'`,
    [String(assetId || "").trim()]
  );
  return Number(result.affectedRows || 0) > 0;
}
