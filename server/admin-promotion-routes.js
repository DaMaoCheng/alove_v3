import { readJson, sendJson } from "./http-utils.js";
import { searchAdminPromotionProducts } from "./product-search-service.js";
import { createPromotionCampaign, listPromotionCampaigns, updatePromotionCampaign } from "./promotion-campaign-service.js";
import { ADMIN_SCOPES, requireAdmin } from "./route-utils.js";
import { assertAdminProductSearchQuery, consumeAdminProductSearchQuota } from "./product-request-guard-service.js";

export async function handleAdminPromotionRoute(req, res, { path, requestUrl }) {
  if (req.method === "GET" && path === "/api/admin/promotion-campaigns") {
    await requireAdmin(req);
    sendJson(res, 200, await listPromotionCampaigns({
      status: requestUrl.searchParams.get("status"),
      site: requestUrl.searchParams.get("site"),
      query: requestUrl.searchParams.get("query"),
    }));
    return true;
  }
  if (req.method === "GET" && path === "/api/admin/promotion-campaigns/products") {
    const admin = await requireAdmin(req, ADMIN_SCOPES.PROMOTIONS_WRITE);
    const siteId = requestUrl.searchParams.get("siteId") || requestUrl.searchParams.get("site") || "";
    const query = assertAdminProductSearchQuery(requestUrl.searchParams.get("query") || requestUrl.searchParams.get("q") || "");
    const releaseProductQuota = consumeAdminProductSearchQuota(admin, siteId);
    try {
      sendJson(res, 200, await searchAdminPromotionProducts({
        siteId,
        query,
        limit: requestUrl.searchParams.get("limit") || 8,
      }));
    } finally {
      releaseProductQuota();
    }
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/promotion-campaigns") {
    await requireAdmin(req, ADMIN_SCOPES.PROMOTIONS_WRITE);
    sendJson(res, 201, await createPromotionCampaign(await readJson(req, 128 * 1024)));
    return true;
  }
  const promotionCampaignMatch = path.match(/^\/api\/admin\/promotion-campaigns\/([^/]+)$/);
  if (req.method === "PATCH" && promotionCampaignMatch) {
    await requireAdmin(req, ADMIN_SCOPES.PROMOTIONS_WRITE);
    sendJson(res, 200, await updatePromotionCampaign(decodeURIComponent(promotionCampaignMatch[1]), await readJson(req, 128 * 1024)));
    return true;
  }
  return false;
}
