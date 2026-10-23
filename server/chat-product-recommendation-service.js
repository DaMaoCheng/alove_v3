import { bindProductAlternativeContext } from './product-alternative-service.js';
import { buildDisplayedProductReferenceContext } from './product-displayed-reference-service.js';
import { mergeReplyCommerceContext } from "./chat-reply-boundary-service.js";
import { buildCandidateConfirmationContext } from './product-candidate-confirmation-service.js';
import { resolveProductCheckoutProduct } from './product-checkout-resolver-service.js';
import { hasPendingProductRequest, productScopeHistory } from "./product-request-scope-service.js";
import {
  buildProductSearchIntent,
  buildRecentProductContext,
  findRecentProductMessage,
  filterProductsByRequestedSizes,
  isAlternativeProductRequest,
  isExplicitProductSizingSearch,
  isProductImageCardRequest,
  isRecentProductConversationActive,
  normalizeProductTrigger,
  resolveProductSearchState,
} from "./product-intent-service.js";
import {
  hasHardProductRequirement,
  mergeProductRequirement,
  resolveUnconfirmedProductSearchOutcome,
} from "./product-search-decision-service.js";
import { productIdentityKeys } from "./product-candidate-ranking-service.js";
import { resolveCommerceSearchIntent } from "./commerce-routing-service.js";
import { classifyCommerceIntent } from "./product-intent-classifier-service.js";
import { normalizeProductSourceError } from "./product-source-error-service.js";
import { normalizeCurrency } from "./product-normalizer.js";
import { requestedProductEdition } from "./product-edition-service.js";
import { resolveTrustedCurrentProductSizing, selectCurrentProductForSizing } from "./product-sizing-context-service.js";
import { executeProductSearchDetailed, productCandidateContext } from "./product-search-execution-service.js";
import { resolvePromotionCampaignForChatRecommendation } from "./promotion-campaign-chat-recommendation-service.js";
import { fetchProductSummary } from "./product-source-service.js";
import {
  PRODUCT_CACHE_FRESHNESS_MS,
  PRODUCT_CACHE_STALE_FALLBACK_MS,
  searchCachedProducts,
} from "./product-cache-search-service.js";
import { isTtmallProductSource } from "./product-source-ttmall-service.js";
import {
  canCharacterSendProductContext,
  resolveProductRecommendationSite,
} from "./product-recommendation-site-service.js";
import { normalizePaymentMethods } from "../shared/payment-methods.js";
import {
  buildUserProductPreferenceFallback,
  filterPurchasedProductDuplicates,
} from "./user-product-preference-service.js";

export async function buildChatProductRecommendationContext(db, {
  character = {},
  userId = "",
  sessionId = "",
  userText = "",
  productTrigger = "",
  recentMessages = [],
  fetchProducts = fetchProductSummary,
  searchCache = searchCachedProducts,
  classifyIntent = null,
  classifyCommerce = undefined,
  onCommerceDecision = null,
  intentTurn = null,
  precomputedSearchIntent = null,
  resolveSizingProduct = resolveTrustedCurrentProductSizing,
  resolveConfirmationProduct = resolveProductCheckoutProduct,
} = {}) {
  if (!canCharacterSendProductContext(character)) return null;
  const explicitTrigger = normalizeProductTrigger(productTrigger);
  let initialSearchIntent = precomputedSearchIntent ? { ...precomputedSearchIntent } : {
    ...buildProductSearchIntent(userText, explicitTrigger, { recentProductContext: buildRecentProductContext(recentMessages) }),
    // Chat requests should use the catalogue season encoded in product titles when choosing the current home shirt.
    preferLatestHome: true,
  };
  if (precomputedSearchIntent && onCommerceDecision) await onCommerceDecision(initialSearchIntent);
  const commerceClassifier = classifyCommerce === undefined ? (classifyIntent ? null : classifyCommerceIntent) : classifyCommerce;
  let commerceResolved = Boolean(precomputedSearchIntent);
  if (!precomputedSearchIntent && initialSearchIntent.nonShoppingReason === "business_contact") {
    initialSearchIntent = await resolveCommerceSearchIntent({ userText, recentMessages, searchIntent: initialSearchIntent, classifyCommerce: commerceClassifier,
      siteId: character.site_id || character.siteId || "", characterId: character.id || character.characterId || "", jevDecision: intentTurn?.decision, enrichAllTurns: true });
    commerceResolved = true;
    if (onCommerceDecision) await onCommerceDecision(initialSearchIntent);
  }
  if (initialSearchIntent.commerceClassificationUnavailable === true) return null;
  if (hasPendingProductRequest(initialSearchIntent)) return buildEmptyProductContext({ id: character.site_id || character.siteId || "" }, initialSearchIntent,
    initialSearchIntent.searchState === "clarification_exhausted" ? "site-product-clarification-exhausted" : "site-product-needs-clarification");
  if (initialSearchIntent.nonShoppingReason) return null;
  const site = await resolveProductRecommendationSite(db, { character, userId });
  if (!site?.id) return null;
  if (!commerceResolved) {
    initialSearchIntent = await resolveCommerceSearchIntent({ userText, recentMessages, searchIntent: initialSearchIntent, explicitTrigger: Boolean(explicitTrigger), classifyCommerce: commerceClassifier,
      siteId: site.id, siteSlug: site.slug, characterId: character.id || character.characterId || "", jevDecision: intentTurn?.decision, enrichAllTurns: true });
    if (onCommerceDecision) await onCommerceDecision(initialSearchIntent);
  }
  if (hasPendingProductRequest(initialSearchIntent)) return buildEmptyProductContext(site, initialSearchIntent,
    initialSearchIntent.searchState === "clarification_exhausted" ? "site-product-clarification-exhausted" : "site-product-needs-clarification");
  if (initialSearchIntent.commerceClassificationUnavailable === true) return null;
  if (initialSearchIntent.candidateConfirmationOnly) return buildCandidateConfirmationContext({ site, searchIntent: initialSearchIntent,
    recentMessages, userText, characterId: character.id || character.characterId || '', resolveProduct: resolveConfirmationProduct, buildCandidateContext: productCandidateContext });
  recentMessages = productScopeHistory(recentMessages, initialSearchIntent);
  const recentProductContext = buildRecentProductContext(recentMessages);
  const recentProductMessage = findRecentProductMessage(recentMessages);
  if (initialSearchIntent.nonShoppingReason) return null;
  if (initialSearchIntent.referencedProductId && (
    (!initialSearchIntent.referencedSiteId && !initialSearchIntent.referencedSiteSlug)
    || (initialSearchIntent.referencedSiteId && String(initialSearchIntent.referencedSiteId) !== String(site.id))
    || (initialSearchIntent.referencedSiteSlug && String(initialSearchIntent.referencedSiteSlug) !== String(site.slug))
  )) {
    initialSearchIntent = { ...initialSearchIntent, unresolvedProductReference: true, shouldLoadProductContext: false };
    if (onCommerceDecision) await onCommerceDecision(initialSearchIntent);
    return null;
  }

  const displayedReference = buildDisplayedProductReferenceContext({ site, characterId: character.id || character.characterId || '', searchIntent: initialSearchIntent, recentMessages });
  if (displayedReference) return mergeReplyCommerceContext(displayedReference, initialSearchIntent);

  const currentProductImageContext = buildCurrentProductImageContextForSite({
    site,
    userText,
    recentProductMessage,
    recentProductContext,
    recentMessages,
  });
  if (currentProductImageContext) return mergeReplyCommerceContext(currentProductImageContext, initialSearchIntent);
  const currentProductSizingContext = await buildCurrentProductSizingContextForSite({
    site,
    searchIntent: initialSearchIntent,
    recentProductMessage,
    recentMessages,
    resolveSizingProduct,
  });
  if (currentProductSizingContext) return mergeReplyCommerceContext(currentProductSizingContext, initialSearchIntent);
  if (initialSearchIntent.nonShoppingReason || (!explicitTrigger && !initialSearchIntent.shouldLoadProductContext)) return null;

  if (initialSearchIntent.customizationRequest && !initialSearchIntent.requestedTeam) {
    return { ...buildEmptyProductContext(site, initialSearchIntent, "product-customization-guidance"),
      searchOutcome: resolveUnconfirmedProductSearchOutcome(initialSearchIntent) };
  }
  const alternativeRequest = initialSearchIntent.productRequestState?.status !== "selected" && isAlternativeProductRequest(userText);
  const recentProductState = alternativeRequest
    ? await loadRecentSessionProductState(db, { sessionId, siteId: site.id, siteSlug: site.slug })
    : { excludedIdentities: [], lastSearchIntent: null };
  const searchIntent = alternativeRequest && recentProductState.lastSearchIntent
    ? mergeAlternativeProductSearchIntent(recentProductState.lastSearchIntent, initialSearchIntent)
    : initialSearchIntent;
  const siteCurrency = normalizeCurrency(site.currency);
  const sitePaymentMethods = normalizePaymentMethods(site.payment_methods_json || site.paymentMethods);
  const excludeCampaignIds = alternativeRequest
    ? await listRecentSessionPromotionCampaignIds(db, { sessionId, siteId: site.id })
    : [];
  const campaignMatch = searchIntent.productRequestState?.status !== "selected" && searchIntent.cardAllowed !== false && shouldUsePromotionCampaign(searchIntent)
    ? await resolvePromotionCampaignForChatRecommendation(db, {
        siteId: site.id,
        character,
        excludeCampaignIds,
      })
    : null;
  if (campaignMatch?.product) {
    return {
      sourceType: "promotion_campaign",
      sourceRef: "promotion-campaign-product",
      siteId: site.id || "",
      siteName: site.name || "",
      siteSlug: site.slug || "",
      siteCurrency,
      commerceEnabled: site.commerce_enabled == null ? true : Boolean(site.commerce_enabled),
      productApiUrl: site.product_api_url || "",
      searchIntent,
      cardAllowed: searchIntent.cardAllowed !== false,
      searchOutcome: "matched",
      campaign: campaignMatch.campaign,
      products: attachPaymentMethods([campaignMatch.product], sitePaymentMethods),
    };
  }
  if (searchIntent.searchState === "needs_clarification" || searchIntent.searchState === "clarification_exhausted") {
    return buildEmptyProductContext(
      site,
      searchIntent,
      searchIntent.searchState === "clarification_exhausted"
        ? "site-product-clarification-exhausted"
        : "site-product-needs-clarification",
    );
  }

  if (!site.product_api_url) {
    return buildEmptyProductContext(site, {
      ...searchIntent,
      searchState: "source_error",
      sourceErrorCode: "source_unconfigured",
    }, "site-product-source-error");
  }
  const preferenceFallback = alternativeRequest && !hasHardProductRequirement(searchIntent)
    ? await buildUserProductPreferenceFallback(db, { userId, characterId: character.id || character.characterId || "" })
    : null;
  const fallbackSearchIntent = preferenceFallback?.query
    ? {
        ...searchIntent,
        query: preferenceFallback.query,
        intent: "preference_fallback",
        preferenceReason: preferenceFallback.reason,
      }
    : searchIntent;
  const cacheSearchAllowed = fallbackSearchIntent.needsLiveProductData !== true
    && fallbackSearchIntent.candidateSearchAllowed !== true
    && !fallbackSearchIntent.requestedAgeRange
    && isTtmallProductSource(site.product_api_url)
    && fallbackSearchIntent.intent !== "popular"
    && fallbackSearchIntent.explicitSizingProductSearch !== true
    && !fallbackSearchIntent.requestedSizes?.length;
  if (cacheSearchAllowed) {
    const cached = await searchCache({
      siteId: site.id,
      query: fallbackSearchIntent.query || userText,
      searchIntent: fallbackSearchIntent,
      limit: alternativeRequest ? 10 : 5,
      allowNearestAgeFallback: true,
      maxAgeMs: PRODUCT_CACHE_FRESHNESS_MS,
    });
    if (cached.products.length) {
      return buildProductContextFromProducts(site, fallbackSearchIntent, cached.products, sitePaymentMethods, {
        sourceType: "kitshop_cache",
        sourceRef: "site-product-cache",
        cacheAgeMs: cached.ageMs,
      });
    }
  }
  const popularityScores = searchIntent.intent === "popular"
    ? await loadProductPopularityScores(db, { siteId: site.id, siteSlug: site.slug })
    : null;
  let products = [];
  let detailedResult = null;
  try {
    const detailed = await executeProductSearchDetailed({
      productApiUrl: site.product_api_url,
      query: fallbackSearchIntent.query || userText,
      searchIntent: fallbackSearchIntent,
      currency: siteCurrency,
      encryptedAccessToken: site.product_access_token_encrypted,
      limit: alternativeRequest ? 10 : 5,
      allowNearestAgeFallback: true,
      popularityScores,
      fetchProducts,
      // Preference fallback asks the source for a curated recommendation; unlike an
      // explicit user requirement, its memory-derived query is not a hard title filter.
      trustSourceResults: Boolean(preferenceFallback?.query),
    });
    detailedResult = detailed;
    products = detailed.matches.length ? detailed.matches : detailed.candidates.length ? detailed.candidates : (detailed.alternatives || []);
  } catch (error) {
    const failure = normalizeProductSourceError(error, {
      provider: isTtmallProductSource(site.product_api_url) ? "ttmall" : "http",
    });
    console.warn("[aiove] chat product search source unavailable", failure);
    if (cacheSearchAllowed) {
      const stale = await searchCache({
        siteId: site.id,
        query: fallbackSearchIntent.query || userText,
        searchIntent: fallbackSearchIntent,
        limit: alternativeRequest ? 10 : 5,
        allowNearestAgeFallback: true,
        maxAgeMs: PRODUCT_CACHE_STALE_FALLBACK_MS,
      });
      if (stale.products.length) {
        return buildProductContextFromProducts(site, fallbackSearchIntent, stale.products, sitePaymentMethods, {
          sourceType: "kitshop_cache",
          sourceRef: "site-product-cache-stale-fallback",
          cacheAgeMs: stale.ageMs,
        });
      }
    }
    return buildEmptyProductContext(site, {
      ...fallbackSearchIntent,
      searchState: "source_error",
      sourceErrorCode: failure.code,
    }, "site-product-source-error");
  }
  if (fallbackSearchIntent.cardAllowed === false && fallbackSearchIntent.referencedProductId) {
    products = products.filter((product) => String(product.productId || product.id || "") === fallbackSearchIntent.referencedProductId);
  }
  products = filterRecentProductDuplicates(
    filterPurchasedProductDuplicates(products, preferenceFallback?.excludeProductNames || []),
    fallbackSearchIntent.productCandidateState?.proposal?.status === "confirmed" ? new Set() : recentProductState.excludedIdentities
  ).slice(0, 5);
  if (isExplicitProductSizingSearch(fallbackSearchIntent)) {
    const sizeMatchedProducts = filterProductsByRequestedSizes(products, fallbackSearchIntent.requestedSizes);
    if (fallbackSearchIntent.requestedSizes?.length && !sizeMatchedProducts.length) {
      return buildProductSizingUnavailableContext(site, fallbackSearchIntent);
    }
    products = sizeMatchedProducts;
  }
  if (!products.length) return buildEmptyProductContext(site, fallbackSearchIntent, "site-product-no-match");

  return bindProductAlternativeContext({
    sourceType: "product_api",
    sourceRef: isExplicitProductSizingSearch(fallbackSearchIntent) ? "site-product-sizing-match" : "site-product-context",
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency,
    commerceEnabled: site.commerce_enabled == null ? true : Boolean(site.commerce_enabled),
    productApiUrl: site.product_api_url || "",
    searchIntent: fallbackSearchIntent,
    cardAllowed: fallbackSearchIntent.cardAllowed !== false,
    searchOutcome: products.some(product => product.matchStatus === "alternative") ? "alternative" : products.some(product => product.matchStatus === "candidate") ? "candidate" : resolveProductSearchState(fallbackSearchIntent, products).status,
    candidateContext: productCandidateContext(products, fallbackSearchIntent, { siteId: site.id, characterId: character.id || character.characterId || '' }),
    sizingProduct: isExplicitProductSizingSearch(fallbackSearchIntent) ? products[0] : null,
    products: attachPaymentMethods(products, sitePaymentMethods),
  }, detailedResult);
}

function buildProductContextFromProducts(site, searchIntent, products, sitePaymentMethods, {
  sourceType = "product_api",
  sourceRef = "site-product-context",
  cacheAgeMs = null,
} = {}) {
  return {
    sourceType,
    sourceRef,
    cacheAgeMs,
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency: normalizeCurrency(site.currency),
    commerceEnabled: site.commerce_enabled == null ? true : Boolean(site.commerce_enabled),
    productApiUrl: site.product_api_url || "",
    searchIntent,
    cardAllowed: searchIntent.cardAllowed !== false,
    searchOutcome: resolveProductSearchState(searchIntent, products).status,
    products: attachPaymentMethods(products, sitePaymentMethods),
  };
}

function mergeAlternativeProductSearchIntent(previous = {}, current = {}) {
  const mergedRequirement = mergeProductRequirement(current, previous, { reuseRecent: true });
  const hasCurrentCatalogueAnchor = Boolean(
    current.requestedTeam
    || current.requestedAgeRange
    || current.requestedPrintNumber
    || current.requestedColor
    || current.requestedSeason
    || current.requestedVariants?.length
    || current.requestedFeatures?.length
    || current.requestedKeywords?.length
  );
  return {
    ...previous,
    ...current,
    ...mergedRequirement,
    query: hasCurrentCatalogueAnchor ? current.query : previous.query,
    intent: current.intent && current.intent !== "recommendation" ? current.intent : previous.intent,
    searchState: "ready_to_search",
    shouldLoadProductContext: true,
    isAlternativeRequest: true,
  };
}

function buildEmptyProductContext(site = {}, searchIntent = {}, sourceRef = "site-product-no-match") {
  return {
    sourceType: "product_api",
    sourceRef,
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency: normalizeCurrency(site.currency),
    commerceEnabled: site.commerce_enabled == null ? true : Boolean(site.commerce_enabled),
    productApiUrl: site.product_api_url || "",
    searchIntent,
    cardAllowed: searchIntent.cardAllowed !== false,
    searchOutcome: resolveProductSearchState(searchIntent, []).status,
    products: [],
  };
}

function buildProductSizingUnavailableContext(site = {}, searchIntent = {}) {
  return {
    ...buildEmptyProductContext(site, { ...searchIntent, searchState: "needs_clarification" }, "site-product-sizing-unavailable"),
    searchOutcome: "size_unavailable",
    requestedSizes: Array.isArray(searchIntent.requestedSizes) ? searchIntent.requestedSizes : [],
  };
}

export async function resolveCurrentProductImageCardContext(db, {
  character = {},
  userId = "",
  userText = "",
  recentMessages = [],
  searchIntent = {},
} = {}) {
  if (hasPendingProductRequest(searchIntent)) return null;
  recentMessages = productScopeHistory(recentMessages, searchIntent);
  if (!canCharacterSendProductContext(character) || !isProductImageCardRequest(userText)) return null;
  const site = await resolveProductRecommendationSite(db, { character, userId });
  if (!site?.id) return null;
  const recentProductContext = buildRecentProductContext(recentMessages);
  return buildCurrentProductImageContextForSite({
    site,
    userText,
    recentProductMessage: findRecentProductMessage(recentMessages),
    recentProductContext,
    recentMessages,
  });
}

function buildCurrentProductImageContextForSite({ site = {}, userText = "", recentProductMessage = null, recentProductContext = null, recentMessages = [] } = {}) {
  if (!isRecentProductConversationActive(recentMessages, userText)) return null;
  if (!isProductImageCardRequest(userText) || !recentProductMessage?.product?.name) return null;
  if (!productMatchesSite(recentProductMessage.product, site)) return null;
  return buildCurrentProductImageContext({
    site,
    product: recentProductMessage.product,
    searchIntent: recentProductMessage.searchIntent || recentProductContext,
  });
}

function buildCurrentProductImageContext({ site = {}, product = {}, searchIntent = null } = {}) {
  return {
    sourceType: "product_api",
    sourceRef: "current-product-image-card",
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency: normalizeCurrency(site.currency),
    commerceEnabled: site.commerce_enabled == null ? true : Boolean(site.commerce_enabled),
    productApiUrl: site.product_api_url || "",
    searchIntent: searchIntent || product.searchIntent || null,
    searchOutcome: "matched",
    products: [product],
  };
}

async function buildCurrentProductSizingContextForSite({ site = {}, searchIntent = {}, recentMessages = [], resolveSizingProduct = resolveTrustedCurrentProductSizing } = {}) {
  if (hasPendingProductRequest(searchIntent)) return null;
  if (searchIntent?.intent !== "sizing" && !(searchIntent.commerceRoute === "product_question" && searchIntent.commerceTopic === "sizing")) return null;
  const referencedSizingQuestion = Boolean(searchIntent.referencedProductId)
    && searchIntent.commerceRoute === "product_question" && searchIntent.commerceTopic === "sizing";
  // A size profile such as "plus size" is already a complete catalogue
  // constraint even when the user has not supplied a numeric size (2XL/3XL).
  // Let the normal product search/ranking path run so verified extended-size
  // products can be returned instead of forcing an unnecessary clarification.
  if (searchIntent?.requestedSizeProfile === "plus_size" && !referencedSizingQuestion) return null;
  if (isExplicitProductSizingSearch(searchIntent) && !referencedSizingQuestion) return null;
  const product = selectCurrentProductForSizing({ site, searchIntent, recentMessages });
  if (product?.name && productMatchesSite(product, site)) {
    const sizingProduct = await resolveSizingProduct({ site, product });
    return {
      sourceType: "product_api",
      sourceRef: "current-product-sizing-context",
      siteId: site.id || "",
      siteName: site.name || "",
      siteSlug: site.slug || "",
      siteCurrency: normalizeCurrency(site.currency),
      commerceEnabled: site.commerce_enabled == null ? true : Boolean(site.commerce_enabled),
      productApiUrl: site.product_api_url || "",
      searchIntent,
      cardAllowed: searchIntent.cardAllowed !== false,
      searchOutcome: "matched",
      sizingProduct,
      products: [],
    };
  }
  return {
    sourceType: "product_api",
    sourceRef: "site-product-sizing-guidance",
    siteId: site.id || "",
    siteName: site.name || "",
    siteSlug: site.slug || "",
    siteCurrency: normalizeCurrency(site.currency),
    productApiUrl: site.product_api_url || "",
    searchIntent: { ...searchIntent, searchState: "needs_clarification" },
    searchOutcome: "needs_clarification",
    products: [],
  };
}

function productMatchesSite(product = {}, site = {}) {
  const productSiteId = safeString(product.siteId || product.site_id);
  const productSiteSlug = safeString(product.siteSlug || product.site_slug);
  const siteId = safeString(site.id);
  const siteSlug = safeString(site.slug);
  return Boolean(productSiteId && productSiteSlug && siteId && siteSlug)
    && productSiteId === siteId
    && productSiteSlug === siteSlug;
}

function shouldUsePromotionCampaign(searchIntent = {}) {
  if (searchIntent.searchState !== "ready_to_search") return false;
  if (searchIntent.intent === "popular") return false;
  return !hasHardProductRequirement(searchIntent) && !requestedProductEdition(searchIntent);
}

function attachPaymentMethods(products = [], paymentMethods = []) {
  const methods = normalizePaymentMethods(paymentMethods);
  if (!methods.length) return products;
  return products.map((product) => {
    const productMethods = normalizePaymentMethods(product.paymentMethods || product.payment_methods);
    return {
      ...product,
      paymentMethods: productMethods.length ? productMethods : methods,
    };
  });
}

async function listRecentSessionPromotionCampaignIds(db, { sessionId = "", siteId = "", limit = 12 } = {}) {
  const normalizedSessionId = safeString(sessionId);
  if (!normalizedSessionId || !db?.execute) return [];
  const params = [normalizedSessionId];
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
  let siteClause = "";
  const normalizedSiteId = safeString(siteId);
  if (normalizedSiteId) {
    siteClause = "AND JSON_UNQUOTE(JSON_EXTRACT(product_payload_json, '$.siteId')) = ?";
    params.push(normalizedSiteId);
  }
  const [rows] = await db.execute(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(product_payload_json, '$.campaignId')) AS campaign_id
     FROM chat_messages
     WHERE session_id = ?
       AND content_type = 'product'
       AND source_type = 'promotion_campaign'
       AND source_ref = 'promotion-campaign-product'
       AND product_payload_json IS NOT NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(product_payload_json, '$.campaignId')) IS NOT NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(product_payload_json, '$.campaignId')) <> ''
       ${siteClause}
     ORDER BY display_order DESC, sent_at DESC
     LIMIT ${safeLimit}`,
    params
  );
  return [...new Set(rows.map((row) => safeString(row.campaign_id)).filter(Boolean))];
}

async function loadRecentSessionProductState(db, { sessionId = "", siteId = "", siteSlug = "", limit = 12 } = {}) {
  const normalizedSessionId = safeString(sessionId);
  if (!normalizedSessionId || !db?.execute) return { excludedIdentities: [], lastSearchIntent: null };
  const [rows] = await db.execute(
    `SELECT product_payload_json
     FROM chat_messages
     WHERE session_id = ?
       AND content_type = 'product'
       AND product_payload_json IS NOT NULL
     ORDER BY display_order DESC, sent_at DESC
     LIMIT ${Math.max(1, Math.min(30, Number(limit) || 12))}`,
    [normalizedSessionId]
  );
  const products = rows
    .map((row) => parseJson(row.product_payload_json, null))
    .filter((product) => product && typeof product === "object")
    .filter((product) => {
      const productSiteId = safeString(product.siteId || product.site_id);
      const productSiteSlug = safeString(product.siteSlug || product.site_slug);
      return (!siteId || !productSiteId || productSiteId === siteId) && (!siteSlug || !productSiteSlug || productSiteSlug === siteSlug);
    });
  const lastSearchProduct = products.find((product) => product.searchIntent && typeof product.searchIntent === "object");
  // The old requested year describes the unsuccessful original search, not the
  // alternative card. Keep history intact and resolve explicit card references
  // through their real catalogue facts instead of inheriting that old year.
  const lastSearchIntent = lastSearchProduct?.alternative?.kind === 'season_alternative'
    ? null : lastSearchProduct?.searchIntent || null;
  const excludedIdentities = new Set(products.flatMap(productIdentityKeys));
  return {
    excludedIdentities,
    lastSearchIntent,
  };
}

async function loadProductPopularityScores(db, { siteId = "", siteSlug = "" } = {}) {
  if (!db?.execute) return new Map();
  const [rows] = await db.execute(
    `SELECT product_id, product_url, product_title,
            SUM(CASE
              WHEN event_type = 'product_detail_cta_click' THEN 6
              WHEN event_type = 'product_bubble_click' THEN 4
              WHEN event_type = 'product_search_result_click' THEN 3
              WHEN event_type = 'product_detail_open' THEN 2
              WHEN event_type = 'product_bubble_impression' THEN 1
              ELSE 0
            END) AS score
     FROM product_analytics_events
     WHERE created_at >= DATE_SUB(NOW(3), INTERVAL 30 DAY)
       AND (site_id = ? OR site_slug = ?)
       AND event_type IN (
         'product_detail_cta_click',
         'product_bubble_click',
         'product_search_result_click',
         'product_detail_open',
         'product_bubble_impression'
       )
     GROUP BY product_id, product_url, product_title
     ORDER BY score DESC, MAX(created_at) DESC
     LIMIT 100`,
    [siteId || "", siteSlug || ""]
  );
  const scores = new Map();
  for (const row of rows) {
    const score = Number(row.score || 0);
    for (const key of productIdentityKeys({ id: row.product_id, url: row.product_url, name: row.product_title })) {
      scores.set(key, Math.max(Number(scores.get(key) || 0), score));
    }
  }
  return scores;
}

function filterRecentProductDuplicates(products = [], excludedIdentities = new Set()) {
  if (!excludedIdentities?.size) return products;
  return products.filter((product) => !productIdentityKeys(product).some((key) => excludedIdentities.has(key)));
}

function parseJson(value, fallback) {
  try {
    if (value == null || value === "") return fallback;
    if (typeof value === "object") return value;
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
