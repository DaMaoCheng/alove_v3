import { resolveShopifyDiscountCode } from "./shopify-discount-catalog-service.js";

const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_FAILURE_COOLDOWN_MS = 60 * 1000;
const refreshPromises = new Map();
const refreshFailures = new Map();

export async function refreshDiscountOfferSnapshots(db, {
  rows = [],
  site = {},
  now = new Date(),
  resolveShopifyDiscountCodeImpl = resolveShopifyDiscountCode,
  maxAgeMs = SNAPSHOT_MAX_AGE_MS,
  failureCooldownMs = REFRESH_FAILURE_COOLDOWN_MS,
  logger = console,
} = {}) {
  const currentTime = normalizeDate(now);
  const refreshed = await Promise.all((Array.isArray(rows) ? rows : []).map(async (row) => {
    if (!shouldRefreshSnapshot(row, currentTime, maxAgeMs)) {
      return isActiveSnapshot(row, currentTime) ? row : null;
    }
    const key = `${normalizeText(site.id)}:${normalizeText(row.code).toUpperCase()}`;
    if (isRefreshCoolingDown(key, currentTime)) return null;
    let pending = refreshPromises.get(key);
    if (!pending) {
      pending = refreshDiscountSnapshot(db, row, site, resolveShopifyDiscountCodeImpl)
        .catch((error) => {
          rememberRefreshFailure(key, currentTime, failureCooldownMs);
          logger?.warn?.("[aiove] Shopify discount snapshot refresh failed", {
            siteId: normalizeText(site.id),
            code: normalizeText(row.code).toUpperCase(),
            publicCode: normalizeText(error?.publicCode || error?.code || "SHOPIFY_DISCOUNT_REFRESH_FAILED"),
          });
          return null;
        })
        .finally(() => refreshPromises.delete(key));
      refreshPromises.set(key, pending);
    }
    const next = await pending;
    return next && isActiveSnapshot(next, currentTime) ? next : null;
  }));
  return refreshed.filter(Boolean);
}

export function shouldRefreshSnapshot(row = {}, now = new Date(), maxAgeMs = SNAPSHOT_MAX_AGE_MS) {
  const currentTime = normalizeDate(now);
  const syncedAt = normalizeOptionalDate(row.shopify_synced_at);
  if (!syncedAt || currentTime.getTime() - syncedAt.getTime() >= Math.max(0, Number(maxAgeMs) || 0)) return true;
  const status = normalizeText(row.shopify_status).toUpperCase();
  const startsAt = normalizeOptionalDate(row.starts_at);
  return status === "SCHEDULED" && startsAt && startsAt.getTime() <= currentTime.getTime();
}

export function isActiveSnapshot(row = {}, now = new Date()) {
  const currentTime = normalizeDate(now);
  const startsAt = normalizeOptionalDate(row.starts_at);
  const endsAt = normalizeOptionalDate(row.ends_at);
  if (startsAt && startsAt.getTime() > currentTime.getTime()) return false;
  if (endsAt && endsAt.getTime() <= currentTime.getTime()) return false;
  return normalizeText(row.shopify_status).toUpperCase() === "ACTIVE";
}

async function refreshDiscountSnapshot(db, row, site, resolver) {
  const rule = await resolver(site, row.code);
  const startsAt = normalizeOptionalDate(rule.startsAt);
  const endsAt = normalizeOptionalDate(rule.endsAt);
  const shopifyRuleJson = rule.rule && typeof rule.rule === "object" ? JSON.stringify(rule.rule) : null;
  const [result] = await db.execute(
    `UPDATE discount_codes
     SET offer_description = ?, validity_mode = ?, starts_at = ?, ends_at = ?,
         shopify_discount_id = ?, shopify_discount_type = ?, shopify_status = ?,
         shopify_rule_json = ?, shopify_synced_at = NOW(3)
     WHERE id = ? AND site_id = ? AND code = ? AND shopify_synced_at <=> ? LIMIT 1`,
    [
      rule.offerDescription || row.offer_description || "",
      rule.validityMode || (endsAt ? "fixed" : "indefinite"),
      startsAt,
      endsAt,
      rule.shopifyDiscountId || null,
      rule.shopifyDiscountType || null,
      normalizeText(rule.shopifyStatus).toUpperCase() || null,
      shopifyRuleJson,
      row.id,
      site.id,
      row.code,
      normalizeOptionalDate(row.shopify_synced_at),
    ],
  );
  if (Number(result?.affectedRows || 0) !== 1) return null;
  return {
    ...row,
    offer_description: rule.offerDescription || row.offer_description || "",
    validity_mode: rule.validityMode || (endsAt ? "fixed" : "indefinite"),
    starts_at: startsAt,
    ends_at: endsAt,
    shopify_discount_id: rule.shopifyDiscountId || null,
    shopify_discount_type: rule.shopifyDiscountType || null,
    shopify_status: normalizeText(rule.shopifyStatus).toUpperCase(),
    shopify_rule_json: rule.rule || null,
    shopify_synced_at: new Date(),
  };
}

function isRefreshCoolingDown(key, now) {
  const retryAt = Number(refreshFailures.get(key) || 0);
  if (!retryAt) return false;
  if (retryAt <= now.getTime()) {
    refreshFailures.delete(key);
    return false;
  }
  return true;
}

function rememberRefreshFailure(key, now, cooldownMs) {
  refreshFailures.set(key, now.getTime() + Math.max(1000, Number(cooldownMs) || REFRESH_FAILURE_COOLDOWN_MS));
  if (refreshFailures.size <= 5000) return;
  for (const [failureKey, retryAt] of refreshFailures) {
    if (retryAt <= now.getTime()) refreshFailures.delete(failureKey);
  }
}

function normalizeOptionalDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}
