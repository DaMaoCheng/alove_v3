import { alternativeProductsForSearch, bindProductAlternativeContext } from './product-alternative-service.js';
import { buildDisplayedProductReferenceContext } from './product-displayed-reference-service.js';
import { mergeReplyCommerceContext } from "./chat-reply-boundary-service.js";
import { hasPendingProductRequest, productScopeHistory } from "./product-request-scope-service.js";
import {
  buildProductSearchIntent,
  buildRecentProductContext,
  filterProductsByRequestedSizes,
  filterProductsByIntent,
  findRecentProductMessage,
  isExplicitProductSizingSearch,
  isProductImageCardRequest,
  isRecentProductConversationActive,
  resolveProductSearchState,
} from "./product-intent-service.js";
import { searchSiteProducts } from "./product-search-public-service.js";
import { toGuestSafeProductSearchResult, toGuestSafeResolvedProduct } from "./guest-product-sanitizer.js";
import { fetchTtmallProductById, isTtmallProductSource } from "./product-source-service.js";
import { markServerProductOrigins } from "./product-source-provenance.js";
import { isExternalSourceProductReference, parseExternalSourceContext } from "./external-source-context-service.js";
import { mapProductSearchSite } from "./product-search-site-service.js";
import { classifyProductIntent } from "./product-intent-classifier-service.js";
import { classifyCommerceIntent } from "./product-intent-classifier-service.js";
import { resolveCommerceSearchIntent } from "./commerce-routing-service.js";
import { normalizeProductSourceError } from "./product-source-error-service.js";
import { requestedProductEdition, resolveProductEditions, classifyCatalogueEditions } from "./product-edition-service.js";
import { resolveTrustedCurrentProductSizing, selectCurrentProductForSizing } from "./product-sizing-context-service.js";
import { resolveUnconfirmedProductSearchOutcome } from "./product-search-decision-service.js";
import { productCandidateContext } from "./product-search-execution-service.js";
import { buildCandidateConfirmationContext } from './product-candidate-confirmation-service.js';
import { resolveProductCheckoutProduct } from './product-checkout-resolver-service.js';

export async function buildGuestProductRecommendationContext(db, {
  guest = {},
  userText = "",
  recentMessages = [],
  searchProducts = searchSiteProducts,
  intentTurn = null,
  precomputedSearchIntent = null,
  classifyIntent = classifyProductIntent,
  classifyCommerce = classifyIntent === classifyProductIntent ? classifyCommerceIntent : null,
  resolveSizingProduct = resolveTrustedCurrentProductSizing,
  resolveConfirmationProduct = resolveProductCheckoutProduct,
} = {}) {
  const result = await resolveGuestProductRecommendation(db, { guest, userText, recentMessages, searchProducts, classifyIntent, classifyCommerce, intentTurn, precomputedSearchIntent, resolveSizingProduct, resolveConfirmationProduct });
  return result.context;
}

export async function resolveGuestProductRecommendation(db, {
  guest = {},
  userText = "",
  recentMessages = [],
  searchProducts = searchSiteProducts,
  intentTurn = null,
  precomputedSearchIntent = null,
  classifyIntent = classifyProductIntent,
  classifyCommerce = classifyIntent === classifyProductIntent ? classifyCommerceIntent : null,
  resolveSizingProduct = resolveTrustedCurrentProductSizing,
  resolveConfirmationProduct = resolveProductCheckoutProduct,
} = {}) {
  let searchIntent = precomputedSearchIntent ? { ...precomputedSearchIntent } : {
    ...buildProductSearchIntent(userText, "", {
      recentProductContext: buildRecentProductContext(recentMessages),
    }),
    preferLatestHome: true,
  };
  if (!precomputedSearchIntent) {
    searchIntent = await resolveCommerceSearchIntent({ userText, recentMessages, searchIntent, classifyCommerce, siteId: guest.site_id, characterId: guest.mascot_character_id, jevDecision: intentTurn?.decision, enrichAllTurns: true });
  }
  if (searchIntent.commerceClassificationUnavailable === true) return { requested: true, context: null, searchIntent };
  if (hasPendingProductRequest(searchIntent)) return { requested: true, searchIntent, context: buildEmptyGuestProductContext({ id: guest.site_id || "" }, searchIntent,
    searchIntent.searchState === "clarification_exhausted" ? "guest-product-clarification-exhausted" : "guest-product-needs-clarification") };
  if (searchIntent.nonShoppingReason) return { requested: false, context: null, searchIntent };
  if (searchIntent.candidateConfirmationOnly) {
    const site = await loadFrozenGuestProductSite(db, guest);
    const context = await buildCandidateConfirmationContext({ site, searchIntent, recentMessages, userText,
      characterId: guest.mascot_character_id, resolveProduct: resolveConfirmationProduct, buildCandidateContext: productCandidateContext });
    return { requested: true, searchIntent, context };
  }
  const currentProductImageContext = searchIntent.referencedProductIds?.length ? null
    : await resolveGuestCurrentProductImageCardContext(db, { guest, userText, recentMessages, searchIntent });
  recentMessages = productScopeHistory(recentMessages, searchIntent);
  if (currentProductImageContext) {
    const context = mergeReplyCommerceContext(currentProductImageContext, searchIntent);
    return { requested: true, searchIntent: context.searchIntent || searchIntent, context };
  }
  const site = await loadFrozenGuestProductSite(db, guest);
  const displayedReference = buildDisplayedProductReferenceContext({ site, characterId: guest.mascot_character_id, searchIntent, recentMessages });
  if (displayedReference) return { requested: true, searchIntent, context: mergeReplyCommerceContext(displayedReference, searchIntent) };
  const currentProductSizingContext = await buildGuestCurrentProductSizingContext({ site, searchIntent, recentMessages, resolveSizingProduct });
  if (currentProductSizingContext) {
    return {
      requested: true,
      searchIntent: currentProductSizingContext.searchIntent,
      context: mergeReplyCommerceContext(currentProductSizingContext, searchIntent),
    };
  }
  if (searchIntent.nonShoppingReason || searchIntent.commerceRoute === "chat" || (searchIntent.customerServiceKnowledgeRequest && !searchIntent.shouldLoadProductContext)) return { requested: false, context: null, searchIntent };
  const externalSourceProduct = await resolveGuestExternalSourceProductContext({ guest, site, userText, searchIntent });
  if (externalSourceProduct) {
    externalSourceProduct.searchIntent = { ...externalSourceProduct.searchIntent, ...searchIntent };
    if (externalSourceProduct.context) externalSourceProduct.context = mergeReplyCommerceContext(externalSourceProduct.context, searchIntent);
    return externalSourceProduct;
  }
  if (!searchIntent.shouldLoadProductContext) {
    // Every main producer turn already has a commerce/scope decision. A legacy
    // product-only verdict cannot reopen its permissions or establish one item.
    return { requested: false, context: null, searchIntent };
  }
  if (!site?.product_api_url) {
    const sourceErrorIntent = { ...searchIntent, searchState: "source_error", sourceErrorCode: "source_unconfigured" };
    return {
      requested: true,
      searchIntent: sourceErrorIntent,
      context: buildEmptyGuestProductContext(site, sourceErrorIntent, "guest-site-product-source-error"),
    };
  }
  if (searchIntent.customizationRequest && !searchIntent.requestedTeam) {
    return { requested: true, searchIntent, context: {
      ...buildEmptyGuestProductContext(site, searchIntent, "guest-product-customization-guidance"),
      searchOutcome: resolveUnconfirmedProductSearchOutcome(searchIntent),
    } };
  }
  if (searchIntent.searchState === "needs_clarification" || searchIntent.searchState === "clarification_exhausted") {
    return {
      requested: true,
      searchIntent,
      context: buildEmptyGuestProductContext(
        site,
        searchIntent,
        searchIntent.searchState === "clarification_exhausted"
          ? "guest-product-clarification-exhausted"
          : "guest-product-needs-clarification",
      ),
    };
  }

  try {
    const result = await searchProducts({
      siteSlug: site.slug,
      query: searchIntent.query || userText,
      limit: 2,
      strictSite: true,
      searchIntent,
      allowNearestAgeFallback: true,
      allowCandidateSearch: searchIntent.candidateSearchAllowed === true,
    });
    // Match on complete server evidence before the public projection removes
    // descriptions. Pass the original objects directly, never reconnect by ID.
    const ordinaryMatch = result.searchOutcome !== "alternative"
      && !(result.searchOutcome === "candidate" && searchIntent.candidateSearchAllowed === true);
    const sourceItems = ordinaryMatch
      ? filterProductsByIntent(Array.isArray(result.items) ? result.items : [], searchIntent, { allowNearestAgeFallback: true })
      : result.items;
    const safeResult = toGuestSafeProductSearchResult(result, { includeAttributeEvidence: true, sourceItems });
    // Candidate/alternative retain their existing proof and permission checks.
    let products = safeResult.searchOutcome === "alternative"
      ? alternativeProductsForSearch(result, searchIntent, safeResult.items)
      : safeResult.searchOutcome === "candidate" && searchIntent.candidateSearchAllowed === true
      ? safeResult.items.filter(product => product.matchStatus === "candidate")
      : safeResult.items;
    if (searchIntent.referencedProductId) products = products.filter((product) => String(product.productId || product.id || "") === searchIntent.referencedProductId);
    if (safeResult.searchState === "source_error" || safeResult.searchOutcome === "source_error") {
      const sourceErrorIntent = { ...searchIntent, searchState: "source_error", sourceErrorCode: safeResult.sourceErrorCode || "source_internal" };
      return {
        requested: true,
        searchIntent: sourceErrorIntent,
        context: buildEmptyGuestProductContext(site, sourceErrorIntent, "guest-site-product-source-error"),
      };
    }
    if (isExplicitProductSizingSearch(searchIntent)) {
      const sizeMatchedProducts = filterProductsByRequestedSizes(products, searchIntent.requestedSizes);
      if (searchIntent.requestedSizes?.length && !sizeMatchedProducts.length) {
        return {
          requested: true,
          searchIntent,
          context: buildGuestProductSizingUnavailableContext(site, searchIntent),
        };
      }
      products = sizeMatchedProducts;
    }
    if (!products[0]?.name) return { requested: true, context: buildEmptyGuestProductContext(site, searchIntent), searchIntent };
    return {
      requested: true,
      searchIntent,
      context: bindProductAlternativeContext({
        sourceType: "product_api",
        sourceRef: isExplicitProductSizingSearch(searchIntent) ? "guest-site-product-sizing-match" : "guest-site-product-context",
        siteId: site.id,
        siteName: site.name || "",
        siteSlug: site.slug,
        siteCurrency: site.currency || "",
        searchIntent,
        cardAllowed: searchIntent.cardAllowed !== false,
        searchOutcome: safeResult.searchOutcome === "alternative" ? "alternative" : products.some(product => product.matchStatus === "candidate") ? "candidate" : resolveProductSearchState(searchIntent, products).status,
        candidateContext: productCandidateContext(products, searchIntent, { siteId: site.id, characterId: guest.mascot_character_id }),
        sizingProduct: isExplicitProductSizingSearch(searchIntent) ? products[0] : null,
        products,
      }, result),
    };
  } catch (error) {
    const failure = normalizeProductSourceError(error);
    console.warn("[aiove] guest product context unavailable", failure);
    const sourceErrorIntent = { ...searchIntent, searchState: "source_error", sourceErrorCode: failure.code };
    return {
      requested: true,
      sourceError: true,
      searchIntent: sourceErrorIntent,
      context: buildEmptyGuestProductContext(site, sourceErrorIntent, "guest-site-product-source-error"),
    };
  }
}

export async function resolveGuestExternalSourceProductContext({
  guest = {},
  site = {},
  userText = "",
  searchIntent = {},
  fetchProductById = fetchTtmallProductById,
  classifyEditions = fetchProductById === fetchTtmallProductById ? classifyCatalogueEditions : null,
} = {}) {
  if (hasPendingProductRequest(searchIntent) || searchIntent.productRequestState?.status === "selected") return null;
  const externalSource = parseExternalSourceContext(guest.external_source_context_json);
  if (!externalSource?.sourceProductId || !site?.id || !isTtmallProductSource(site.product_api_url)) return null;
  if (String(externalSource.siteId || "") !== String(site.id || "")) return null;
  if (String(externalSource.siteSlug || "") !== String(site.slug || "")) return null;
  if (String(externalSource.mascotCharacterId || "") !== String(guest.mascot_character_id || "")) return null;
  if (!isExternalSourceProductReference(userText, searchIntent)) return null;

  const resolvedIntent = {
    ...searchIntent,
    contextSource: "external_source_page",
    sourceProductId: externalSource.sourceProductId,
  };
  let product;
  try {
    product = await fetchProductById(site.product_api_url, externalSource.sourceProductId, {
      currency: site.currency || "",
      throwOnError: true,
    });
  } catch (error) {
    const failure = normalizeProductSourceError(error);
    console.warn("[aiove] guest external source product unavailable", failure);
    const sourceErrorIntent = { ...resolvedIntent, searchState: "source_error", sourceErrorCode: failure.code };
    return {
      requested: true,
      sourceError: true,
      searchIntent: sourceErrorIntent,
      context: buildEmptyGuestProductContext(site, sourceErrorIntent, "guest-external-source-product-error"),
    };
  }

  const safeSite = mapProductSearchSite({ ...site, site_url: externalSource.sourceOrigin });
  const safeResult = markServerProductOrigins({ ok: true, site: safeSite, sourceItem: product }, product ? [product] : []);
  let safeProduct = toGuestSafeResolvedProduct(safeResult).item;
  if (!safeProduct?.name || !safeProduct.url) {
    return {
      requested: true,
      searchIntent: resolvedIntent,
      context: buildEmptyGuestProductContext(site, resolvedIntent, "guest-external-source-product-no-match"),
    };
  }
  const requiredEdition = requestedProductEdition(searchIntent);
  // Reading an existing item to answer a factual question is independent of
  // permitting a new recommendation that claims to satisfy an edition request.
  const editionCardRequired = requiredEdition && searchIntent.cardAllowed !== false && searchIntent.commerceRoute !== "product_question";
  if (editionCardRequired) [safeProduct] = await resolveProductEditions([safeProduct], { searchIntent, classifyEditions });
  if (searchIntent.requestedTeam || searchIntent.requestedPlayer || searchIntent.requestedSeason || editionCardRequired) {
    const matchIntent = editionCardRequired ? searchIntent : { ...searchIntent, requestedEdition: "", requestedFeatures: (searchIntent.requestedFeatures || []).filter((feature) => !["authentic", "fan_version"].includes(feature)) };
    const anchoredMatch = filterProductsByIntent([safeProduct], matchIntent, { allowNearestAgeFallback: true });
    if (!anchoredMatch.length) return null;
  }
  return {
    requested: true,
    searchIntent: resolvedIntent,
    context: {
      sourceType: "product_api",
      sourceRef: "guest-external-source-product",
      siteId: site.id,
      siteName: site.name || "",
      siteSlug: site.slug,
      siteCurrency: site.currency || "",
      searchIntent: resolvedIntent,
      searchOutcome: "matched",
      sizingProduct: searchIntent.intent === "sizing" ? safeProduct : null,
      products: [safeProduct],
    },
  };
}

function buildEmptyGuestProductContext(site = {}, searchIntent = {}, sourceRef = "guest-site-product-no-match") {
  return {
    sourceType: "product_api",
    sourceRef,
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency: site.currency || "",
    searchIntent,
    cardAllowed: searchIntent.cardAllowed !== false,
    searchOutcome: resolveProductSearchState(searchIntent, []).status,
    products: [],
  };
}

function buildGuestProductSizingUnavailableContext(site = {}, searchIntent = {}) {
  return {
    ...buildEmptyGuestProductContext(site, { ...searchIntent, searchState: "needs_clarification" }, "guest-site-product-sizing-unavailable"),
    searchOutcome: "size_unavailable",
    requestedSizes: Array.isArray(searchIntent.requestedSizes) ? searchIntent.requestedSizes : [],
  };
}

async function buildGuestCurrentProductSizingContext({ site = {}, searchIntent = {}, recentMessages = [], resolveSizingProduct = resolveTrustedCurrentProductSizing } = {}) {
  if (hasPendingProductRequest(searchIntent)) return null;
  if (searchIntent?.intent !== "sizing" && !(searchIntent.commerceRoute === "product_question" && searchIntent.commerceTopic === "sizing")) return null;
  const referencedSizingQuestion = Boolean(searchIntent.referencedProductId)
    && searchIntent.commerceRoute === "product_question" && searchIntent.commerceTopic === "sizing";
  if (isExplicitProductSizingSearch(searchIntent) && !referencedSizingQuestion) return null;
  const recentProduct = selectCurrentProductForSizing({ site, searchIntent, recentMessages });
  if (recentProduct?.name && productMatchesSite(recentProduct, site)) {
    const sizingProduct = await resolveSizingProduct({ site, product: recentProduct });
    return {
      sourceType: "product_api",
      sourceRef: "guest-current-product-sizing-context",
      siteId: site.id || "",
      siteName: site.name || "",
      siteSlug: site.slug || "",
      siteCurrency: site.currency || "",
      searchIntent,
      searchOutcome: "matched",
      sizingProduct,
      products: [],
    };
  }
  return {
    sourceType: "product_api",
    sourceRef: "guest-site-product-sizing-guidance",
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency: site.currency || "",
    searchIntent: { ...searchIntent, searchState: "needs_clarification" },
    searchOutcome: "needs_clarification",
    products: [],
  };
}

export async function resolveGuestCurrentProductImageCardContext(db, {
  guest = {},
  userText = "",
  recentMessages = [],
  searchIntent = {},
} = {}) {
  if (hasPendingProductRequest(searchIntent)) return null;
  recentMessages = productScopeHistory(recentMessages, searchIntent);
  if (!isProductImageCardRequest(userText)) return null;
  if (!isRecentProductConversationActive(recentMessages, userText)) return null;
  const site = await loadFrozenGuestProductSite(db, guest);
  const recentProduct = findRecentProductMessage(recentMessages);
  if (!recentProduct?.product?.name || !recentProduct.product.url || !productMatchesSite(recentProduct.product, site)) return null;
  return {
    sourceType: "product_api",
    sourceRef: "guest-current-product-image-card",
    siteId: site.id,
    siteName: site.name || "",
    siteSlug: site.slug,
    siteCurrency: site.currency || "",
    searchIntent: recentProduct.searchIntent || recentProduct.product.searchIntent || null,
    searchOutcome: "matched",
    products: [recentProduct.product],
  };
}

function productMatchesSite(product = {}, site = {}) {
  if (!site?.id) return false;
  const productSiteId = String(product.siteId || product.site_id || "").trim();
  const productSiteSlug = String(product.siteSlug || product.site_slug || "").trim();
  return Boolean(productSiteId && productSiteSlug && site.slug)
    && productSiteId === String(site.id || "")
    && productSiteSlug === String(site.slug || "");
}

async function loadFrozenGuestProductSite(db, guest = {}) {
  const [rows] = await db.execute(
    `SELECT id, name, slug, site_url, site_logo_url, currency, product_api_url, payment_methods_json, commerce_enabled
     FROM sites
     WHERE id = ?
       AND site_status = 'active'
       AND guest_chat_enabled = 1
     LIMIT 1`,
    [String(guest.site_id || "").trim()]
  );
  return rows[0] || null;
}
