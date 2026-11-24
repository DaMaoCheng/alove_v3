import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

const endpoint = `${API_ENDPOINTS.admin.externalEmbeds}/promotion`;
export function getAdminExternalPromotion(siteId) {
  return requestJson(`${endpoint}?siteId=${encodeURIComponent(siteId)}`);
}
export function saveAdminExternalPromotion(siteId, action, config) {
  return requestJson(endpoint, { method: "PUT", body: { siteId, action, ...(config ? { config } : {}) } });
}
