import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function getAdminKitshop({ site = "", productPage = 1, productLimit = 12 } = {}) {
  const params = new URLSearchParams();
  if (site) params.set("site", site);
  params.set("productPage", String(productPage || 1));
  params.set("productLimit", String(productLimit || 12));
  const query = params.toString();
  return requestJson(`${API_ENDPOINTS.admin.kitshop}${query ? `?${query}` : ""}`).then(normalizeKitshopResult);
}

export function refreshAdminKitshop({ site = "" } = {}) {
  return requestJson(API_ENDPOINTS.admin.kitshopRefresh, {
    method: "POST",
    body: { site },
  }).then(normalizeKitshopResult);
}

function normalizeKitshopResult(result = {}) {
  return {
    ...result,
    sites: Array.isArray(result.sites) ? result.sites : [],
    site: result.site || null,
    summary: result.summary || {},
    products: Array.isArray(result.products) ? result.products : [],
    productPagination: result.productPagination || {},
    sections: Array.isArray(result.sections) ? result.sections : [],
    rules: result.rules || {},
    refresh: result.refresh || null,
  };
}
