import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminCharacters({ query = "", type = "" } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("query", String(query || "").trim());
  if (type) params.set("type", String(type || "").trim());
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson(`${API_ENDPOINTS.admin.characters}${suffix}`).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
  }));
}

export function createAdminCharacter(payload) {
  return requestJson(API_ENDPOINTS.admin.characters, {
    method: "POST",
    body: payload,
  }).then((result) => ({
    ...result,
    character: result.character || result.item || null,
  }));
}

export function updateAdminCharacterSettings(characterId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.characters}/${encodeURIComponent(String(characterId || "").trim())}/settings`, {
    method: "PATCH",
    body: payload,
  }).then((result) => ({
    ...result,
    character: result.character || result.item || null,
  }));
}
