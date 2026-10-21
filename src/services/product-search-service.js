import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function searchSiteProducts({ siteSlug = "", query = "", limit = 2, guestMode = false } = {}) {
  const params = new URLSearchParams();
  if (siteSlug) params.set("siteSlug", siteSlug);
  if (query) params.set("query", query);
  params.set("limit", String(Math.max(1, Math.min(10, Number(limit) || 2))));
  return requestJson(`${API_ENDPOINTS.products.search}?${params.toString()}`, { notifyUnauthorized: !guestMode }).then((result) => ({
    ...result,
    items: Array.isArray(result.items) ? result.items : [],
    site: result.site || null,
  }));
}

export function resolveProductCheckoutProduct({ siteSlug = "", product = null, characterId = "", messageId = "" } = {}) {
  return requestJson(API_ENDPOINTS.products.resolve, {
    method: "POST",
    body: {
      siteSlug,
      characterId,
      messageId,
      product: product && typeof product === "object" ? product : {},
    },
  }).then((result) => ({
    ...result,
    item: result?.item && typeof result.item === "object" ? result.item : null,
    site: result?.site || null,
  }));
}
