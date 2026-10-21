export function filterProductsByTitle(products = [], query = "") {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  const rows = Array.isArray(products) ? products.filter((item) => item?.name) : [];
  if (!normalizedQuery) return rows;
  const queryTokens = buildTitleSearchTokens(normalizedQuery);
  return rows
    .map((product) => ({ product, score: scoreTitleMatch(product.name, normalizedQuery, compactQuery, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.product);
}

export function filterProductsBySearchCriteria(products = [], query = "", searchIntent = null) {
  const rows = Array.isArray(products) ? products.filter((item) => item?.name) : [];
  if (["popular", "budget"].includes(safeString(searchIntent?.intent))) return rows;
  const hasStructuredIntent = Boolean(
    safeString(searchIntent?.requestedTeam)
    || safeString(searchIntent?.requestedSeason)
    || safeString(searchIntent?.requestedVariant)
    || (Array.isArray(searchIntent?.requestedVariants) && searchIntent.requestedVariants.length)
    || safeString(searchIntent?.requestedProductType)
    || safeString(searchIntent?.requestedAudience)
    || safeString(searchIntent?.requestedAgeRange)
    || safeString(searchIntent?.requestedColor)
    || (Array.isArray(searchIntent?.requestedFeatures) && searchIntent.requestedFeatures.length)
  );
  if (hasStructuredIntent) {
    const unresolvedKeywords = normalizeRequiredKeywords(searchIntent?.requestedKeywords);
    if (!unresolvedKeywords.length) return rows;
    const terminalPrefix = resolveTerminalSearchPrefix(query, unresolvedKeywords);
    return rows.filter((product) => productMatchesAllKeywords(product, unresolvedKeywords, terminalPrefix));
  }
  return filterProductsByTitle(rows, query);
}

function productMatchesAllKeywords(product = {}, keywords = [], terminalPrefix = "") {
  const text = normalizeSearchText([
    product.name,
    product.subtitle,
    product.summary,
    product.sku,
    product.tag,
    product.type,
    product.category,
  ].filter(Boolean).join(" "));
  return keywords.every((keyword) => matchesSearchKeyword(text, keyword, terminalPrefix));
}

function normalizeRequiredKeywords(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeSearchText(value))
    .filter((value) => value.length >= 2))];
}

export function filterProductsForAdmin(products = [], query = "") {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  const rows = Array.isArray(products) ? products.filter((item) => item?.name) : [];
  if (!normalizedQuery) return rows;
  return rows.filter((product) => {
    const title = normalizeSearchText(product.name);
    const sku = normalizeSearchText(product.sku);
    const id = normalizeSearchText(product.id);
    return title.includes(normalizedQuery)
      || sku.includes(normalizedQuery)
      || id.includes(normalizedQuery)
      || compactSearchText(product.name).includes(compactQuery)
      || compactSearchText(product.sku).includes(compactQuery)
      || compactSearchText(product.id).includes(compactQuery);
  });
}

export function buildCheckoutResolveQueries(product = {}) {
  const queries = [];
  const add = (value) => {
    const text = safeString(value);
    if (!text || queries.includes(text)) return;
    queries.push(text);
  };

  add(extractProductHandle(product.url));
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  for (const size of sizes) add(size?.sku);
  add(product.sku);
  add(product.name);
  return queries.slice(0, 6);
}

export function findResolvedCheckoutProduct(products = [], target = {}) {
  const rows = Array.isArray(products) ? products.filter((item) => item?.name) : [];
  if (!rows.length) return null;

  const normalizedTargetUrl = safeString(target.url).toLowerCase();
  const normalizedTargetName = normalizeSearchText(target.name);
  const normalizedTargetHandle = extractProductHandle(target.url);
  const targetIdSet = new Set([
    safeString(target.productId).toLowerCase(),
    safeString(target.id).toLowerCase(),
  ].filter(Boolean));
  const targetVariantSet = new Set([
    safeString(target.variantId).toLowerCase(),
    ...(Array.isArray(target.sizes) ? target.sizes.map((size) => safeString(size?.variantId).toLowerCase()) : []),
  ].filter(Boolean));
  const targetSkuSet = new Set([
    safeString(target.sku).toLowerCase(),
    ...(Array.isArray(target.sizes) ? target.sizes.map((size) => safeString(size?.sku).toLowerCase()) : []),
  ].filter(Boolean));

  const scored = rows
    .map((product) => ({ product, match: scoreResolvedCheckoutProduct(product, {
      normalizedTargetUrl,
      normalizedTargetName,
      normalizedTargetHandle,
      targetIdSet,
      targetVariantSet,
      targetSkuSet,
    }) }))
    .filter((item) => item.match.matched)
    .sort((left, right) => right.match.score - left.match.score);

  return scored[0]?.product || null;
}

export function mergeResolvedCheckoutProduct(original = {}, resolved = {}) {
  return {
    ...resolved,
    ...original,
    url: resolved.url || original.url || "",
    sizes: mergeResolvedSizes(original.sizes, resolved.sizes),
    imageUrl: resolved.imageUrl || original.imageUrl || "",
    imageUrls: Array.isArray(resolved.imageUrls) && resolved.imageUrls.length ? resolved.imageUrls : (Array.isArray(original.imageUrls) ? original.imageUrls : []),
    priceNow: resolved.priceNow || resolved.price || original.priceNow || original.price || "",
    price: resolved.price || original.price || "",
    priceWas: resolved.priceWas || original.priceWas || "",
    sizeChart: resolved.sizeChart || null,
    sizeChartResolved: resolved.sizeChartResolved === true,
  };
}

export function normalizeSearchText(value = "") {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTitleSearchTokens(normalizedQuery = "") {
  return normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !TITLE_SEARCH_SOFT_WORDS.has(token));
}

function scoreTitleMatch(title = "", normalizedQuery = "", compactQuery = "", queryTokens = []) {
  const normalizedTitle = normalizeSearchText(title);
  const compactTitle = compactSearchText(title);
  if (!normalizedTitle) return 0;
  if (normalizedTitle.includes(normalizedQuery) || (compactQuery && compactTitle.includes(compactQuery))) return 100;
  if (!queryTokens.length) return 0;

  const terminalPrefix = resolveTerminalSearchPrefix(normalizedQuery, queryTokens);
  if (terminalPrefix && !matchesSearchKeyword(normalizedTitle, terminalPrefix, terminalPrefix)) return 0;
  let matched = 0;
  for (const token of queryTokens) {
    if (matchesSearchKeyword(normalizedTitle, token, terminalPrefix)) {
      matched += 1;
    }
  }
  const coverage = queryTokens.length >= 5 ? 0.8 : 0.6;
  const required = Math.max(1, Math.ceil(queryTokens.length * coverage));
  if (matched < required) return 0;
  return matched * 10 - Math.max(queryTokens.length - matched, 0);
}

function resolveTerminalSearchPrefix(query = "", candidateKeywords = []) {
  const terminalToken = normalizeSearchText(query).split(/\s+/).at(-1) || "";
  const normalizedCandidates = new Set((Array.isArray(candidateKeywords) ? candidateKeywords : [])
    .map((value) => normalizeSearchText(value))
    .filter(Boolean));
  if (!/^[a-z]+$/.test(terminalToken) || terminalToken.length < 3) return "";
  return normalizedCandidates.has(terminalToken) ? terminalToken : "";
}

function matchesSearchKeyword(text = "", keyword = "", terminalPrefix = "") {
  const isTerminalPrefix = terminalPrefix && keyword === terminalPrefix;
  const suffix = isTerminalPrefix ? "[a-z0-9]*" : "";
  return new RegExp(`(?:^|\\s)${escapeRegExp(keyword)}${suffix}(?:\\s|$)`, "i").test(text);
}

const TITLE_SEARCH_SOFT_WORDS = new Set([
  "show",
  "see",
  "find",
  "want",
  "need",
  "looking",
  "look",
  "for",
  "latest",
  "current",
  "season",
  "football",
  "shirt",
  "shirts",
  "jersey",
  "jerseys",
  "kit",
  "kits",
  "soccer",
]);

function scoreResolvedCheckoutProduct(product = {}, target = {}) {
  let score = 0;
  const url = safeString(product.url).toLowerCase();
  const handle = extractProductHandle(product.url);
  const name = normalizeSearchText(product.name);
  const idValues = new Set([
    safeString(product.productId).toLowerCase(),
    safeString(product.id).toLowerCase(),
  ].filter(Boolean));
  const variantValues = new Set([
    safeString(product.variantId).toLowerCase(),
    ...(Array.isArray(product.sizes) ? product.sizes.map((size) => safeString(size?.variantId).toLowerCase()) : []),
  ].filter(Boolean));
  const skuValues = new Set([
    safeString(product.sku).toLowerCase(),
    ...(Array.isArray(product.sizes) ? product.sizes.map((size) => safeString(size?.sku).toLowerCase()) : []),
  ].filter(Boolean));

  let matched = false;
  if ([...target.targetIdSet].some((id) => idValues.has(id))) {
    score += 120;
    matched = true;
  }
  if (url && target.normalizedTargetUrl && url === target.normalizedTargetUrl) {
    score += 100;
    matched = true;
  }
  if (handle && target.normalizedTargetHandle && handle === target.normalizedTargetHandle) {
    score += 60;
    matched = true;
  }
  if (name && target.normalizedTargetName && name === target.normalizedTargetName) {
    score += 40;
  }
  if ([...target.targetVariantSet].some((variantId) => variantValues.has(variantId))) {
    score += 35;
    matched = true;
  }
  if ([...target.targetSkuSet].some((sku) => skuValues.has(sku))) {
    score += 30;
    matched = true;
  }
  if (Array.isArray(product.sizes) && product.sizes.some((size) => size?.variantId && size?.buyUrl)) score += 20;
  return { matched, score };
}

function mergeResolvedSizes(originalSizes = [], resolvedSizes = []) {
  const originalRows = Array.isArray(originalSizes) ? originalSizes : [];
  const resolvedRows = Array.isArray(resolvedSizes) ? resolvedSizes : [];
  if (!resolvedRows.length) return originalRows;
  if (!originalRows.length) return resolvedRows;
  const resolvedByLabel = new Map(resolvedRows.map((size) => [normalizeSearchText(size?.label), size]));
  return originalRows.map((size) => {
    const key = normalizeSearchText(size?.label);
    const match = key ? resolvedByLabel.get(key) : null;
    return match
      ? {
          ...match,
          ...size,
          available: match.available ?? size?.available ?? true,
          price: match.price || size?.price || "",
          priceWas: match.priceWas || size?.priceWas || "",
          variantId: match.variantId || "",
          buyUrl: match.buyUrl || "",
          sku: match.sku || size?.sku || "",
        }
      : {
          ...size,
          variantId: "",
          buyUrl: "",
        };
  });
}

function compactSearchText(value = "") {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

export function extractProductHandle(value = "") {
  const text = safeString(value);
  if (!text) return "";
  try {
    const pathname = new URL(text).pathname;
    const match = pathname.match(/\/products\/([^/?#]+)/i);
    const handle = safeString(match?.[1]).toLowerCase();
    return handle.length <= 255 ? handle : "";
  } catch {
    return "";
  }
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
