import { readAuthToken, sendJson } from "./http-utils.js";
import { scheduleKitshopRefresh } from "./kitshop-background-refresh-service.js";
import { getKitshopShelves } from "./kitshop-service.js";
import { assertGuestBrowsingEnabled } from "./guest-chat-service.js";
import { toGuestSafeKitshopResult } from "./guest-product-sanitizer.js";
import { requireAuth } from "./auth-service.js";
import { buildGuestNetworkHash, consumeGuestNetworkQuota } from "./guest-network-rate-limit-service.js";
import { withTransaction } from "./db.js";
import { assertPublicAppOrigin } from "./request-origin-service.js";
import { consumeAuthenticatedProductRequestQuota, resolveProductRequestSiteSlug } from "./product-request-guard-service.js";
import { toClientKitshopResult } from "./product-response-sanitizer.js";
import { createProductCatalogAnalyticsReceipt } from "./product-search-analytics-receipt-service.js";
import { markServerProductOrigins } from "./product-source-provenance.js";

export async function handleKitshopRoute(req, res, { path, requestUrl }) {
  if (path === "/api/kitshop" && req.method === "GET") {
    const requestedSiteSlug = requestUrl.searchParams.get("siteSlug") || "";
    const guestRequested = requestUrl.searchParams.get("guest") === "1";
    const authToken = readAuthToken(req);
    const user = authToken ? await requireAuth(req, readAuthToken) : null;
    if (!guestRequested && !user) await requireAuth(req, readAuthToken);
    const siteSlug = resolveProductRequestSiteSlug(user, requestedSiteSlug);
    let releaseProductQuota = null;
    if (!user) {
      assertPublicAppOrigin(req);
      const guestSite = await assertGuestBrowsingEnabled(siteSlug);
      await withTransaction((db) => consumeGuestNetworkQuota(db, {
        networkHash: buildGuestNetworkHash(req),
        siteId: guestSite.id,
        action: "product_search",
      }));
    } else {
      releaseProductQuota = consumeAuthenticatedProductRequestQuota(user, siteSlug);
    }
    try {
      const result = await getKitshopShelves({
        siteSlug,
        allowRefresh: false,
        strictSite: true,
      });
      if (user && result.cache?.needsRefresh && result.cache?.canRefresh) scheduleKitshopRefresh(siteSlug || result.site?.slug || "");
      const resultWithOrigins = markServerProductOrigins(result, (result.shelves || []).flatMap((shelf) => shelf.items || []));
      sendJson(res, 200, user ? toClientKitshopResult(addKitshopAnalyticsReceipts(resultWithOrigins, user)) : toGuestSafeKitshopResult(resultWithOrigins));
    } finally {
      releaseProductQuota?.();
    }
    return true;
  }
  return false;
}

function addKitshopAnalyticsReceipts(result = {}, user = {}) {
  const site = result.site || {};
  return {
    ...result,
    shelves: (Array.isArray(result.shelves) ? result.shelves : []).map((shelf) => ({
      ...shelf,
      items: (Array.isArray(shelf?.items) ? shelf.items : []).map((product) => ({
        ...product,
        analytics: {
          ...(product.analytics || {}),
          catalogReceipt: createProductCatalogAnalyticsReceipt({
            userId: user.id,
            siteId: site.id || user.site_id,
            siteSlug: site.slug || user.site_slug,
            product,
            source: "kitshop",
          }),
        },
      })),
    })),
  };
}
