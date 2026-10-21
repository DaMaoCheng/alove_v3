import { hasPendingProductRequest } from "./product-request-scope-service.js";

export const PRODUCT_SEARCH_STATE = Object.freeze({
  NOT_PRODUCT: "not_product",
  READY: "ready_to_search",
  NEEDS_CLARIFICATION: "needs_clarification",
  CLARIFICATION_EXHAUSTED: "clarification_exhausted",
  SOURCE_ERROR: "source_error",
});

export const PRODUCT_SEARCH_OUTCOME = Object.freeze({
  MATCHED: "matched",
  NEAREST_MATCH: "nearest_match",
  NO_MATCH: "no_match",
  NEEDS_CLARIFICATION: "needs_clarification",
  CLARIFICATION_EXHAUSTED: "clarification_exhausted",
  SOURCE_ERROR: "source_error",
});

export const MAX_PRODUCT_CLARIFICATION_ATTEMPTS = 2;
export const PRODUCT_CLARIFICATION_SOURCE_MARKER = "product-clarification";

export function isProductClarificationMessage(message = {}) {
  const sourceRef = String(message?.source_ref || message?.sourceRef || "").trim().toLowerCase();
  return sourceRef.includes(PRODUCT_CLARIFICATION_SOURCE_MARKER);
}

export function countRecentProductClarifications(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  let count = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index] || {};
    if (isProductClarificationMessage(message)) {
      count += 1;
      continue;
    }
    const senderType = String(message?.sender_type || message?.senderType || "").trim().toLowerCase();
    if (senderType === "user") continue;
    break;
  }
  return count;
}

export function resolveProductClarificationState(searchState = "", clarificationCount = 0) {
  if (searchState !== PRODUCT_SEARCH_STATE.NEEDS_CLARIFICATION) return searchState;
  return Number(clarificationCount) >= MAX_PRODUCT_CLARIFICATION_ATTEMPTS
    ? PRODUCT_SEARCH_STATE.CLARIFICATION_EXHAUSTED
    : searchState;
}

const SCALAR_REQUIREMENT_FIELDS = Object.freeze([
  "requestedTeam",
  "requestedProductType",
  "requestedAudience",
  "requestedAgeRange",
  "requestedSizeProfile",
  "requestedColor",
  "requestedSeason",
  "customizationRequest",
  "requestedPrintNumber",
  "requestedPrinting",
]);

export function mergeProductRequirement(current = {}, recent = {}, { reuseRecent = false } = {}) {
  if (!reuseRecent || !recent || typeof recent !== "object") return normalizeRequirement(current);
  const merged = normalizeRequirement(current);
  const clearedFields = new Set(normalizeFieldArray(current.clearFields));
  for (const field of SCALAR_REQUIREMENT_FIELDS) {
    if (!clearedFields.has(field) && !safeString(merged[field]) && safeString(recent[field])) {
      merged[field] = safeString(recent[field]);
    }
  }
  if (!clearedFields.has("requestedVariants") && !merged.requestedVariants.length) merged.requestedVariants = normalizeStringArray(
    recent.requestedVariants?.length ? recent.requestedVariants : [recent.requestedVariant]
  );
  if (!clearedFields.has("requestedFeatures") && !merged.requestedFeatures.length) merged.requestedFeatures = normalizeStringArray(recent.requestedFeatures);
  if (!clearedFields.has("requestedKeywords") && !merged.requestedKeywords.length) merged.requestedKeywords = normalizeStringArray(recent.requestedKeywords);
  merged.requestedVariant = merged.requestedVariants[0] || "";
  merged.clearFields = [...clearedFields];
  return merged;
}

export function resolveProductSearchReadiness(intent = {}) {
  if (hasPendingProductRequest(intent)) return intent.searchState === PRODUCT_SEARCH_STATE.CLARIFICATION_EXHAUSTED
    ? PRODUCT_SEARCH_STATE.CLARIFICATION_EXHAUSTED : PRODUCT_SEARCH_STATE.NEEDS_CLARIFICATION;
  if (intent.customerServiceKnowledgeRequest) return PRODUCT_SEARCH_STATE.NOT_PRODUCT;
  if (!intent.shouldLoadProductContext) return PRODUCT_SEARCH_STATE.NOT_PRODUCT;
  if (intent.correctionSuggestion?.corrected && intent.candidateSearchAllowed !== true) return PRODUCT_SEARCH_STATE.NEEDS_CLARIFICATION;
  if (safeString(intent.customizationRequest) === "ambiguous") return PRODUCT_SEARCH_STATE.NEEDS_CLARIFICATION;
  if (intent.explicitProductTrigger) return PRODUCT_SEARCH_STATE.READY;

  const hasCatalogueAnchor = Boolean(
    safeString(intent.requestedTeam)
    || safeString(intent.requestedAgeRange)
    || safeString(intent.requestedSizeProfile)
    || safeString(intent.requestedPrintNumber)
    || safeString(intent.requestedPrinting)
    || safeString(intent.requestedColor)
    || safeString(intent.requestedSeason)
    || normalizeStringArray(intent.requestedFeatures).length
    || normalizeStringArray(intent.requestedKeywords).length
    || ["popular", "budget"].includes(safeString(intent.intent))
    || intent.genericRecommendationRequest === true
  );
  const state = hasCatalogueAnchor
    ? PRODUCT_SEARCH_STATE.READY
    : PRODUCT_SEARCH_STATE.NEEDS_CLARIFICATION;
  return resolveProductClarificationState(state, intent.clarificationCount);
}

export function hasHardProductRequirement(intent = {}) {
  return Boolean(
    safeString(intent.requestedTeam)
    || safeString(intent.requestedProductType)
    || safeString(intent.requestedAudience)
    || safeString(intent.requestedAgeRange)
    || safeString(intent.requestedSizeProfile)
    || safeString(intent.requestedColor)
    || safeString(intent.requestedSeason)
    || safeString(intent.customizationRequest)
    || safeString(intent.requestedPrintNumber)
    || safeString(intent.requestedPrinting)
    || normalizeStringArray(intent.requestedVariants?.length ? intent.requestedVariants : [intent.requestedVariant]).length
    || normalizeStringArray(intent.requestedFeatures).length
    || normalizeStringArray(intent.requestedKeywords).length
  );
}

export function resolveProductSearchState(intent = {}, products = []) {
  if (hasPendingProductRequest(intent)) return { status: resolveProductSearchReadiness(intent), products: [] };
  const searchState = safeString(intent.searchState) || resolveProductSearchReadiness(intent);
  if (searchState === PRODUCT_SEARCH_STATE.SOURCE_ERROR) {
    return { status: PRODUCT_SEARCH_OUTCOME.SOURCE_ERROR, products: [] };
  }
  if (searchState === PRODUCT_SEARCH_STATE.NEEDS_CLARIFICATION) {
    return { status: PRODUCT_SEARCH_OUTCOME.NEEDS_CLARIFICATION, products: [] };
  }
  if (searchState === PRODUCT_SEARCH_STATE.CLARIFICATION_EXHAUSTED) {
    return { status: PRODUCT_SEARCH_OUTCOME.CLARIFICATION_EXHAUSTED, products: [] };
  }
  const rows = Array.isArray(products) ? products.filter((product) => product?.name) : [];
  if (!rows.length) return { status: PRODUCT_SEARCH_OUTCOME.NO_MATCH, products: [] };
  const nearest = rows.some((product) => product?.ageSizeFallback);
  return {
    status: nearest ? PRODUCT_SEARCH_OUTCOME.NEAREST_MATCH : PRODUCT_SEARCH_OUTCOME.MATCHED,
    products: rows,
  };
}

// An empty context alone cannot prove that a catalogue search was performed.
export function resolveUnconfirmedProductSearchOutcome(intent = {}, outcome = "") {
  const state = String(intent?.searchState || "");
  if (state === PRODUCT_SEARCH_STATE.SOURCE_ERROR || outcome === PRODUCT_SEARCH_OUTCOME.SOURCE_ERROR) return PRODUCT_SEARCH_OUTCOME.SOURCE_ERROR;
  for (const pending of [PRODUCT_SEARCH_OUTCOME.CLARIFICATION_EXHAUSTED, PRODUCT_SEARCH_OUTCOME.NEEDS_CLARIFICATION]) {
    if (state === pending || outcome === pending) return pending;
  }
  return [PRODUCT_SEARCH_OUTCOME.NO_MATCH, "candidate"].includes(outcome) ? outcome : "not_searched";
}

export function normalizeRequirement(value = {}) {
  const normalized = {};
  for (const field of SCALAR_REQUIREMENT_FIELDS) normalized[field] = safeString(value[field]);
  normalized.requestedVariants = normalizeStringArray(
    value.requestedVariants?.length ? value.requestedVariants : [value.requestedVariant]
  );
  normalized.requestedVariant = normalized.requestedVariants[0] || "";
  normalized.requestedFeatures = normalizeStringArray(value.requestedFeatures);
  normalized.requestedKeywords = normalizeStringArray(value.requestedKeywords);
  normalized.clearFields = normalizeFieldArray(value.clearFields);
  return normalized;
}

function normalizeFieldArray(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => safeString(item))
    .filter(Boolean))];
}

function normalizeStringArray(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => safeString(item).toLowerCase())
    .filter(Boolean))];
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
