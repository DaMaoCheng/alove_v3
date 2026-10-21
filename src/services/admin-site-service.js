import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminSites() {
  return requestJson(API_ENDPOINTS.admin.sites).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function createAdminSite(payload) {
  return requestJson(API_ENDPOINTS.admin.sites, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function updateAdminSite(siteId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.sites}/${encodeURIComponent(String(siteId || "").trim())}`, {
    method: "PATCH",
    body: payload,
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function setDefaultAdminSite(siteId) {
  return requestJson(`${API_ENDPOINTS.admin.sites}/${encodeURIComponent(String(siteId || "").trim())}/default`, {
    method: "PATCH",
  }).then((result) => ({
    ...result,
    item: result.item || null,
  }));
}

export function searchAdminGeoRegions(query) {
  const params = new URLSearchParams({ query: String(query || "").trim() });
  return requestJson(`${API_ENDPOINTS.admin.geoRegionsSearch}?${params.toString()}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
    regions: Array.isArray(result.regions) ? result.regions : [],
  }));
}
