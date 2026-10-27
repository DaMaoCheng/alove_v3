import { nameCandidateRecall, hasNameCandidateAnchor, buildNameCandidate, unmatchedNameCandidateTerms } from './product-name-candidate-service.js';
import { productAlternativeIntent, matchesRequestedRetro, hasAlternativeGarmentEvidence, markAlternativeSearch, hasProductAlternativeSearch } from './product-alternative-service.js';
import { originalProductRequestContext } from "./product-request-scope-service.js";
import { markCandidateContextSource } from "./product-candidate-source-proof.js";
import {
  filterProductsByIntent,
  filterProductsByRequestedSizes,
  buildProductCandidateConstraintIntent,
  normalizeProductQueryTeamAlias,
} from "./product-intent-service.js";
import {
  selectProductsForRequestedVariants,
  PRODUCT_CANDIDATE_FETCH_LIMIT,
  prepareProductCandidates,
  productIdentityKeys,
} from "./product-candidate-ranking-service.js";
import { filterProductsBySearchCriteria, normalizeSearchText, unmatchedProductSearchTerms } from "./product-search-match-service.js";
import { buildProductSearchQueryVariants } from "./product-search-query-service.js";
import {
  fetchProductSummary,
  fetchTtmallProductById,
  fetchShopifySearchPageProducts,
  isShopifyPublicProductSource,
} from "./product-source-service.js";
import { isTtmallProductSource } from "./product-source-ttmall-service.js";
import { hasHardProductRequirement } from "./product-search-decision-service.js";
import { requestedProductEdition, resolveProductEditions, classifyCatalogueEditions } from "./product-edition-service.js";
import { evaluateProductAttributeMatch } from "./product-attribute-evidence-service.js";

// Chat explicitly opts into candidates. Public catalogue/KitShop consumers keep
// the strict array contract and can never receive an unconfirmed substitute.
export async function executeProductSearchDetailed(options = {}) {
  const intent = options.searchIntent || {};
  const nameRecall = nameCandidateRecall(intent);
  if (intent.candidateSearchAllowed !== true || intent.requestedPrintNumber || intent.customizationRequest) {
    const matches = await executeProductSearch(options);
    if (intent.candidateSearchAllowed === true && intent.confirmedCandidateId) {
      // Strict customization/print filtering remains unchanged. Identity assent
      // still needs review even when every requested attribute already matches.
      const candidates = matches.filter(product => String(product.productId || product.id || '') === intent.confirmedCandidateId)
        .map(product => ({ product, assessment: evaluateProductAttributeMatch(product, intent) }))
        .filter(({ assessment }) => assessment.status !== 'mismatch')
        .slice(0, 1).map(({ product, assessment }) => ({ ...product, matchStatus: 'candidate',
          candidateUnknownFields: assessment.unknownFields, giveaway: product.attributeEvidence?.giveaway ?? null,
          unmatchedSearchTerms: normalizeArray(intent.requestedKeywords).filter(term => !String(product.name || '').toLowerCase().includes(term.toLowerCase())) }));
      return { matches: [], candidates };
    }
    return { matches, candidates: [] };
  }
  if (!intent.shouldLoadProductContext || intent.cardAllowed === false || intent.productScopePending
    || intent.scopeUnverified || intent.nonShoppingReason || intent.searchState === "clarification_exhausted"
    || (!intent.requestedTeam && !productAlternativeIntent(intent) && !nameRecall) || !intent.requestedProductType) return { matches: [], candidates: [] };
  const fetchProducts = options.fetchProducts || fetchProductSummary;
  const query = safeString(intent.confirmedCandidateId && intent.productCandidateState?.proposal?.name || options.query || intent.query);
  const anchor = [intent.requestedTeam, intent.requestedVariant, intent.requestedSeason].filter(Boolean).join(" ");
  const uncertainWords = normalizeArray(intent.requestedKeywords);
  const nameQuery = query.split(/\s+/).filter(word => !uncertainWords.includes(word.toLowerCase())).join(" ");
  const requestedVariants = selectProductsForRequestedVariants([], intent).unfulfilledVariants;
  const variantAnchors = requestedVariants.length > 1
    ? requestedVariants.map(variant => [intent.requestedTeam, variant, intent.requestedSeason].filter(Boolean).join(" ")) : [];
  const year = /^\d{4}$/.test(String(intent.requestedSeason || '')) ? Number(intent.requestedSeason) : 0;
  const seasonAnchors = year ? [year - 1, year].map(start => [intent.requestedTeam, intent.requestedVariant,
    `${start}/${String(start + 1).slice(-2)}`].filter(Boolean).join(' ')) : [];
  const queries = uniqueQueries([query, ...seasonAnchors, nameRecall?.query, nameQuery, anchor, ...variantAnchors]).slice(0, 3);
  const collected = [], identities = new Set();
  let partialMatches = [];
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
    let recallQuery = queries[queryIndex];
    // Spend the existing last recall slot on an unmet canonical target instead
    // of repeating the scalar first variant. All filtering still uses full intent.
    if (requestedVariants.length > 1 && queryIndex > 0 && queryIndex === queries.length - 1) {
      const missing = selectProductsForRequestedVariants(partialMatches, intent).unfulfilledVariants[0];
      if (missing) recallQuery = [intent.requestedTeam, missing, intent.requestedSeason].filter(Boolean).join(" ");
    }
    const rows = await fetchProducts(options.productApiUrl, { ...intent, query: recallQuery }, {
      currency: options.currency, encryptedAccessToken: options.encryptedAccessToken,
      maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT, throwOnError: true,
    });
    appendUniqueProducts(collected, identities, rows.filter(product => String(product.productId || product.id || "") !== intent.rejectedCandidateId));
    const exact = (await prepareCollectedProducts(intent.confirmedCandidateId ? collected.filter(product => String(product.productId || product.id || "") === intent.confirmedCandidateId) : collected, {
      originalQuery: query, searchIntent: intent, limit: options.limit,
      allowNearestAgeFallback: false, editionAssessment: { remaining: 0, cache: new Map() },
    })).filter(product => matchesRequestedRetro(product, intent)
      && (!nameRecall || filterProductsByRequestedSizes([product], intent.requestedSizes).length));
    if (exact.length && !exact.some(product => product.attributeEvidence?.giveaway === true) && (!intent.correctionSuggestion?.corrected || intent.confirmedCandidateId) && (!intent.productCandidateState?.suspectedTerm || intent.confirmedCandidateId)) {
      // A confirmed entity carries user-assent evidence. Do not return ordinary
      // matches and skip that evidence review just because its specs are known.
      if (intent.confirmedCandidateId) break;
      partialMatches = exact;
      if (selectProductsForRequestedVariants(exact, intent).unfulfilledVariants.length === 0) {
        return { matches: exact, candidates: [] };
      }
    }
  }
  if (partialMatches.length) return { matches: partialMatches, candidates: [] };
  if (intent.rejectedCandidateId) return { matches: [], candidates: [] };
  // Relax only the unresolved name/attribute verification for a proposal.
  // Team, season, garment, audience, variant and size constraints remain hard.
  const base = buildProductCandidateConstraintIntent(intent);
  const candidates = filterProductsByIntent(intent.confirmedCandidateId ? collected.filter(product => String(product.productId || product.id || "") === intent.confirmedCandidateId) : collected, base, { allowNearestAgeFallback: false })
    .map(product => ({ product, assessment: evaluateProductAttributeMatch(product, intent) }))
    .filter(({ product, assessment }) => product?.url && product.available !== false && assessment.status !== "mismatch" && matchesRequestedRetro(product, intent) && (!nameRecall || (intent.requestedTeam || hasNameCandidateAnchor(product, nameRecall))
      && filterProductsByRequestedSizes([product], intent.requestedSizes).length))
    .map(({ product, assessment }) => ({ ...product, matchStatus: "candidate",
      candidateUnknownFields: assessment.unknownFields, giveaway: product.attributeEvidence?.giveaway ?? null,
      unmatchedSearchTerms: normalizeArray(intent.requestedKeywords).filter(term => !String(product.name || "").toLowerCase().includes(term.toLowerCase())) }));
  const ranked = prepareProductCandidates(candidates, { searchIntent: base, limit: 10 })
    .sort((a, b) => a.unmatchedSearchTerms.length - b.unmatchedSearchTerms.length || catalogueNameDistance(a.name, query) - catalogueNameDistance(b.name, query));
  // Search summaries may omit print/activity fields. Hydrate only the two best
  // proposals and reapply every constraint before showing one catalogue card.
  const hydrate = options.fetchCandidateDetail || (fetchProducts === fetchProductSummary && isTtmallProductSource(options.productApiUrl) ? fetchTtmallProductById : null);
  for (const candidate of ranked.slice(0, 2)) {
    const detail = hydrate ? await hydrate(options.productApiUrl, candidate.productId || candidate.id, { currency: options.currency, throwOnError: true }) : candidate;
    if (!detail || String(detail.productId || detail.id) !== String(candidate.productId || candidate.id)
      || detail.available === false || !filterProductsByIntent([detail], base).length) continue;
    const assessment = evaluateProductAttributeMatch(detail, intent);
    if (assessment.status === "mismatch" || nameRecall && !filterProductsByRequestedSizes([detail], intent.requestedSizes).length
      || nameRecall && !intent.requestedTeam
      && (!hasNameCandidateAnchor(detail, nameRecall) || !matchesRequestedRetro(detail, intent))) continue;
    return { matches: [], candidates: [{ ...detail, matchStatus: "candidate", candidateUnknownFields: assessment.unknownFields,
      giveaway: detail.attributeEvidence?.giveaway ?? null, unmatchedSearchTerms: candidate.unmatchedSearchTerms }] };
  }
  const alternativeIntent = productAlternativeIntent(intent);
  if (alternativeIntent) {
    const selectAlternative = async rows => {
      const alternatives = (await prepareCollectedProducts(rows.filter(product => hasAlternativeGarmentEvidence(product, intent)), {
        originalQuery: '', searchIntent: alternativeIntent, limit: 5, allowNearestAgeFallback: false,
        editionAssessment: { remaining: 0, cache: new Map() },
      })).filter(product => product?.url && product.available !== false && !product.attributeEvidence?.giveaway
        && !(filterProductsByIntent([product], intent).length && matchesRequestedRetro(product, intent)));
      for (const product of alternatives) {
        const result = markAlternativeSearch({ matches: [], candidates: [], alternatives: [{ ...product, matchStatus: 'alternative' }] }, intent, queries);
        if (hasProductAlternativeSearch(result)) return result;
      }
      return null;
    };
    // Successful original recalls may already contain a known different-season
    // garment. Reuse those real facts before spending the one extra recall.
    const fromOriginalPool = await selectAlternative(collected);
    if (fromOriginalPool) return fromOriginalPool;
    const possibleName = nameRecall && collected.map(product => buildNameCandidate(product, intent, queries)).find(Boolean);
    if (possibleName) return { matches: [], candidates: [possibleName] };
    const rows = await fetchProducts(options.productApiUrl, { ...alternativeIntent,
      query: [intent.requestedTeam, alternativeIntent.requestedVariant, ...(!intent.requestedTeam ? nameRecall ? [nameRecall.anchor] : normalizeArray(intent.requestedKeywords) : [])].filter(Boolean).join(' ') }, {
      currency: options.currency, encryptedAccessToken: options.encryptedAccessToken,
      maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT, throwOnError: true,
    });
    const fromAdditionalRecall = await selectAlternative(rows);
    if (fromAdditionalRecall) return fromAdditionalRecall;
    const additionalName = nameRecall && rows.map(product => buildNameCandidate(product, intent, queries)).find(Boolean);
    if (additionalName) return { matches: [], candidates: [additionalName] };
  }
  return { matches: [], candidates: [] };
}

function catalogueNameDistance(name, query) {
  const normalize = value => String(value || "").toLowerCase().replace(/\[[^\]]*\]/g, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 255);
  const a = normalize(name), b = normalize(query), row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = old;
    }
  }
  return row[b.length];
}

export function productCandidateContext(products = [], searchIntent = {}, location = {}) {
  const candidates = products.filter(product => product.matchStatus === "candidate").slice(0, 2);
  const unmatchedTerms = product => {
    const nameTerms = unmatchedNameCandidateTerms(product, searchIntent);
    if (nameTerms !== null) return nameTerms;
    const keywords = (Array.isArray(searchIntent.requestedKeywords) ? searchIntent.requestedKeywords : [])
      .filter(value => typeof value === 'string' && value.trim().length <= 80).slice(0, 8);
    // Old source metadata cannot resurrect an earlier/withdrawn condition.
    const current = keywords.map(normalizeSearchText);
    const retained = (Array.isArray(product.unmatchedSearchTerms) ? product.unmatchedSearchTerms : [])
      .filter(term => typeof term === 'string' && term.trim().length <= 80 && normalizeSearchText(term)
        && current.some(value => ` ${value} `.includes(` ${normalizeSearchText(term)} `))).slice(0, 8);
    return unmatchedProductSearchTerms(product, [...keywords, ...retained]);
  };
  const entityConfirmed = Boolean(searchIntent.confirmedCandidateId);
  const proposal = searchIntent.productCandidateState?.proposal;
  const sameProposal = entityConfirmed && proposal?.status === 'confirmed' && proposal.candidateId === searchIntent.confirmedCandidateId
    && candidates.some(product => String(product.productId || product.id || '') === proposal.candidateId);
  const bounded = (value, limit) => typeof value === 'string' && value.length <= limit ? value.trim() : '';
  const requestedConditionEvidence = [...new Set([...(Array.isArray(searchIntent.productCandidateState?.requestedConditionEvidence) ? searchIntent.productCandidateState.requestedConditionEvidence : []),
    searchIntent.productCandidateState?.targetEvidence].filter(value => bounded(value, 1200)))].slice(0, 4);
  return candidates.length ? markCandidateContextSource({ requiresConfirmation: !entityConfirmed, entityConfirmed, requestedConditionEvidence,
    ...(originalProductRequestContext(searchIntent.productRequestState) ? { originalRequestContext: originalProductRequestContext(searchIntent.productRequestState) } : {}),
    ...(entityConfirmed ? { entityConfirmationEvidence: sameProposal ? bounded(proposal.confirmationEvidence, 240) : '',
      priorConfirmationQuestion: sameProposal ? bounded(proposal.reply, 2000) : '' } : {}), products: candidates.map(product => ({
    id: String(product.productId || product.id || "").slice(0, 128), name: String(product.name || "").slice(0, 255),
    price: typeof product.price === 'string' ? product.price.slice(0, 80) : '',
    unknownFields: product.candidateUnknownFields || [], unmatchedSearchTerms: unmatchedTerms(product),
    attributeEvidence: product.attributeEvidence || null,
    ...(product.matchStatus === 'candidate' && product.alternative ? { catalogueDifference: product.alternative } : {}),
  })) }, searchIntent, candidates, location) : null;
}

export async function executeProductSearch({
  productApiUrl = "",
  query = "",
  searchIntent = {},
  currency = "",
  encryptedAccessToken = "",
  limit = 5,
  allowNearestAgeFallback = false,
  popularityScores = null,
  fetchProducts = fetchProductSummary,
  includePublicSearchFallback = true,
  trustSourceResults = false,
  classifyEditions = fetchProducts === fetchProductSummary ? classifyCatalogueEditions : null,
} = {}) {
  const canTrustSourceResults = trustSourceResults && !hasHardProductRequirement(searchIntent) && !requestedProductEdition(searchIntent);
  const editionAssessment = { remaining: 10, cache: new Map() };
  const allRecallQueries = canTrustSourceResults
    ? [safeString(query || searchIntent.query)].filter(Boolean)
    : buildProductRecallQueries({ query, searchIntent });
  // TTMall hydrates each search row through a detail request. Keep its
  // latency bounded by trying the three most useful recall variants instead
  // of replaying every generic fallback query.
  const recallQueries = isTtmallProductSource(productApiUrl)
    ? allRecallQueries.slice(0, 3)
    : allRecallQueries;
  const collected = [];
  const identities = new Set();

  for (const recallQuery of recallQueries) {
    const recallIntent = { ...searchIntent, query: recallQuery };
    const rows = await fetchProducts(productApiUrl, recallIntent, {
      currency,
      encryptedAccessToken,
      maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT,
      throwOnError: true,
    });
    appendUniqueProducts(collected, identities, rows);
    const prepared = await prepareCollectedProducts(collected, {
      classifyEditions, editionAssessment,
      originalQuery: query,
      searchIntent,
      limit,
      allowNearestAgeFallback,
      popularityScores,
      trustSourceResults: canTrustSourceResults,
    });
    if (canTrustSourceResults && prepared.length && selectProductsForRequestedVariants(prepared, searchIntent).unfulfilledVariants.length === 0) return prepared;
    if (prepared.length >= normalizeLimit(limit) && selectProductsForRequestedVariants(prepared, searchIntent).unfulfilledVariants.length === 0) return prepared;
  }

  if (includePublicSearchFallback && isShopifyPublicProductSource(productApiUrl)) {
    for (const recallQuery of recallQueries) {
      const recallIntent = { ...searchIntent, query: recallQuery };
      const rows = await fetchShopifySearchPageProducts(productApiUrl, recallIntent, {
        currency,
        maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT,
        throwOnError: true,
      });
      appendUniqueProducts(collected, identities, rows);
      const prepared = await prepareCollectedProducts(collected, {
        classifyEditions, editionAssessment,
        originalQuery: query,
        searchIntent,
        limit,
        allowNearestAgeFallback,
        popularityScores,
        trustSourceResults: canTrustSourceResults,
      });
      if (canTrustSourceResults && prepared.length && selectProductsForRequestedVariants(prepared, searchIntent).unfulfilledVariants.length === 0) return prepared;
      if (prepared.length >= normalizeLimit(limit) && selectProductsForRequestedVariants(prepared, searchIntent).unfulfilledVariants.length === 0) return prepared;
    }
  }

  const exact = await prepareCollectedProducts(collected, {
    classifyEditions, editionAssessment,
    originalQuery: query,
    searchIntent,
    limit,
    allowNearestAgeFallback,
    popularityScores,
    trustSourceResults: canTrustSourceResults,
  });
  if (exact.length || searchIntent.customerServiceKnowledgeRequest || searchIntent.isCorrection || searchIntent.customizationRequest || !searchIntent.shouldLoadProductContext) return exact;
  // Unknown catalogue names must not require a maintained team dictionary.
  // Try at most two shorter prefixes, preserving every structured constraint.
  const keywords = normalizeArray(searchIntent.requestedKeywords);
  const anchors = searchIntent.requestedTeam
    ? [searchIntent.requestedTeam]
    : [keywords.slice(0, -1).join(" "), keywords.slice(0, -2).join(" ")]
      .filter((anchor) => anchor.split(" ").length >= 2);
  for (const anchor of [...new Set(anchors)].slice(0, 2)) {
    const anchorTerms = anchor.toLowerCase().split(/\s+/);
    const unmatchedSearchTerms = keywords.filter((word) => !anchorTerms.includes(word));
    if (!unmatchedSearchTerms.length) continue;
    const fallbackIntent = { ...searchIntent, query: anchor, requestedKeywords: anchorTerms };
    const rows = await fetchProducts(productApiUrl, fallbackIntent, {
      currency, encryptedAccessToken, maxProducts: PRODUCT_CANDIDATE_FETCH_LIMIT, throwOnError: true,
    });
    const normalizedRows = await resolveProductEditions(rows, { searchIntent, classifyEditions, assessment: editionAssessment });
    const matches = filterProductsByIntent(normalizedRows, searchIntent, { allowNearestAgeFallback: false })
      .filter((product) => (` ${String(product.name).toLowerCase().replace(/[^a-z0-9]+/g, " ")} `).includes(` ${anchor.toLowerCase()} `));
    const prepared = prepareProductCandidates(matches, { searchIntent: fallbackIntent, limit, popularityScores });
    if (prepared.length) return prepared.map((product) => ({ ...product, unmatchedSearchTerms }));
  }
  return [];
}

export function buildProductRecallQueries({ query = "", searchIntent = {} } = {}) {
  const team = safeString(searchIntent.requestedTeam);
  const keywords = normalizeArray(searchIntent.requestedKeywords);
  const anchor = [team, ...keywords].filter(Boolean).join(" ");
  const features = normalizeArray(searchIntent.requestedFeatures)
    .map((value) => value.replace(/_/g, " "));
  const variants = normalizeArray(
    searchIntent.requestedVariants?.length
      ? searchIntent.requestedVariants
      : [searchIntent.requestedVariant]
  );
  const detailed = [
    anchor,
    ...features,
    ...variants,
    safeString(searchIntent.requestedColor),
    safeString(searchIntent.requestedSeason),
    safeString(searchIntent.requestedProductType),
  ].filter(Boolean).join(" ");
  const focused = [
    anchor,
    ...features,
    ...variants,
    safeString(searchIntent.requestedColor),
  ].filter(Boolean).join(" ");
  const queryVariants = buildProductSearchQueryVariants(query);
  const titleFallbacks = [
    queryVariants[2],
    queryVariants.at(-1),
  ].filter(Boolean);
  const values = [
    detailed,
    focused,
    anchor,
    safeString(searchIntent.query),
    ...titleFallbacks,
  ];
  return uniqueQueries(
    values.map((value) => normalizeProductQueryTeamAlias(value, searchIntent))
  ).slice(0, 5);
}

async function prepareCollectedProducts(products = [], {
  originalQuery = "",
  searchIntent = {},
  limit = 5,
  allowNearestAgeFallback = false,
  popularityScores = null,
  trustSourceResults = false,
  classifyEditions = null,
  editionAssessment,
} = {}) {
  if (requestedProductEdition(searchIntent)) {
    const baseIntent = { ...searchIntent, requestedEdition: "", requestedFeatures: (searchIntent.requestedFeatures || []).filter((feature) => !["authentic", "fan_version"].includes(feature)) };
    const baseMatches = filterProductsByIntent(products, baseIntent, { allowNearestAgeFallback });
    products = await resolveProductEditions(baseMatches, { searchIntent, classifyEditions, assessment: editionAssessment });
  }
  const intentMatches = trustSourceResults
    ? products
    : filterProductsByIntent(products, searchIntent, { allowNearestAgeFallback });
  let filtered = trustSourceResults
    ? intentMatches
    : filterProductsBySearchCriteria(intentMatches, originalQuery, searchIntent);
  // A player name is a soft anchor when a trusted team has already matched.
  // If the catalogue has the team's current shirt but does not print that
  // player in its title, keep the hard team/size/style constraints and return
  // the closest verified team item instead of a false no-match.
  const softPlayerNames = new Set(["cristiano", "ronaldo", "messi", "palmer", "yamal", "mbappe", "haaland", "salah", "neymar", "bellingham", "vinicius"]);
  if (!trustSourceResults && !filtered.length && searchIntent.requestedTeam && searchIntent.requestedKeywords?.length
    && searchIntent.requestedKeywords.every((keyword) => softPlayerNames.has(safeString(keyword).toLowerCase()))) {
    filtered = filterProductsBySearchCriteria(intentMatches, originalQuery, {
      ...searchIntent,
      requestedKeywords: [],
    }).map((product) => ({ ...product, unmatchedSearchTerms: normalizeArray(searchIntent.requestedKeywords) }));
  }
  const rankingIntent = trustSourceResults
    ? { ...searchIntent, query: "recommended", requestedKeywords: [] }
    : searchIntent;
  return prepareProductCandidates(filtered, { searchIntent: rankingIntent, limit, popularityScores });
}

function appendUniqueProducts(target = [], identities = new Set(), products = []) {
  for (const product of Array.isArray(products) ? products : []) {
    const keys = productIdentityKeys(product);
    const key = keys[0] || safeString(product?.name).toLowerCase();
    if (!key || keys.some((candidate) => identities.has(candidate))) continue;
    target.push(product);
    for (const candidate of keys) identities.add(candidate);
  }
}

function uniqueQueries(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const text = safeString(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value).toLowerCase())
    .filter(Boolean))];
}

function normalizeLimit(value) {
  return Math.max(1, Math.min(10, Number(value) || 1));
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
