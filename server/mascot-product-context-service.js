import {
  PRODUCT_TRIGGER_QUICK,
  buildProductSearchIntent,
  buildRecentProductContext,
  filterProductsByIntent,
  normalizeProductTrigger,
} from "./product-intent-service.js";
import { PRODUCT_CANDIDATE_FETCH_LIMIT, prepareProductCandidates } from "./product-candidate-ranking-service.js";
import { fetchProductSummary } from "./product-source-service.js";
import { normalizeCurrency } from "./product-normalizer.js";
import {
  canCharacterSendProductContext,
  resolveProductRecommendationSite,
} from "./product-recommendation-site-service.js";

export { PRODUCT_TRIGGER_QUICK };

export async function buildMascotProductContext(db, { character = {}, userId = "", userText = "", productTrigger = "", recentMessages = [] } = {}) {
  if (!canCharacterSendProductContext(character)) return null;
  const explicitTrigger = normalizeProductTrigger(productTrigger);
  const recentProductContext = buildRecentProductContext(recentMessages);
  const searchIntent = buildProductSearchIntent(userText, explicitTrigger, { recentProductContext });
  if (!explicitTrigger && !searchIntent.shouldLoadProductContext) return null;

  const site = await resolveProductRecommendationSite(db, { character, userId });
  if (!site?.product_api_url) return null;

  const siteCurrency = normalizeCurrency(site.currency);
  let products = filterProductsByIntent(
    await fetchProductSummary(site.product_api_url, searchIntent, {
      currency: siteCurrency,
      encryptedAccessToken: site.product_access_token_encrypted,
      maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT,
    }),
    searchIntent
  );
  products = prepareProductCandidates(products, { searchIntent, limit: 5 });
  if (!products.length) return null;

  return {
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency,
    productApiUrl: site.product_api_url || "",
    searchIntent,
    products,
  };
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
