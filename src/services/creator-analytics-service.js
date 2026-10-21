import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function getCreatorAnalytics(range = "30d") {
  const query = new URLSearchParams({ range: normalizeRange(range) });
  return requestJson(`${API_ENDPOINTS.creator.analytics}?${query.toString()}`);
}

function normalizeRange(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["7d", "30d", "90d"].includes(normalized) ? normalized : "30d";
}
