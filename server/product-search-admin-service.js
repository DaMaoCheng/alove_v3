import { buildProductSearchIntent } from "./product-intent-service.js";
import { PRODUCT_CANDIDATE_FETCH_LIMIT } from "./product-candidate-ranking-service.js";
import { normalizeCurrency } from "./product-normalizer.js";
import { ADMIN_PRODUCT_SEARCH_LIMIT } from "./product-search-constants.js";
import { filterProductsForAdmin } from "./product-search-match-service.js";
import { buildProductSearchQueryVariants } from "./product-search-query-service.js";
import { isInternalDemoProductApi, mapProductSearchSite, resolveAdminSearchSite } from "./product-search-site-service.js";
import {
  fetchProductSummary,
  fetchShopifySearchPageProducts,
  isShopifyPublicProductSource,
} from "./product-source-service.js";
import { assertAdminProductSearchQuery } from "./product-request-guard-service.js";

export async function searchAdminPromotionProducts({ siteId = "", query = "", limit = ADMIN_PRODUCT_SEARCH_LIMIT } = {}) {
  const normalizedQuery = assertAdminProductSearchQuery(query);
  const normalizedLimit = Math.max(1, Math.min(ADMIN_PRODUCT_SEARCH_LIMIT, Number(limit) || ADMIN_PRODUCT_SEARCH_LIMIT));
  const site = await resolveAdminSearchSite(siteId);
  if (!normalizedQuery || !site?.product_api_url || isInternalDemoProductApi(site.product_api_url)) {
    return {
      ok: true,
      items: [],
      site: mapProductSearchSite(site),
      query: normalizedQuery,
    };
  }

  const siteCurrency = normalizeCurrency(site.currency);
  let products = [];
  for (const queryVariant of buildProductSearchQueryVariants(normalizedQuery)) {
    const searchIntent = {
      ...buildProductSearchIntent(queryVariant, ""),
      query: queryVariant,
    };
    products = filterProductsForAdmin(
      await fetchProductSummary(site.product_api_url, searchIntent, {
        currency: siteCurrency,
        encryptedAccessToken: site.product_access_token_encrypted,
        maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT,
      }),
      normalizedQuery
    );
    if (!products.length && isShopifyPublicProductSource(site.product_api_url)) {
      products = filterProductsForAdmin(
        await fetchShopifySearchPageProducts(site.product_api_url, searchIntent, {
          currency: siteCurrency,
          maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT,
        }),
        normalizedQuery
      );
    }
    if (products.length) break;
  }
  products = products.slice(0, normalizedLimit);

  return {
    ok: true,
    query: normalizedQuery,
    site: mapProductSearchSite(site),
    items: products.map((product, index) => ({
      id: product.id || product.sku || product.url || product.name || `product-${index + 1}`,
      sku: product.sku || "",
      name: product.name || "",
      subtitle: product.subtitle || product.stock || "",
      price: product.price || "",
      priceWas: product.priceWas || "",
      url: product.url || "",
      imageUrl: product.imageUrl || "",
      imageUrls: product.imageUrls || [],
      stock: product.stock || "",
      sizes: product.sizes || [],
      features: product.features || [],
      position: index + 1,
    })),
  };
}
