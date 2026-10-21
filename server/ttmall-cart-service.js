import { createId } from "./security.js";
import { getDbPool } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { fetchTtmallJson } from "./product-source-ttmall-client-service.js";
import { normalizeTtmallProductId } from "./product-source-ttmall-mapper.js";
import { safeString } from "./product-source-shared-service.js";
import { readActiveTtmallAccountToken, markTtmallAccountBindingStale } from "./ttmall-account-binding-service.js";
import { addTtmallCartLine, clearTtmallCart, getTtmallCart } from "./ttmall-cart-client-service.js";
import { isEnabledTtmallAccess, resolveTtmallRuntimeAccess } from "./ttmall-runtime-access-service.js";
import { assertSiteCommerceEnabled } from "./site-commerce-policy.js";

const MAX_CART_LINES = 20;
const MAX_QUANTITY = 99;
const TTMALL_CART_SYNC_TIMEOUT_MS = 15_000;
const syncFlights = new Map();

export async function syncTtmallCart({ userId = "", siteSlug = "", items = [], timeoutMs } = {}) {
  const normalizedUserId = safeString(userId);
  const normalizedSiteSlug = safeString(siteSlug).toLowerCase();
  if (!normalizedUserId || !normalizedSiteSlug) {
    throw createPublicError("购物车站点信息不完整，请重新打开商品后再试", 400, "TTMALL_CART_CONTEXT_REQUIRED");
  }
  const access = await resolveTtmallRuntimeAccess(normalizedSiteSlug);
  if (!isEnabledTtmallAccess(access)) return { ok: true, mode: "not_ttmall", itemCount: 0 };
  const { site, source } = access;
  const rows = normalizeRequestedRows(items);
  if (rows.length) assertSiteCommerceEnabled(site);
  const flightKey = `${normalizedUserId}|${site.id}|${source.cacheKey}`;
  if (syncFlights.has(flightKey)) return syncFlights.get(flightKey);
  const flight = syncOwnedTtmallCart({
    userId: normalizedUserId,
    site,
    source,
    rows,
    timeoutMs: resolveTtmallCartSyncTimeout(timeoutMs),
  });
  syncFlights.set(flightKey, flight);
  try {
    return await flight;
  } finally {
    syncFlights.delete(flightKey);
  }
}

function resolveTtmallCartSyncTimeout(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return TTMALL_CART_SYNC_TIMEOUT_MS;
  return Math.max(1_000, Math.min(30_000, Math.trunc(requested)));
}

function normalizeRequestedRows(items) {
  if (!Array.isArray(items) || items.length > MAX_CART_LINES) {
    throw createPublicError("购物车商品数量不符合要求", 400, "TTMALL_CART_LINES_INVALID");
  }
  return items.map((item) => ({
    productId: normalizeTtmallProductId(item?.product?.productId || item?.product?.id),
    selectedSizeIndex: Number.isInteger(Number(item?.product?.selectedSizeIndex)) ? Number(item.product.selectedSizeIndex) : -1,
    quantity: clampQuantity(item?.quantity),
    requestedCustomization: hasCustomization(item?.product?.customizationSelections),
  })).map((item) => {
    if (!item.productId) throw createPublicError("购物车中存在无效商品", 400, "TTMALL_CART_PRODUCT_INVALID");
    if (item.requestedCustomization) {
      throw createPublicError("This TTMall product cannot use customization in this cart yet.", 409, "TTMALL_CUSTOMIZATION_UNSUPPORTED");
    }
    return item;
  });
}

async function syncOwnedTtmallCart({ userId, site, source, rows, timeoutMs }) {
  const current = await readCartSession({ userId, siteId: site.id, sourceCacheKey: source.cacheKey });
  const boundAccount = await readActiveTtmallAccountToken({ userId, siteSlug: site.slug });
  const userToken = boundAccount?.source?.cacheKey === source.cacheKey ? boundAccount.token : "";
  const verifiedRows = [];
  let previousCartCleared = false;
  let rebuiltCartHash = "";
  try {
    if (!rows.length) {
      if (current?.cart_hash) await clearTtmallCart(source, { hash: current.cart_hash, timeoutMs, userToken });
      await deleteCartSession(current?.id);
      return { ok: true, mode: "synced", itemCount: 0 };
    }
    for (const row of rows) {
      verifiedRows.push(await resolveVerifiedCartRow(source, row, { timeoutMs }));
    }
    // This hash was created by this AIOVE user/site/source mapping. Clearing it
    // before rebuilding prevents repeated local mutations from accumulating
    // duplicate lines in the bound TTMall temporary cart.
    if (current?.cart_hash) {
      await clearTtmallCart(source, { hash: current.cart_hash, timeoutMs, userToken });
      previousCartCleared = true;
    }
    let hash = "";
    for (const verified of verifiedRows) {
      const result = await addTtmallCartLine(source, { ...verified, hash, timeoutMs, userToken });
      hash = result.hash;
    }
    if (!hash) throw new Error("TTMall cart did not return a cart hash");
    rebuiltCartHash = hash;
    const upstreamCart = await getTtmallCart(source, { hash, timeoutMs, userToken });
    if (!hasMatchingTtmallCartRows(upstreamCart.lines, verifiedRows)) {
      throw createPublicError("TTMall cart could not be verified. Please try again later.", 422, "TTMALL_CART_SYNC_FAILED");
    }
    await upsertCartSession({ id: current?.id || createId("tcs"), userId, siteId: site.id, sourceCacheKey: source.cacheKey, cartHash: hash });
    return { ok: true, mode: "synced", itemCount: upstreamCart.itemCount };
  } catch (error) {
    if (rebuiltCartHash && rebuiltCartHash !== current?.cart_hash) {
      await clearTtmallCart(source, { hash: rebuiltCartHash, timeoutMs, userToken }).catch(() => {});
    }
    if (error?.publicCode === "TTMALL_BINDING_REAUTH_REQUIRED") {
      await markTtmallAccountBindingStale({ userId, siteId: site.id });
      await deleteCartSession(current?.id);
    }
    if (previousCartCleared) await deleteCartSession(current?.id);
    if (error?.publicMessage) throw error;
    console.warn("[aiove] TTMall test cart sync failed", { name: safeString(error?.name) || "Error" });
    throw createPublicError("测试购物车暂时无法保存，请稍后再试", 422, "TTMALL_CART_SYNC_FAILED");
  }
}

function hasMatchingTtmallCartRows(actualRows = [], expectedRows = []) {
  const actual = summarizeCartRows(actualRows, (row) => row?.sku, (row) => row?.quantity);
  const expected = summarizeCartRows(expectedRows, (row) => row?.sku, (row) => row?.quantity);
  if (actual.size !== expected.size) return false;
  return [...expected].every(([sku, quantity]) => actual.get(sku) === quantity);
}

function summarizeCartRows(rows, getSku, getQuantity) {
  return (Array.isArray(rows) ? rows : []).reduce((summary, row) => {
    const sku = safeString(getSku(row));
    if (!sku) return summary;
    summary.set(sku, (summary.get(sku) || 0) + clampQuantity(getQuantity(row)));
    return summary;
  }, new Map());
}

async function resolveVerifiedCartRow(source, row, { timeoutMs }) {
  const payload = await fetchTtmallJson(source, `/v1/product/${encodeURIComponent(row.productId)}`, { timeoutMs });
  const product = payload?.data && typeof payload.data === "object" ? payload.data : null;
  if (!product || normalizeTtmallProductId(product.product_id || product.id) !== row.productId || Number(product.is_stock) === 0 || Number(product.sell_out) === 1) {
    throw createPublicError("该商品当前不可加入购物车，请重新选择", 409, "TTMALL_CART_PRODUCT_UNAVAILABLE");
  }
  const sku = resolveSelectedSku(product, row.selectedSizeIndex);
  if (!sku) throw createPublicError("请选择当前可用的尺码", 409, "TTMALL_CART_SIZE_REQUIRED");
  return { productId: row.productId, sku, quantity: row.quantity, options: [] };
}

function resolveSelectedSku(product, selectedSizeIndex) {
  const groups = Array.isArray(product?.sup_attr) ? product.sup_attr : [];
  const sizeGroup = groups.find((group) => /size/i.test(safeString(group?.name))) || groups[0];
  const values = sizeGroup?.value && typeof sizeGroup.value === "object" ? Object.entries(sizeGroup.value) : [];
  const inventory = product?.sku_list && typeof product.sku_list === "object" ? product.sku_list : {};
  if (!values.length) return safeString(product?.sku);
  const selected = values[selectedSizeIndex];
  if (!selected) return "";
  const skus = (Array.isArray(selected[1]) ? selected[1] : [selected[1]])
    .map((sku) => safeString(sku))
    .filter(Boolean);
  return skus.find((sku) => Number(inventory[sku] || 0) > 0) || "";
}

async function readCartSession({ userId, siteId, sourceCacheKey }) {
  const [rows] = await getDbPool().execute(
    `SELECT id, cart_hash FROM ttmall_cart_sessions WHERE user_id = ? AND site_id = ? AND source_cache_key = ? LIMIT 1`,
    [userId, siteId, sourceCacheKey],
  );
  return rows[0] || null;
}

async function upsertCartSession({ id, userId, siteId, sourceCacheKey, cartHash }) {
  await getDbPool().execute(
    `INSERT INTO ttmall_cart_sessions (id, user_id, site_id, source_cache_key, cart_hash)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE cart_hash = VALUES(cart_hash), updated_at = CURRENT_TIMESTAMP(3)`,
    [id, userId, siteId, sourceCacheKey, cartHash],
  );
}

async function deleteCartSession(id = "") {
  if (!safeString(id)) return;
  await getDbPool().execute("DELETE FROM ttmall_cart_sessions WHERE id = ?", [id]);
}

function hasCustomization(value) {
  return Object.values(value && typeof value === "object" ? value : {}).some((item) => safeString(item));
}

function clampQuantity(value) {
  return Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(Number(value) || 1)));
}
