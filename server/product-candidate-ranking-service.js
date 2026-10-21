import { productMatchesVariant } from "./product-intent-service.js";

export const PRODUCT_CANDIDATE_FETCH_LIMIT = 50;

const SEASON_SORT_SOFT_KEYWORDS = new Set([
  "why", "dont", "don", "do", "you", "have", "any", "football", "soccer", "club", "team", "shirt", "shirts", "jersey", "jerseys", "kit", "kits",
]);

export function prepareProductCandidates(products = [], { searchIntent = {}, limit = 5, popularityScores = null } = {}) {
  const rows = (Array.isArray(products) ? products : [])
    .map((product, index) => ({ ...product, __sourceIndex: index }))
    .filter((product) => product?.name)
    .filter(isDisplayableProduct);
  const matched = filterProductsByCandidateQuery(rows, searchIntent);
  const ranked = sortProductsByCandidatePreference(matched, searchIntent, popularityScores);
  return pickVariantPair(ranked, searchIntent).slice(0, normalizeLimit(limit)).map(stripInternalFields);
}

export function productIdentityKeys(product = {}) {
  return [
    product.id,
    product.productId,
    product.sku,
    product.url,
    product.name,
    product.title,
  ].map(normalizeIdentity).filter(Boolean);
}

export function isDisplayableProduct(product = {}) {
  if (!product?.name) return false;
  const statusText = normalizeText([
    product.status,
    product.productStatus,
    product.product_status,
    product.stock,
    product.availability,
    product.tag,
  ].filter(Boolean).join(" "));
  if (/(?:404|not found|deleted|unpublished|draft|archived)/i.test(statusText)) return false;
  return true;
}

// Allocate one existing, distinct catalogue identity per requested variant.
// Missing evidence stays a missing target; another home item cannot fill away.
export function selectProductsForRequestedVariants(products = [], searchIntent = {}) {
  const selected = [], identities = new Set(), unfulfilledVariants = [];
  for (const variant of normalizeRequestedVariants(searchIntent)) {
    const product = products.find(row => !selected.includes(row)
      && !productIdentityKeys(row).some(key => identities.has(key))
      && deliveryProductVariant(row) === variant);
    if (!product) { unfulfilledVariants.push(variant); continue; }
    selected.push(product);
    for (const key of productIdentityKeys(product)) identities.add(key);
  }
  return { products: selected, unfulfilledVariants };
}

// Delivery evidence excludes descriptive text that may contain the user's
// query (subtitle/tag fallbacks). An ambiguous title cannot establish a slot.
function deliveryProductVariant(product = {}) {
  const title = { name: product.name || product.title || "" };
  const variants = ["home", "away", "third"].filter(variant => productMatchesVariant(title, variant));
  if (variants.length > 1) return "";
  return variants[0] || normalizeVariant(title.name);
}

function pickVariantPair(products = [], searchIntent = {}) {
  const requestedVariants = normalizeRequestedVariants(searchIntent);
  if (requestedVariants.length > 1) {
    const requested = selectProductsForRequestedVariants(products, searchIntent).products;
    // Preserve alternatives as evidence; only the final delivery selector assigns
    // one card per target. An unfilled target must not be counted as complete.
    return [...requested, ...products.filter(product => !requested.includes(product))];
  }
  const requestedVariant = requestedVariants[0] || "";
  if (requestedVariant) {
    const exactVariant = products.filter((product) => productMatchesVariant(product, requestedVariant) || productVariant(product) === requestedVariant);
    return exactVariant;
  }
  if (products.length <= 1) return products;
  const first = products[0];
  const firstVariant = productVariant(first);
  const pairVariant = firstVariant === "home" ? "away" : firstVariant === "away" ? "home" : "";
  if (!pairVariant) return products;
  const pair = products.find((product) => product !== first && productVariant(product) === pairVariant && sameProductFamily(product, first));
  if (!pair) return products;
  return [first, pair, ...products.filter((product) => product !== first && product !== pair)];
}

function filterProductsByCandidateQuery(products = [], searchIntent = {}) {
  const query = normalizeText(searchIntent.query);
  if (!query || GENERIC_PRODUCT_QUERIES.has(query)) return products;
  const tokens = query
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .filter((token) => !PRODUCT_VARIANT_STOP_WORDS.has(token));
  if (!tokens.length) return products;
  const scored = products
    .map((product) => ({ product, score: scoreProductQueryMatch(product, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored.map((item) => item.product);
}

function scoreProductQueryMatch(product = {}, tokens = []) {
  const text = normalizeText([
    product.name,
    product.subtitle,
    product.sku,
    product.id,
    product.summary,
    ...(Array.isArray(product.features) ? product.features : []),
  ].filter(Boolean).join(" "));
  if (!text) return 0;
  let score = 0;
  for (const token of tokens) {
    if (new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?:\\s|$)`, "i").test(text)) score += 10;
  }
  return score;
}

function sortProductsByCandidatePreference(products = [], searchIntent = {}, popularityScores = null) {
  const popular = safeString(searchIntent.intent) === "popular";
  const requestedAudience = safeString(searchIntent.requestedAudience);
  const requestedVariants = normalizeRequestedVariants(searchIntent);
  const requestedKeywords = normalizeRequestedKeywords(searchIntent.requestedKeywords);
  const hasSpecificSearchKeyword = requestedKeywords.some((keyword) => !SEASON_SORT_SOFT_KEYWORDS.has(keyword));
  const hasExplicitPlayerKeywordMatch = requestedKeywords.length
    && products.some((product) => playerPrintKeywordScore(product, requestedKeywords) > 0);
  const hasCatalogueAnchor = Boolean(
    safeString(searchIntent.requestedTeam)
    || requestedKeywords.length
    || (safeString(searchIntent.query) && !GENERIC_PRODUCT_QUERIES.has(normalizeText(searchIntent.query)))
  );
  const isCurrentTeamShirtRequest = Boolean(
    searchIntent.preferLatestHome === true
    && safeString(searchIntent.requestedProductType) === "shirt"
    && hasCatalogueAnchor
    && !normalizeRequestedFeatures(searchIntent).length
  );
  const shouldPreferCurrentHome = isCurrentTeamShirtRequest && !requestedVariants.length;
  // Catalogue upload time is not the kit season: retro shirts are often added
  // later than the current release. Any recognised team-shirt search therefore
  // ranks the season encoded in its title before Shopify's publish timestamp.
  const shouldUseTitleSeason = Boolean(
    safeString(searchIntent.requestedProductType) === "shirt"
    && hasCatalogueAnchor
    && (
      !hasSpecificSearchKeyword
      || (
        !safeString(searchIntent.requestedTeam)
        && requestedKeywords.length === 1
        && normalizeText(searchIntent.query) === normalizeText(requestedKeywords[0])
      )
    )
  );
  // A generic search should show the base shirt before a pre-printed player version.
  // Only a keyword that matches the player name immediately before #number overrides this.
  const shouldPreferBaseProduct = !hasExplicitPlayerKeywordMatch;
  const requestedPrintNumber = safeString(searchIntent.requestedPrintNumber);
  return [...products].sort((left, right) => {
    const rightAgeDistance = nearestAgeDistance(right);
    const leftAgeDistance = nearestAgeDistance(left);
    if (rightAgeDistance !== leftAgeDistance) return leftAgeDistance - rightAgeDistance;
    if (safeString(searchIntent.requestedSizeProfile) === "plus_size") {
      const rightSizeProfileScore = sizeProfileScore(right);
      const leftSizeProfileScore = sizeProfileScore(left);
      if (rightSizeProfileScore !== leftSizeProfileScore) return rightSizeProfileScore - leftSizeProfileScore;
    }
    if (popular) {
      const rightScore = productPopularityScore(right, popularityScores);
      const leftScore = productPopularityScore(left, popularityScores);
      if (rightScore !== leftScore) return rightScore - leftScore;
    }
    if (!requestedAudience) {
      const rightAudienceScore = defaultAudienceScore(right);
      const leftAudienceScore = defaultAudienceScore(left);
      if (rightAudienceScore !== leftAudienceScore) return rightAudienceScore - leftAudienceScore;
    }
    if (requestedPrintNumber) {
      const rightPrintScore = requestedPrintNumberScore(right, requestedPrintNumber);
      const leftPrintScore = requestedPrintNumberScore(left, requestedPrintNumber);
      if (rightPrintScore !== leftPrintScore) return rightPrintScore - leftPrintScore;
    }
    if (hasExplicitPlayerKeywordMatch) {
      const rightKeywordScore = playerPrintKeywordScore(right, requestedKeywords);
      const leftKeywordScore = playerPrintKeywordScore(left, requestedKeywords);
      if (rightKeywordScore !== leftKeywordScore) return rightKeywordScore - leftKeywordScore;
    } else if (shouldPreferBaseProduct) {
      const rightBaseScore = baseProductScore(right);
      const leftBaseScore = baseProductScore(left);
      if (rightBaseScore !== leftBaseScore) return rightBaseScore - leftBaseScore;
    }
    const rightAnchorTitleScore = catalogueAnchorTitleScore(right, searchIntent);
    const leftAnchorTitleScore = catalogueAnchorTitleScore(left, searchIntent);
    if (rightAnchorTitleScore !== leftAnchorTitleScore) return rightAnchorTitleScore - leftAnchorTitleScore;
    const rightVariantScore = variantPreferenceScore(right, requestedVariants, shouldPreferCurrentHome);
    const leftVariantScore = variantPreferenceScore(left, requestedVariants, shouldPreferCurrentHome);
    if (rightVariantScore !== leftVariantScore) return rightVariantScore - leftVariantScore;
    if (shouldUseTitleSeason) {
      const rightSeason = productSeasonScore(right);
      const leftSeason = productSeasonScore(left);
      if (rightSeason !== leftSeason) return rightSeason - leftSeason;
    }
    const rightTime = productTimestamp(right);
    const leftTime = productTimestamp(left);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return Number(left.__sourceIndex || 0) - Number(right.__sourceIndex || 0);
  });
}

function sizeProfileScore(product = {}) {
  const text = normalizeText([product.name, product.subtitle, product.summary, product.tag].filter(Boolean).join(" "));
  if (/plus\s*size|extended\s*size|big\s*size/.test(text)) return 3;
  const labels = (Array.isArray(product.sizes) ? product.sizes : [])
    .map((size) => normalizeText(typeof size === "object" ? size.label || size.name : size));
  if (labels.some((label) => /(?:^|\s)(?:2xl|xxl|3xl|4xl|5xl)(?:\s|$)/i.test(label))) return 2;
  if (labels.some((label) => /(?:^|\s)xl(?:\s|$)/i.test(label))) return 1;
  return 0;
}

function requestedPrintNumberScore(product = {}, requestedPrintNumber = "") {
  const title = safeString(product.name || product.title || "");
  const expected = safeString(requestedPrintNumber);
  if (!expected) return 0;
  if (new RegExp(`#\\s*0*${escapeRegExp(expected)}\\b`, "i").test(title)) return 2;
  return /#\s*\d{1,3}\b/.test(title) ? 0 : 1;
}

function catalogueAnchorTitleScore(product = {}, searchIntent = {}) {
  const title = normalizeText(product.name || product.title || "");
  if (!title) return 0;
  const anchors = [
    safeString(searchIntent.requestedTeam),
    ...normalizeRequestedKeywords(searchIntent.requestedKeywords),
  ].map(normalizeText).filter(Boolean);
  if (!anchors.length) return 0;
  return anchors.every((anchor) => anchor.split(/\s+/).every((token) => (
    new RegExp(`(?:^|\\s)${escapeRegExp(token)}(?:\\s|$)`, "i").test(title)
  ))) ? 1 : 0;
}

function nearestAgeDistance(product = {}) {
  const distance = Number(product?.ageSizeFallback?.distance);
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function normalizeRequestedVariants(searchIntent = {}) {
  const values = Array.isArray(searchIntent?.requestedVariants)
    ? searchIntent.requestedVariants
    : [searchIntent?.requestedVariant];
  return [...new Set(values.map(normalizeVariant).filter(Boolean))];
}

function normalizeRequestedKeywords(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => safeString(item).toLowerCase())
    .filter((item) => item.length >= 3))].slice(0, 6);
}

function normalizeRequestedFeatures(searchIntent = {}) {
  return [...new Set((Array.isArray(searchIntent?.requestedFeatures) ? searchIntent.requestedFeatures : [])
    .map((item) => safeString(item).toLowerCase())
    .filter(Boolean))];
}

function variantPreferenceScore(product = {}, requestedVariants = [], shouldPreferCurrentHome = false) {
  const variant = productVariant(product);
  if (requestedVariants.length) {
    const position = requestedVariants.indexOf(variant);
    return position < 0 ? 0 : requestedVariants.length - position + 4;
  }
  if (shouldPreferCurrentHome) return variant === "home" ? 2 : 0;
  return 0;
}

function productSeasonScore(product = {}) {
  const text = [product.name, product.subtitle, product.summary].filter(Boolean).join(" ");
  const value = String(text || "");
  let latest = 0;
  for (const match of value.matchAll(/\b((?:19|20)\d{2})(?:\s*[\/-]\s*(?:(?:19|20)?\d{2}))?\b/g)) {
    latest = Math.max(latest, Number(match[1] || 0));
  }
  for (const match of value.matchAll(/\b(\d{2})\s*[\/-]\s*\d{2}\b/g)) {
    latest = Math.max(latest, normalizeShortSeasonYear(match[1]));
  }
  return latest;
}

function normalizeShortSeasonYear(value = "") {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 0 || year > 99) return 0;
  return year <= 29 ? 2000 + year : 1900 + year;
}

function playerPrintKeywordScore(product = {}, keywords = []) {
  const title = safeString(product.name || product.title || "");
  const playerName = title.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*)\s*#\s*\d{1,3}\b/)?.[1] || "";
  const text = normalizeText(playerName);
  return keywords.reduce((score, keyword) => (
    new RegExp(`(?:^|\\s)${escapeRegExp(keyword)}(?:\\s|$)`, "i").test(text) ? score + 1 : score
  ), 0);
}

function baseProductScore(product = {}) {
  const title = safeString(product.name || product.title || "");
  return /#\s*\d{1,3}\b/.test(title) ? 0 : 1;
}

function defaultAudienceScore(product = {}) {
  const text = normalizeText([
    product.name,
    product.subtitle,
    product.summary,
    product.tag,
    product.type,
    product.category,
    ...(Array.isArray(product.sizes) ? product.sizes.map((size) => size?.label || size?.name || "") : []),
    ...(Array.isArray(product.features) ? product.features : []),
  ].filter(Boolean).join(" "));
  if (/\b(?:kid|kids|child|children|youth|junior|boys|girls|years?|age)\b|儿童|童装|童款|小孩|青少年/i.test(text)) return 0;
  if (/\b(?:women|womens|female|ladies|girl|girls)\b|女款|女装|女士/i.test(text)) return 1;
  return 2;
}

function productPopularityScore(product = {}, popularityScores = null) {
  const scores = normalizePopularityScores(popularityScores);
  if (!scores.size) return 0;
  return productIdentityKeys(product).reduce((best, key) => Math.max(best, Number(scores.get(key) || 0)), 0);
}

function normalizePopularityScores(popularityScores = null) {
  if (popularityScores instanceof Map) return popularityScores;
  if (!popularityScores || typeof popularityScores !== "object") return new Map();
  return new Map(Object.entries(popularityScores).map(([key, value]) => [normalizeIdentity(key), Number(value || 0)]).filter(([key]) => key));
}

function productTimestamp(product = {}) {
  const values = [
    product.publishedAt,
    product.published_at,
    product.createdAt,
    product.created_at,
    product.updatedAt,
    product.updated_at,
  ];
  for (const value of values) {
    const time = Date.parse(safeString(value));
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function productVariant(product = {}) {
  for (const variant of ["home", "away", "third", "retro"]) {
    if (productMatchesVariant(product, variant)) return variant;
  }
  return normalizeVariant([
    product.name,
    product.subtitle,
    product.summary,
    product.tag,
    ...(Array.isArray(product.features) ? product.features : []),
  ].filter(Boolean).join(" "));
}

function normalizeVariant(value = "") {
  const text = normalizeText(value);
  if (/(?:^|\s)(?:home|主场)(?:\s|$)/i.test(text)) return "home";
  if (/(?:^|\s)(?:away|客场)(?:\s|$)/i.test(text)) return "away";
  if (/(?:^|\s)(?:third|3rd|第三)(?:\s|$)/i.test(text)) return "third";
  if (/(?:^|\s)(?:retro|复古|经典)(?:\s|$)/i.test(text)) return "retro";
  return "";
}

function sameProductFamily(left = {}, right = {}) {
  const leftTokens = productFamilyTokens(left);
  const rightTokens = productFamilyTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  return leftTokens.some((token) => rightTokens.includes(token));
}

function productFamilyTokens(product = {}) {
  return normalizeText([product.name, product.subtitle].filter(Boolean).join(" "))
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !PRODUCT_VARIANT_STOP_WORDS.has(token))
    .slice(0, 8);
}

function normalizeLimit(value = 5) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return 5;
  return Math.max(1, Math.min(16, Math.trunc(limit)));
}

function normalizeText(value = "") {
  return safeString(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentity(value = "") {
  const text = normalizeText(value);
  if (!text) return "";
  return text.replace(/\bhttps?\b\s*/g, "").replace(/\s+/g, " ").trim();
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}

function escapeRegExp(value = "") {
  return safeString(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripInternalFields(product = {}) {
  const { __sourceIndex, ageSizeFallback, ...publicProduct } = product;
  if (!ageSizeFallback || typeof ageSizeFallback !== "object") return publicProduct;
  const { distance, ...publicAgeSizeFallback } = ageSizeFallback;
  return {
    ...publicProduct,
    ageSizeFallback: publicAgeSizeFallback,
  };
}

const GENERIC_PRODUCT_QUERIES = new Set(["recommended", "football shirt"]);

const PRODUCT_VARIANT_STOP_WORDS = new Set([
  "home",
  "away",
  "third",
  "shirt",
  "shirts",
  "jersey",
  "jerseys",
  "football",
  "soccer",
  "kit",
  "kits",
  "world",
  "cup",
  "player",
  "version",
  "主场",
  "客场",
  "球衣",
]);
