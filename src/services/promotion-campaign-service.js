import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminPromotionCampaigns({ status = "", site = "", query = "" } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (site) params.set("site", site);
  if (query) params.set("query", query);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson(`${API_ENDPOINTS.admin.promotionCampaigns}${suffix}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function createAdminPromotionCampaign(payload) {
  return requestJson(API_ENDPOINTS.admin.promotionCampaigns, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function updateAdminPromotionCampaign(campaignId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.promotionCampaigns}/${encodeURIComponent(String(campaignId || "").trim())}`, {
    method: "PATCH",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function searchAdminPromotionProducts({ siteId = "", query = "", limit = 8 } = {}) {
  const params = new URLSearchParams();
  if (siteId) params.set("siteId", siteId);
  if (query) params.set("query", query);
  params.set("limit", String(Math.max(1, Math.min(8, Number(limit) || 8))));
  return requestJson(`${API_ENDPOINTS.admin.promotionCampaignProducts}?${params.toString()}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
    site: result.site || null,
  }));
}
