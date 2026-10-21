import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function createProductCheckoutLink({ siteSlug = "", product = null, characterId = "", messageId = "", discountOfferId = "", selectedSizeIndex = -1, signal } = {}) {
  return requestJson(API_ENDPOINTS.products.checkoutLink, {
    method: "POST",
    signal,
    body: {
      siteSlug,
      characterId,
      messageId,
      discountOfferId,
      selectedSizeIndex,
      product: product && typeof product === "object" ? product : {},
    },
  });
}
