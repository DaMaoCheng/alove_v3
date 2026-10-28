import { SERVER_CONFIG } from "./config.js";
import { isIP } from "node:net";
import { normalizeBraveSearchItems, normalizeBraveSearchQuery, searchBraveLlmContext, shouldTriggerBraveSearch } from "./brave-search-service.js";

// Public factual evidence stays separate from site knowledge, product and order data.
// This consumes the existing JEV result; it does not classify or rewrite the turn.
export async function resolveChatFactualContext({ userText = "", jevDecision = null, searchIntent = {}, language = "en", country = "US", now = new Date(), search = searchBraveLlmContext, config = SERVER_CONFIG.braveSearch, logContext = {}, recordLog } = {}) {
  const text = String(userText || "").trim();
  const query = normalizeBraveSearchQuery(text);
  const date = new Date(now);
  const context = { required: false, status: "not_required", reason: "not_requested", asOfUtc: Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(), timeZone: "UTC", items: [], searched: false, decisionSource: "none", webSearchScore: null };
  if (!query) return { ...context, reason: "empty_input" };
  const reliableDecision = jevDecision?.ok === true && typeof jevDecision.webSearchIntent === "boolean"
    && (jevDecision.confident === true || Number.isFinite(jevDecision.webSearchScore)
      && jevDecision.webSearchScore >= .7 && jevDecision.webSearchScore <= 1);
  // Diagnostic metadata does not grant factual evidence; the independent JEV
  // signal above uses the same existing action threshold.
  context.webSearchScore = jevDecision?.ok === true && Number.isFinite(jevDecision.webSearchScore)
    && jevDecision.webSearchScore >= 0 && jevDecision.webSearchScore <= 1 ? jevDecision.webSearchScore : null;
  context.decisionSource = reliableDecision ? (jevDecision.routingSource || "jev") : jevDecision != null ? "jev_unavailable" : "lexical_fallback";
  // A validated pure merchandise request owns its catalogue words. A weak
  // keyword fallback cannot turn those words into a separate public-fact task.
  const pureShopping = searchIntent.commerceRoute === 'product_search' && searchIntent.knowledgeScope === 'business'
    && Number.isFinite(searchIntent.commerceConfidence) && searchIntent.commerceConfidence >= .75 && searchIntent.commerceConfidence <= 1 && searchIntent.answerRequired === false
    && !searchIntent.commerceClassificationUnavailable && !searchIntent.commerceClassificationFailure && !searchIntent.productScopePending && !searchIntent.scopeUnverified
    && !['pending', 'selected'].includes(searchIntent.productRequestState?.status) && !(searchIntent.productRequestState?.items?.length > 1)
    && !(searchIntent.checkoutIssue || searchIntent.humanHandoff || searchIntent.businessInquiry || searchIntent.promotionInquiry || searchIntent.discountExplanationRequired || searchIntent.nonShoppingReason)
    && jevDecision?.webSearchIntent !== true && !['web_search', 'order_lookup', 'library_photo', 'explicit_generation', 'try_on', 'group_photo', 'image_inspection'].includes(jevDecision?.primaryIntent)
    && jevDecision?.orderIntent !== 'lookup' && !(jevDecision?.imageIntent && jevDecision.imageIntent !== 'none');
  if (!reliableDecision && pureShopping) return { ...context, decisionSource: "catalogue_scope" };
  const required = reliableDecision ? jevDecision.webSearchIntent
    : jevDecision != null ? false : shouldTriggerBraveSearch(text, { config: { enabled: true } });
  if (!required) return context;
  context.required = true;
  const businessScope = searchIntent?.knowledgeScope === "business"
    || searchIntent?.commerceClassificationUnavailable === true
    || ["product_search", "product_question", "store_policy", "order_lookup"].includes(searchIntent?.commerceRoute)
    || searchIntent?.customerServiceKnowledgeRequest === true || searchIntent?.needsLiveProductData === true
    || Boolean(searchIntent?.businessInquiry || searchIntent?.checkoutIssue || searchIntent?.humanHandoff || searchIntent?.promotionInquiry);
  if (businessScope || jevDecision?.orderIntent === "lookup" || jevDecision?.primaryIntent === "order_lookup") return { ...context, status: "blocked", reason: "business_or_order_scope" };
  if (hasPrivateSearchInput(text)) return { ...context, status: "blocked", reason: "private_input" };
  if (!config?.enabled || !String(config?.apiKey || "").trim()) return { ...context, status: "disabled", reason: "search_disabled" };
  try {
    const result = await search(query, { country, searchLang: language, config, logContext, ...(recordLog ? { recordLog } : {}) });
    if (result?.error) return { ...context, status: "error", reason: safeSearchError(result.error), searched: result.searched === true };
    if (result?.searched !== true) return { ...context, status: "error", reason: "search_not_completed" };
    const items = normalizeBraveSearchItems(result.items, { limit: config.maxResults });
    return { ...context, items, searched: true, status: items.length ? "matched" : "no_result", reason: items.length ? "public_references" : "no_public_references" };
  } catch { return { ...context, status: "error", reason: "search_error" }; }
}

function safeSearchError(value) {
  const code = String(value || "");
  return /^(TIMEOUT|NETWORK_ERROR|HTTP_\d{3})$/.test(code) ? code : "search_error";
}

function hasPrivateSearchInput(text) {
  // Inspect the whole input BEFORE bounding the public query, so a private suffix
  // cannot be silently truncated while the rest of that turn is sent out.
  text = text.normalize("NFKC");
  if (/\S+@\S+\.\S+/.test(text)
    || /\p{Decimal_Number}{6,}/u.test(text)
    || /\b(?:sk[-_][A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/.test(text)
    || /\b(?:bearer\s+\S+|(?:api[_ -]?key|(?:access[_ -]?|refresh[_ -]?)?token|password|secret|authorization|session[_ -]?id|cookie|otp|cvv)\s*[:=]\s*\S+)/i.test(text)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text)
    || /\b[0-9a-f]{24,}\b/i.test(text)
    || /\b(?=[a-z0-9_-]{32,}\b)(?=[a-z0-9_-]*\d)(?=[a-z0-9_-]*[a-z])[a-z0-9_-]+\b/i.test(text)) return true;
  if ((text.match(/\+?\p{Decimal_Number}[\p{Decimal_Number} .()-]{7,}\p{Decimal_Number}/gu) || []).some((part) => (part.match(/\p{Decimal_Number}/gu) || []).length >= 9)) return true;
  for (const value of text.match(/https?:\/\/[^\s<>"']+/gi) || []) {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search || /[=&]/.test(url.hash)
        || /(?:^|\/)(?:orders?|account|checkout|login|private|reset[-_]password)(?:\/|$)/i.test(url.pathname)
        || isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".")
        || /(^|\.)(localhost|local|internal)$/i.test(url.hostname)) return true;
    } catch { return true; }
  }
  return false;
}
