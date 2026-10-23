import { toAlternativeReviewContext } from "./product-alternative-service.js";
import { selectProductsForRequestedVariants } from "./product-candidate-ranking-service.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";
import { sanitizeCandidateUnknownFields, sanitizeProductAlternative } from "../shared/product-candidate-fields.js";
import { recordProductBubbleTriggered } from "./product-analytics-service.js";
import { insertMessage } from "./chat-service-shared.js";
import { isProductImageCardRequest } from "./product-intent-service.js";
import { requestedProductEdition, resolveCanonicalProductEdition } from "./product-edition-service.js";
import { sanitizeProductSizingChart } from "./product-sizing-context-service.js";

export function suppressRepeatedProductCards(productContext, { recentMessages = [], userText = "" } = {}) {
  if (!productContext?.products?.length || productContext?.candidateContext) return productContext;
  const explicitResend = isProductImageCardRequest(userText)
    || /\b(?:again|resend|re-send|otra vez|de nuevo)\b|再发|重新发|再看/.test(String(userText || "").toLowerCase());
  if (explicitResend) return productContext;
  const recentKeys = new Set(recentMessages.slice(-12).map((message) => message.product ? productCardIdentity(message.product, productContext) : "").filter(Boolean));
  return { ...productContext, suppressedProductKeys: [...recentKeys] };
}

function productCardIdentity(product = {}, context = {}) {
  const site = product.siteId || product.site_id || product.siteSlug || context.siteId || context.siteSlug || "";
  const id = product.productId || product.id;
  if (id) return `${site}:id:${id}`;
  if (product.sku) return `${site}:sku:${product.sku}`;
  if (product.url) {
    try { const url = new URL(product.url); return `url:${url.origin}${url.pathname.replace(/\/$/, "")}`; }
    catch { return `${site}:url:${product.url}`; }
  }
  return `${site}:name:${String(product.name || "").toLowerCase()}`;
}

export function selectProductForMessage(productContext = null) {
  return selectProductsForMessage(productContext)[0] || null;
}

export function selectProductsForMessage(productContext = null, { limit = 2 } = {}) {
  if (productContext?.cardAllowed === false || productContext?.searchOutcome === "alternative" && !toAlternativeReviewContext(productContext)) return [];
  if (productContext?.sourceRef === 'displayed-product-reference'
    && (!Array.isArray(productContext.products) || productContext.products.some(product => !product || typeof product !== 'object' || Array.isArray(product)))) return [];
  const requestedVariants = Array.isArray(productContext?.searchIntent?.requestedVariants)
    ? productContext.searchIntent.requestedVariants.filter(Boolean)
    : [];
  const selectionLimit = requestedVariants.length > 1
    ? Math.min(Math.max(1, Number(limit) || 2), requestedVariants.length)
    : 1;
  const suppressed = new Set(productContext?.suppressedProductKeys || []);
  const edition = requestedProductEdition(productContext?.searchIntent || {});
  const eligibleProducts = Array.isArray(productContext?.products)
    ? productContext.products.filter((product) => !suppressed.has(productCardIdentity(product, productContext))
      && (!edition || (edition !== "conflict" && (resolveCanonicalProductEdition(product) === edition
        || (productContext?.searchOutcome === "candidate" && !resolveCanonicalProductEdition(product))))))
    : [];
  let products;
  if (productContext?.sourceRef === 'displayed-product-reference') {
    const intent = productContext.searchIntent || {};
    const references = intent.referencedProductIds;
    const validReferences = productContext.snapshotOnly === true && intent.commerceRoute === 'product_search'
      && intent.shouldLoadProductContext === true && intent.cardAllowed === true && intent.replyBoundary?.salesAllowed !== false
      && Array.isArray(references) && references.length > 0 && references.length <= 2
      && references.every(id => typeof id === 'string' && id && id.length <= 160)
      && new Set(references).size === references.length
      && Array.isArray(productContext.products)
      && references.every(id => productContext.products.some(product => String(product.productId || product.id || '') === id));
    if (!validReferences) return [];
    // The server already resolved this exact displayed group. Its current
    // request need not restate variant words to resend both known identities.
    products = references.map(id => eligibleProducts.find(product => String(product.productId || product.id || '') === id))
      .filter(Boolean).slice(0, Math.min(2, Math.max(1, Number(limit) || 2)));
  } else {
    products = (requestedVariants.length > 1
      ? selectProductsForRequestedVariants(eligibleProducts, productContext.searchIntent).products : eligibleProducts).slice(0, selectionLimit);
  }
  return products.map((product) => selectSingleProductForMessage(productContext, product)).filter(Boolean);
}

// Prospective delivery facts use the existing selector, never the raw search pool.
// They are conditional on the complete reply review, not permission to send cards.
export function buildProductCardDeliveryContext(productContext = null) {
  if (!Array.isArray(productContext?.products) || !productContext.products.length) return null;
  const selectedProducts = selectProductsForMessage(productContext);
  const cards = selectedProducts.map(product => ({
    id: String(product.productId || product.id || ""), name: String(product.name || ""), matchStatus: product.matchStatus,
  }));
  const requestedVariants = productContext.searchIntent?.requestedVariants || [];
  const unfulfilledVariants = requestedVariants.length > 1 && productContext.cardAllowed !== false && productContext.searchIntent?.cardAllowed !== false
    ? selectProductsForRequestedVariants(selectedProducts, productContext.searchIntent).unfulfilledVariants : [];
  return { count: cards.length, cards, unfulfilledVariants };
}

// Both guest and member persistence apply these same existing post-review gates.
export function selectProductsForReply(productContext = null, replyResult = {}) {
  if (productContext?.searchOutcome === "alternative" && replyResult.alternativeEvidenceVerified !== true
    || replyResult.productScopeVerified === false
    || productContext?.candidateContext && replyResult.candidateEvidenceVerified !== true
    || isAiTransportFallback(replyResult) || replyResult.replyBoundary?.salesAllowed === false) return [];
  return selectProductsForMessage(productContext);
}

function selectSingleProductForMessage(productContext = null, product = null) {
  const alternative = toAlternativeReviewContext(productContext);
  const historicalAlternative = productContext?.sourceRef === "displayed-product-reference" && productContext.snapshotOnly === true ? sanitizeProductAlternative(product.alternative) : null;
  if (!product?.name) return null;
  const livePriceFetchedAt = productContext.snapshotOnly ? product.livePriceFetchedAt || "" : new Date().toISOString();
  const sizeChart = sanitizeProductSizingChart(product.sizeChart);
  return {
    id: product.id || product.productId || "",
    productId: product.productId || product.id || "",
    sku: product.sku || "",
    name: product.name,
    canonicalEdition: resolveCanonicalProductEdition(product),
    matchStatus: alternative ? "alternative" : productContext?.searchOutcome === "candidate" ? "candidate" : "matched",
    ...(alternative ? { alternative: { kind: "season_alternative", requestedSeason: alternative.requestedSeason, alternativeSeason: alternative.alternativeSeason } } : historicalAlternative ? { alternative: historicalAlternative } : {}),
    candidateUnknownFields: sanitizeCandidateUnknownFields(product.candidateUnknownFields),
    giveaway: product.giveaway === true ? true : product.giveaway === false ? false : null,
    subtitle: productContext.searchOutcome === 'candidate' ? '' : product.subtitle || product.summary || (alternative || historicalAlternative ? "" : productContext.searchIntent?.query || "Recommended for you"),
    priceNow: product.price || product.priceNow || "",
    priceWas: product.priceWas || "",
    code: product.code || "",
    tag: product.tag || productContext.searchIntent?.intent || "Recommended",
    imageUrl: product.imageUrl || "",
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
    url: product.url || "",
    stock: product.stock || "",
    summary: productContext.searchOutcome === 'candidate' ? '' : product.summary || "",
    available: product.available ?? null,
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    sizeChart,
    sizeChartResolved: product.sizeChartResolved === true && (!product.sizeChart || Boolean(sizeChart)),
    features: Array.isArray(product.features) ? product.features : [],
    searchIntent: productContext.searchIntent || null,
    siteId: productContext.siteId || "",
    siteSlug: productContext.siteSlug || "",
    paymentMethods: Array.isArray(product.paymentMethods) ? product.paymentMethods : [],
    commerceEnabled: product.commerceEnabled !== false && productContext?.commerceEnabled !== false,
    campaignId: product.campaignId || productContext.campaign?.id || "",
    livePriceFetchedAt,
  };
}

export async function insertProductReplyMessage(db, {
  session,
  character,
  userId,
  characterId,
  product,
  displayOrder,
}) {
  if (!product) return null;
  const productMessage = await insertMessage(db, {
    sessionId: session.id,
    characterId,
    senderType: "character",
    senderLabel: character.name,
    contentType: "product",
    text: product.name,
    product,
    displayOrder,
    sourceType: product.sourceType || productContextSourceType(product),
    sourceRef: product.sourceRef || productContextSourceRef(product),
  });

  await recordProductBubbleTriggered(db, {
    userId,
    sessionId: session.id,
    messageId: productMessage.id,
    character,
    product,
  });
  return productMessage;
}

function productContextSourceType(product = {}) {
  return product.campaignId ? "promotion_campaign" : "product_api";
}

function productContextSourceRef(product = {}) {
  return product.campaignId ? "promotion-campaign-product" : "site-product-context";
}
