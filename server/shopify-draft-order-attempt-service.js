import { getDbPool } from "./db.js";

const CREATING_ATTEMPT_STATUS = "creating";
const PENDING_ATTEMPT_STATUS = "draft_ready";
const PAID_CART_CLEARED = "paid_cart_cleared";
const PAID_CART_PRESERVED = "paid_cart_preserved";
const PAID_CLEANUP_RETRYABLE = "paid_cleanup_retryable";
const CREATION_EXPIRED = "creation_expired";
const STALE_UNSETTLED = "stale_unsettled";

export async function createPendingShopifyDraftOrderAttempt({
  id = "",
  userId = "",
  siteId = "",
  sourceCacheKey = "",
  cartIdHash = "",
  cartRevision = 0,
  snapshotHash = "",
  discount = null,
} = {}) {
  if (!isValidAttemptInput({ id, userId, siteId, sourceCacheKey, cartIdHash, cartRevision, snapshotHash })) return false;
  await getDbPool().execute(
    `INSERT INTO shopify_draft_order_attempts (
      id, user_id, site_id, source_cache_key,
      cart_id_hash, cart_revision, snapshot_hash, discount_snapshot_json, attempt_status, cart_clear_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'creating', 'pending')
    ON DUPLICATE KEY UPDATE updated_at = NOW(3)`,
    [id, userId, siteId, sourceCacheKey, cartIdHash, cartRevision, snapshotHash, serializeDraftOrderDiscount(discount)]
  );
  return true;
}

export async function saveShopifyDraftOrderAttempt({ id = "", userId = "", siteId = "", draftOrderId = "" } = {}) {
  if (!id || !userId || !siteId || !isShopifyGid("DraftOrder", draftOrderId)) return false;
  const [result] = await getDbPool().execute(
    `UPDATE shopify_draft_order_attempts
        SET shopify_draft_order_id = ?, attempt_status = ?, safe_error_code = NULL, updated_at = NOW(3)
      WHERE id = ? AND user_id = ? AND site_id = ?
        AND attempt_status = 'creating'`,
    [draftOrderId, PENDING_ATTEMPT_STATUS, id, userId, siteId]
  );
  return Number(result?.affectedRows || 0) === 1;
}

export async function readShopifyDraftOrderAttempt({ id = "", userId = "", siteId = "" } = {}) {
  if (!id || !userId || !siteId) return null;
  const [rows] = await getDbPool().execute(
    `SELECT id, shopify_draft_order_id, attempt_status, created_at
       FROM shopify_draft_order_attempts
      WHERE id = ? AND user_id = ? AND site_id = ?
      LIMIT 1`,
    [id, userId, siteId],
  );
  return rows[0] || null;
}

export async function listReconcilableShopifyDraftOrderAttempts({ userId = "", siteId = "", sourceCacheKey = "", currentAttemptId = "", limit = 8 } = {}) {
  const max = Math.max(1, Math.min(8, Math.trunc(Number(limit) || 0)));
  const [rows] = await getDbPool().execute(
    `SELECT id, shopify_draft_order_id, shopify_order_id, cart_id_hash, cart_revision,
            snapshot_hash, discount_snapshot_json, attempt_status, cart_clear_status, created_at, updated_at
       FROM shopify_draft_order_attempts
      WHERE user_id = ? AND site_id = ? AND source_cache_key = ?
        AND attempt_status IN (?, ?)
      ORDER BY CASE WHEN id = ? THEN 0 WHEN attempt_status = ? THEN 1 ELSE 2 END, updated_at DESC
      LIMIT ${max}`,
    [userId, siteId, sourceCacheKey, PENDING_ATTEMPT_STATUS, PAID_CLEANUP_RETRYABLE, currentAttemptId, PAID_CLEANUP_RETRYABLE]
  );
  return rows || [];
}

export async function listExpiredShopifyDraftOrderCreations({ userId = "", siteId = "", sourceCacheKey = "", excludeAttemptId = "", maxAgeMinutes = 15, limit = 4 } = {}) {
  const max = Math.max(1, Math.min(4, Math.trunc(Number(limit) || 0)));
  const age = Math.max(5, Math.min(24 * 60, Math.trunc(Number(maxAgeMinutes) || 0)));
  const [rows] = await getDbPool().execute(
    `SELECT id
       FROM shopify_draft_order_attempts
      WHERE user_id = ? AND site_id = ? AND source_cache_key = ?
        AND attempt_status = ?
        AND (shopify_draft_order_id IS NULL OR shopify_draft_order_id = '')
        AND (? = '' OR id <> ?)
        AND created_at < DATE_SUB(NOW(3), INTERVAL ${age} MINUTE)
      ORDER BY created_at ASC
      LIMIT ${max}`,
    [userId, siteId, sourceCacheKey, CREATING_ATTEMPT_STATUS, excludeAttemptId, excludeAttemptId],
  );
  return rows || [];
}

function serializeDraftOrderDiscount(value = null) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const unique = new Map();
  for (const source of rows) {
    const code = String(source?.code || "").trim().toUpperCase().slice(0, 64);
    if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code) || unique.has(code)) continue;
    unique.set(code, { offerId: String(source?.offerId || "").trim().slice(0, 128), code });
  }
  const discounts = [...unique.values()].sort((left, right) => left.code.localeCompare(right.code)).slice(0, 5);
  return discounts.length ? JSON.stringify(discounts) : null;
}

export async function markShopifyDraftOrderPaid({ id = "", userId = "", siteId = "", orderId = "" } = {}) {
  if (!id || !userId || !siteId || !isShopifyGid("Order", orderId)) return false;
  const [result] = await getDbPool().execute(
    `UPDATE shopify_draft_order_attempts
        SET shopify_order_id = ?, attempt_status = ?, cart_clear_status = 'retryable', last_checked_at = NOW(3), detected_at = COALESCE(detected_at, NOW(3)), safe_error_code = NULL, updated_at = NOW(3)
      WHERE id = ? AND user_id = ? AND site_id = ?
        AND attempt_status = ?`,
    [orderId, PAID_CLEANUP_RETRYABLE, id, userId, siteId, PENDING_ATTEMPT_STATUS]
  );
  return Number(result?.affectedRows || 0) === 1;
}

export async function markShopifyDraftOrderAttemptChecked({ id = "", userId = "", siteId = "", safeErrorCode = "" } = {}) {
  if (!id || !userId || !siteId) return false;
  await getDbPool().execute(
    `UPDATE shopify_draft_order_attempts
        SET last_checked_at = NOW(3), safe_error_code = ?, updated_at = NOW(3)
      WHERE id = ? AND user_id = ? AND site_id = ?
        AND attempt_status = ?`,
    [String(safeErrorCode || "").slice(0, 64) || null, id, userId, siteId, PENDING_ATTEMPT_STATUS]
  );
  return true;
}

export async function markShopifyDraftOrderAttemptFailed({ id = "", userId = "", siteId = "", safeErrorCode = "SHOPIFY_DRAFT_ORDER_CREATION_EXPIRED" } = {}) {
  return closeShopifyDraftOrderAttempt({
    id,
    userId,
    siteId,
    expectedStatus: CREATING_ATTEMPT_STATUS,
    status: CREATION_EXPIRED,
    cartStatus: "not_created",
    safeErrorCode,
  });
}

export async function markShopifyDraftOrderStaleUnsettled({ id = "", userId = "", siteId = "", safeErrorCode = "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED" } = {}) {
  return closeShopifyDraftOrderAttempt({
    id,
    userId,
    siteId,
    expectedStatus: PENDING_ATTEMPT_STATUS,
    status: STALE_UNSETTLED,
    cartStatus: "preserved",
    safeErrorCode,
  });
}

export async function closeShopifyDraftOrderAttempt({ id = "", userId = "", siteId = "", expectedStatus = "", status = "", cartStatus = "", safeErrorCode = "" } = {}) {
  if (!id || !userId || !siteId || !expectedStatus || !status || !cartStatus) return false;
  const [result] = await getDbPool().execute(
    `UPDATE shopify_draft_order_attempts
        SET attempt_status = ?, cart_clear_status = ?, reconciled_at = NOW(3), last_checked_at = NOW(3), safe_error_code = ?, updated_at = NOW(3)
      WHERE id = ? AND user_id = ? AND site_id = ? AND attempt_status = ?`,
    [status, cartStatus, String(safeErrorCode || "").slice(0, 64) || null, id, userId, siteId, expectedStatus],
  );
  return Number(result?.affectedRows || 0) === 1;
}

export async function markShopifyDraftOrderCartCleared({ id = "", userId = "", siteId = "" } = {}) {
  return updateSettlementStatus({ id, userId, siteId, status: PAID_CART_CLEARED });
}

export async function markShopifyDraftOrderCartPreserved({ id = "", userId = "", siteId = "" } = {}) {
  return updateSettlementStatus({ id, userId, siteId, status: PAID_CART_PRESERVED });
}

async function updateSettlementStatus({ id, userId, siteId, status }) {
  if (!id || !userId || !siteId) return false;
  const [result] = await getDbPool().execute(
    `UPDATE shopify_draft_order_attempts
        SET attempt_status = ?, cart_clear_status = ?, reconciled_at = NOW(3), last_checked_at = NOW(3), safe_error_code = NULL, updated_at = NOW(3)
      WHERE id = ? AND user_id = ? AND site_id = ?
        AND attempt_status = ?`,
    [status, status === PAID_CART_CLEARED ? "cleared" : "preserved", id, userId, siteId, PAID_CLEANUP_RETRYABLE]
  );
  return Number(result?.affectedRows || 0) === 1;
}

function isValidAttemptInput({ id, userId, siteId, sourceCacheKey, cartIdHash, cartRevision, snapshotHash }) {
  return Boolean(id && userId && siteId && sourceCacheKey
    && /^[a-f0-9]{64}$/.test(String(cartIdHash || ""))
    && Number.isSafeInteger(Number(cartRevision)) && Number(cartRevision) > 0
    && /^[a-f0-9]{64}$/.test(String(snapshotHash || "")));
}

function isShopifyGid(type, value) {
  return new RegExp(`^gid://shopify/${type}/\\d+$`).test(String(value || ""));
}
