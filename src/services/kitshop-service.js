import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function getKitshopShelves({ siteSlug = "", guestMode = false } = {}) {
  const params = new URLSearchParams();
  if (siteSlug) params.set("siteSlug", siteSlug);
  if (guestMode) params.set("guest", "1");
  const query = params.toString();
  return requestJson(`${API_ENDPOINTS.kitshop}${query ? `?${query}` : ""}`).then((result) => ({
    ...result,
    site: result?.site || null,
    shelves: Array.isArray(result?.shelves) ? result.shelves : [],
    cache: result?.cache || {},
  }));
}
