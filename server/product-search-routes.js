import { readJson, sendJson } from "./http-utils.js";
import { DEFAULT_PRODUCT_SEARCH_LIMIT } from "./product-search-constants.js";
import { searchSiteProducts } from "./product-search-public-service.js";
import { resolveProductCheckoutProduct } from "./product-checkout-resolver-service.js";
import { getOptionalRequestUser } from "./request-user-service.js";
import { assertGuestBrowsingEnabled } from "./guest-chat-service.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { toGuestSafeProductSearchResult, toGuestSafeResolvedProduct } from "./guest-product-sanitizer.js";
import { buildGuestNetworkHash, consumeGuestNetworkQuota } from "./guest-network-rate-limit-service.js";
import { getDbPool, withTransaction } from "./db.js";
import { resolveCharacterDiscountOffers } from "./discount-code-eligibility-service.js";
import { createPublicError } from "./public-error-utils.js";
import { consumeAuthenticatedProductRequestQuota, resolveProductRequestSiteSlug } from "./product-request-guard-service.js";
import { toClientProductSearchResult, toClientResolvedProduct } from "./product-response-sanitizer.js";
import { createProductSearchAnalyticsReceipt } from "./product-search-analytics-receipt-service.js";

export async function handleProductSearchRoute(req, res, { path, requestUrl }) {
  if (path === "/api/products/search" && req.method === "GET") {
    const requestedSiteSlug = requestUrl.searchParams.get("siteSlug") || "";
    const user = await getOptionalRequestUser(req);
    const siteSlug = resolveProductRequestSiteSlug(user, requestedSiteSlug);
    const query = requestUrl.searchParams.get("query") || requestUrl.searchParams.get("q") || "";
    let releaseProductQuota = null;
    if (!user && String(query).trim().length > 160) throw createPublicError("Search text is too long.", 400);
    if (!user) {
      assertPublicAppOrigin(req);
      const guestSite = await assertGuestBrowsingEnabled(siteSlug);
      await consumeGuestProductNetworkQuota({
        networkHash: buildGuestNetworkHash(req),
        siteId: guestSite.id,
        action: "product_search",
      });
    } else {
      releaseProductQuota = consumeAuthenticatedProductRequestQuota(user, siteSlug);
    }
    try {
      const result = await searchSiteProducts({
        siteSlug,
        query,
        limit: requestUrl.searchParams.get("limit") || DEFAULT_PRODUCT_SEARCH_LIMIT,
        strictSite: true,
      });
      sendJson(res, 200, user
        ? toClientProductSearchResult(addSearchAnalyticsReceipts(result, user))
        : toGuestSafeProductSearchResult(result));
    } finally {
      releaseProductQuota?.();
    }
    return true;
  }
  if (path === "/api/products/resolve" && req.method === "POST") {
    const body = await readJson(req, 128 * 1024).catch(() => ({}));
    const requestedSiteSlug = body.siteSlug || body.site_slug || body.product?.siteSlug || "";
    const user = await getOptionalRequestUser(req);
    const siteSlug = resolveProductRequestSiteSlug(user, requestedSiteSlug);
    let releaseResolveQuota = null;
    if (!user) {
      assertPublicAppOrigin(req);
      const guestSite = await assertGuestBrowsingEnabled(siteSlug);
      await consumeGuestProductNetworkQuota({
        networkHash: buildGuestNetworkHash(req),
        siteId: guestSite.id,
        action: "product_search",
      });
    } else {
      releaseResolveQuota = consumeAuthenticatedProductRequestQuota(user, siteSlug);
    }
    try {
      const result = await resolveProductCheckoutProduct({
        siteSlug,
        product: body.product,
        strictSite: true,
      });
      if (user) {
        const characterId = body.characterId || body.character_id || body.product?.characterId || body.product?.character_id || "";
        if (String(characterId || "").trim()) {
          const messageId = body.messageId || body.message_id || body.product?.messageId || body.product?.message_id || "";
          if (!String(messageId).trim()) {
            throw createPublicError("缺少商品消息上下文", 403, "DISCOUNT_CODE_CONTEXT_FORBIDDEN");
          }
          const offers = await resolveCharacterDiscountOffers(getDbPool(), {
            userId: user.id,
            characterId,
            messageId,
            siteId: result.site?.id || user.site_id || "",
          });
          result.item = {
            ...(result.item || {}),
            discountOffers: offers.offers,
          };
        }
      }
      sendJson(res, 200, user ? toClientResolvedProduct(result) : toGuestSafeResolvedProduct(result));
    } finally {
      releaseResolveQuota?.();
    }
    return true;
  }
  return false;
}

const GUEST_PRODUCT_QUOTA_DEADLOCK_RETRY_DELAYS_MS = [20, 60];

export async function consumeGuestProductNetworkQuota({
  networkHash = "",
  siteId = "",
  action = "product_search",
  withTransactionFn = withTransaction,
  consumeQuotaFn = consumeGuestNetworkQuota,
  sleepFn = sleep,
} = {}) {
  let lastDeadlock = null;
  for (let attempt = 0; attempt <= GUEST_PRODUCT_QUOTA_DEADLOCK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await withTransactionFn((db) => consumeQuotaFn(db, { networkHash, siteId, action }));
    } catch (error) {
      if (!isGuestProductQuotaDeadlock(error)) throw error;
      lastDeadlock = error;
      if (attempt >= GUEST_PRODUCT_QUOTA_DEADLOCK_RETRY_DELAYS_MS.length) break;
      await sleepFn(GUEST_PRODUCT_QUOTA_DEADLOCK_RETRY_DELAYS_MS[attempt]);
    }
  }

  const unavailable = createPublicError("Guest traffic is busy. Please try again shortly.", 503, "GUEST_PRODUCT_QUOTA_DEADLOCK");
  unavailable.cause = lastDeadlock || undefined;
  throw unavailable;
}

export function isGuestProductQuotaDeadlock(error) {
  return error?.code === "ER_LOCK_DEADLOCK"
    || Number(error?.errno) === 1213
    || String(error?.sqlState || "") === "40001";
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayMs || 0))));
}

function addSearchAnalyticsReceipts(result = {}, user = {}) {
  const site = result.site || {};
  return {
    ...result,
    items: (Array.isArray(result.items) ? result.items : []).map((product) => ({
      ...product,
      analytics: {
        ...(product.analytics || {}),
        searchReceipt: createProductSearchAnalyticsReceipt({
          userId: user.id,
          siteId: site.id || user.site_id,
          siteSlug: site.slug || user.site_slug,
          product,
        }),
      },
    })),
  };
}
