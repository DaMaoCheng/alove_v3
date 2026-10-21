import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function recordProductAnalyticsEvent(payload = {}, { notifyUnauthorized = true } = {}) {
  return requestJson(API_ENDPOINTS.analytics.productEvents, {
    method: "POST",
    body: payload,
    notifyUnauthorized,
  }).catch(() => ({ ok: false }));
}

export function getAdminProductAnalyticsOverview({ range = "7d", site = "all" } = {}) {
  const params = new URLSearchParams();
  params.set("range", range || "7d");
  params.set("site", site || "all");
  return requestJson(`${API_ENDPOINTS.admin.productAnalyticsOverview}?${params.toString()}`).then((result) => ({
    ...result,
    summary: result.summary || {},
    products: Array.isArray(result.products) ? result.products : [],
    sites: Array.isArray(result.sites) ? result.sites : [],
  }));
}
