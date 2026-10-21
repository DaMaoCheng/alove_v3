import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminExternalEmbeds() {
  return requestJson(API_ENDPOINTS.admin.externalEmbeds).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function saveAdminExternalEmbed(siteId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.externalEmbeds}/${encodeURIComponent(String(siteId || "").trim())}`, {
    method: "PUT",
    body: payload,
  }).then((result) => ({ ...result, item: result.item || null }));
}
