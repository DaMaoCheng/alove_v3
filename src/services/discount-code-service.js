import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminDiscountCodes({ query = "", site = "", ownershipType = "", status = "" } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (site) params.set("site", site);
  if (ownershipType) params.set("ownershipType", ownershipType);
  if (status) params.set("status", status);
  const suffix = params.size ? `?${params.toString()}` : "";
  return requestJson(`${API_ENDPOINTS.admin.discountCodes}${suffix}`).then(normalizeList);
}

export function getAdminDiscountCodeOptions() {
  return requestJson(API_ENDPOINTS.admin.discountCodeOptions).then((result) => ({
    ...result,
    sites: Array.isArray(result.sites) ? result.sites : [],
    creators: Array.isArray(result.creators) ? result.creators : [],
  }));
}

export function searchAdminShopifyDiscountCodes(siteId = "", query = "") {
  const params = new URLSearchParams({ siteId, query });
  return requestJson(`${API_ENDPOINTS.admin.discountCodeShopifySearch}?${params.toString()}`).then(normalizeList);
}

export function createAdminDiscountCode(payload) {
  return requestJson(API_ENDPOINTS.admin.discountCodes, { method: "POST", body: payload });
}

export function updateAdminDiscountCode(discountCodeId, payload) {
  const id = encodeURIComponent(String(discountCodeId || "").trim());
  return requestJson(`${API_ENDPOINTS.admin.discountCodes}/${id}`, { method: "PATCH", body: payload });
}

function normalizeList(result) {
  return { ...result, items: Array.isArray(result.items) ? result.items : [] };
}
