import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function fetchChatQuickReplies(characterId) {
  const normalizedId = encodeURIComponent(String(characterId || "").trim());
  const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return requestJson(`${API_ENDPOINTS.characters.quickReplies}/${normalizedId}/quick-replies?_=${encodeURIComponent(cacheBust)}`).then((result) => ({
    ...result,
    quickReplies: Array.isArray(result.quickReplies) ? result.quickReplies : [],
  }));
}
