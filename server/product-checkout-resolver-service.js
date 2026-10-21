import { buildProductSearchIntent } from "./product-intent-service.js";
import { PRODUCT_CANDIDATE_FETCH_LIMIT } from "./product-candidate-ranking-service.js";
import { normalizeCurrency } from "./product-normalizer.js";
import {
  buildCheckoutResolveQueries,
  extractProductHandle,
  findResolvedCheckoutProduct,
  mergeResolvedCheckoutProduct,
} from "./product-search-match-service.js";
import { isInternalDemoProductApi, mapProductSearchSite, resolveSearchSite } from "./product-search-site-service.js";
import {
  fetchProductSummary,
  extractTtmallProductId,
  fetchTtmallProductById,
  fetchShopifySearchPageProducts,
  isTtmallProductSource,
  isShopifyPublicProductSource,
} from "./product-source-service.js";
import { markServerProductOrigins } from "./product-source-provenance.js";
import { fetchShopifyCustomizationOptions } from "./product-customization-service.js";
import { isShopifyAdminProductSource } from "./product-source-shopify-admin-service.js";
import { resolveTrustedCheckoutStorefrontUrl } from "./shopify-discount-link-service.js";
import { fetchShopifyPublicProductByUrl } from "./product-source-shopify-public-service.js";

export function isSameResolvedProductIdentity(target = {}, candidate = {}) {
  for (const product of [target, candidate]) {
    if (product.productId && product.id && String(product.productId).trim() !== String(product.id).trim()) return false;
  }
  const targetId = String(target.productId || target.id || "").trim();
  const candidateId = String(candidate.productId || candidate.id || "").trim();
  if (targetId && candidateId) return targetId === candidateId;
  try {
    const left = new URL(String(target.url || ""));
    const right = new URL(String(candidate.url || ""));
    return ["https:", "http:"].includes(left.protocol) && left.origin === right.origin
      && left.pathname === right.pathname && left.search === right.search;
  } catch { return false; }
}

export async function resolveProductCheckoutProduct({ siteSlug = "", product = null, strictSite = false, exactProduct = false } = {}, {
  resolveSite = resolveSearchSite, fetchById = fetchTtmallProductById, fetchProducts = fetchProductSummary, fetchPublicByUrl = fetchShopifyPublicProductByUrl,
} = {}) {
  const normalizedProduct = product && typeof product === "object" ? product : {};
  const site = await resolveSite(siteSlug || normalizedProduct.siteSlug || "", { allowDefault: !strictSite });
  if (!site) return { ok: true, query: "", site: null, item: {}, resolvedFromSource: false };
  const mappedSite = mapProductSearchSite(site);
  const productApiUrl = site?.product_api_url || "";
  if (!productApiUrl || isInternalDemoProductApi(productApiUrl)) {
    return {
      ok: true,
      query: "",
      site: mappedSite,
      item: attachSitePaymentMethods(stripUntrustedSizeChart(normalizedProduct), mappedSite),
      resolvedFromSource: false,
    };
  }

  const siteCurrency = normalizeCurrency(site.currency);
  const queries = buildCheckoutResolveQueries(normalizedProduct);
  const productHandle = extractProductHandle(normalizedProduct.url);
  const ttmallProductId = isTtmallProductSource(productApiUrl)
    ? (extractTtmallProductId(normalizedProduct.url) || normalizedProduct.productId || normalizedProduct.id || "")
    : "";
  const unresolved = () => ({ ok: true, query: "", site: mappedSite, item: attachSitePaymentMethods(stripUntrustedSizeChart(normalizedProduct), mappedSite), resolvedFromSource: false });
  if (exactProduct && (!isSameResolvedProductIdentity(normalizedProduct, normalizedProduct)
    || (ttmallProductId && (normalizedProduct.productId || normalizedProduct.id) && String(normalizedProduct.productId || normalizedProduct.id) !== String(ttmallProductId)))) return unresolved();
  let matched = ttmallProductId
    ? await fetchById(productApiUrl, ttmallProductId, {
        currency: siteCurrency,
        throwOnError: false,
      })
    : null;
  if (exactProduct && isShopifyPublicProductSource(productApiUrl) && normalizedProduct.url) {
    matched = await fetchPublicByUrl(productApiUrl, normalizedProduct.url, { currency: siteCurrency });
  }
  let resolvedQuery = matched ? String(ttmallProductId) : "";
  if (exactProduct && matched && !isSameResolvedProductIdentity(normalizedProduct, matched)) matched = null;
  const exactQuery = productHandle || String(normalizedProduct.productId || normalizedProduct.id || "").trim();
  // Exact sizing lookups never browse generic catalogues or compensate with
  // SKU/title search. Admin handles are queried once; public handles use detail.
  const recallQueries = exactProduct ? (isShopifyAdminProductSource(productApiUrl) && productHandle ? [exactQuery] : []) : queries;
  for (const query of matched ? [] : recallQueries) {
    const searchIntent = {
      ...buildProductSearchIntent(query, ""),
      productHandle: query === productHandle ? productHandle : "",
    };
    let products = await fetchProducts(productApiUrl, searchIntent, {
      currency: siteCurrency,
      encryptedAccessToken: site.product_access_token_encrypted,
      maxProducts: exactProduct ? 1 : PRODUCT_CANDIDATE_FETCH_LIMIT,
    });
    if (!exactProduct && !products.length && isShopifyPublicProductSource(productApiUrl)) {
      products = await fetchShopifySearchPageProducts(productApiUrl, searchIntent, {
        currency: siteCurrency,
        maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT,
      });
    }
    matched = exactProduct ? products.find((candidate) => isSameResolvedProductIdentity(normalizedProduct, candidate)) || null : findResolvedCheckoutProduct(products, normalizedProduct);
    if (matched) {
      resolvedQuery = query;
      if (!exactProduct && (isShopifyAdminProductSource(productApiUrl) || isShopifyPublicProductSource(productApiUrl))) {
        const storefrontUrl = mappedSite?.storefrontUrl || "";
        matched = {
          ...matched,
          customizationOptions: matched.customizationOptions?.length
            ? matched.customizationOptions
            : await fetchShopifyCustomizationOptions(matched.url || storefrontUrl, { timeoutMs: undefined }),
        };
      }
      break;
    }
  }

  if (matched) {
    const trustedStorefrontUrl = resolveTrustedCheckoutStorefrontUrl(mappedSite, matched);
    const checkoutSite = trustedStorefrontUrl
      ? { ...mappedSite, storefrontUrl: trustedStorefrontUrl }
      : mappedSite;
    const sourceItem = attachSitePaymentMethods(matched, mappedSite);
    return markServerProductOrigins({
      ok: true,
      query: resolvedQuery,
      site: checkoutSite,
      item: attachSitePaymentMethods(mergeResolvedCheckoutProduct(normalizedProduct, matched), checkoutSite),
      sourceItem,
      resolvedFromSource: true,
    }, [sourceItem]);
  }

  return {
    ok: true,
    query: queries[0] || "",
    site: mappedSite,
    item: attachSitePaymentMethods(stripUntrustedSizeChart(normalizedProduct), mappedSite),
    resolvedFromSource: false,
  };
}

function attachSitePaymentMethods(product = {}, site = null) {
  const productMethods = Array.isArray(product.paymentMethods) ? product.paymentMethods : [];
  const siteMethods = Array.isArray(site?.paymentMethods) ? site.paymentMethods : [];
  return {
    ...product,
    paymentMethods: productMethods.length ? productMethods : siteMethods,
  };
}

function stripUntrustedSizeChart(product = {}) {
  return {
    ...product,
    sizeChart: null,
    sizeChartResolved: false,
  };
}
