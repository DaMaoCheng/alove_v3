import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
process.env.VENICE_API_KEY = "";
process.env.OPENAI_API_KEY = "";
const { enforceReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { normalizeGuestReplyText } = await import("../server/guest-chat-output-policy.js");
const { GUEST_PRODUCT_REPLY_COPY } = await import("../server/guest-product-reply-copy.js");
const { resolveUnconfirmedProductSearchOutcome } = await import("../server/product-search-decision-service.js");
const { resolveGuestProductRecommendation } = await import("../server/guest-chat-product-service.js");
const { buildChatProductRecommendationContext } = await import("../server/chat-product-recommendation-service.js");
globalThis.fetch = async () => { throw new Error("Unexpected external request"); };
let checks = 0;
const check = (actual, expected, label) => { assert.equal(actual, expected, label); checks++; };
const base = { answerRequired: true, needsLiveProductData: true, commerceRoute: "product_question", replyBoundary: { salesAllowed: true, contactAllowed: true } };
const states = [
  ["needs_clarification", "needs_clarification", "clarification"],
  ["clarification_exhausted", "clarification_exhausted", "exhausted"],
  ["ready_to_search", "no_match", "noMatch"],
  ["ready_to_search", "not_searched", "clarification"],
  ["ready_to_search", "", "clarification"],
  ["ready_to_search", "matched", "clarification"],
  ["ready_to_search", "unknown", "clarification"],
  ["needs_clarification", "no_match", "clarification"],
  ["clarification_exhausted", "no_match", "exhausted"],
  ["source_error", "no_match", "timeout"],
  ["ready_to_search", "source_error", "timeout"],
  ["source_error", "source_error", "timeout"],
];
for (const [code, copy] of Object.entries(GUEST_PRODUCT_REPLY_COPY)) {
  for (const [searchState, searchOutcome, key] of states) {
    const searchIntent = { ...base, searchState, sourceErrorCode: "timeout" };
    const guarded = await enforceReplyBoundary({ replyResult: { text: "An unsupported product claim.", speechText: "Wrong claim." }, searchIntent,
      productContext: { products: [], searchOutcome }, language: code, assess: async () => null });
    check(guarded.text, copy[key], `${code}/${searchOutcome}: evidence fallback describes the actual state`);
    check(guarded.speechText, guarded.text, `${code}: visible and spoken fallback agree`);
    const normalized = normalizeGuestReplyText({ text: "An unsupported product claim.", productRequested: true, productSearchIntent: { ...searchIntent, answerRequired: false },
      productSearchOutcome: searchOutcome, languageCode: code });
    check(normalized, copy[key], `${code}/${searchOutcome}: final normalizer respects state`);
    const noSales = { ...searchIntent, replyBoundary: { salesAllowed: false, contactAllowed: false } };
    const withdrawn = await enforceReplyBoundary({ replyResult: { text: "Guess." }, searchIntent: noSales, productContext: { products: [], searchOutcome }, language: code, assess: async () => null });
    check(withdrawn.text, copy[key === "timeout" ? "unavailable" : "clarification"], `${code}: withdrawal prevents search/contact navigation`);
    check(normalizeGuestReplyText({ text: "Guess.", productRequested: true, productSearchIntent: { ...noSales, answerRequired: false }, productSearchOutcome: searchOutcome, languageCode: code }), withdrawn.text, `${code}: final normalizer also respects withdrawal`);
  }
  const contactRefused = await enforceReplyBoundary({ replyResult: { text: "Guess." }, searchIntent: { ...base, searchState: "source_error", sourceErrorCode: "source_unconfigured", replyBoundary: { contactAllowed: false } }, productContext: { searchOutcome: "source_error" }, language: code, assess: async () => null });
  check(contactRefused.text, copy.unavailable, `${code}: contact withdrawal prevents support invitation`);
}

// The new ordinary-search gate reuses the same actual-state copy in every language.
for (const [code, copy] of Object.entries(GUEST_PRODUCT_REPLY_COPY)) {
  for (const [searchState, searchOutcome, key] of states) {
    let calls = 0;
    const searchIntent = { commerceRoute: "product_search", shouldLoadProductContext: true, answerRequired: false, needsLiveProductData: false,
      searchState, sourceErrorCode: "timeout", replyBoundary: { salesAllowed: true, contactAllowed: true } };
    const guarded = await enforceReplyBoundary({ replyResult: { text: "I found the products. Click below.", speechText: "They are ready." }, searchIntent,
      productContext: { products: [], searchOutcome }, language: code, assess: async ({ evidenceRequired }) => { calls++; check(evidenceRequired, true, "ordinary search shares the actual evidence review"); return null; } });
    check(calls, 1, `${code}/${searchOutcome}: single review despite answerRequired=false`);
    check(guarded.text, copy[key], `${code}/${searchOutcome}: ordinary search preserves actual status copy`);
    check(guarded.speechText, guarded.text, `${code}/${searchOutcome}: ordinary search body and speech agree`);
    check(normalizeGuestReplyText({ text: guarded.text, productRequested: true, productSearchIntent: { ...searchIntent, answerRequired: guarded.answerRequired },
      productSearchOutcome: searchOutcome, languageCode: code }), guarded.text, `${code}/${searchOutcome}: guarded canonical text survives the final normalizer`);
  }
}
const site = { id: "site_fixture", slug: "fixture", product_api_url: "https://shop.invalid/products", currency: "USD" };
const db = { execute: async () => [[site]] };
let searches = 0;
const unexpected = async () => { searches++; throw new Error("Unqueried customization must not search"); };
for (const searchState of ["ready_to_search", "needs_clarification", "clarification_exhausted"]) {
  const intent = { ...base, shouldLoadProductContext: true, customizationRequest: "name_number", searchState, clarificationCount: 2 };
  const guest = await resolveGuestProductRecommendation(db, { guest: { site_id: site.id }, userText: "Personalization options", precomputedSearchIntent: intent, searchProducts: unexpected, classifyCommerce: unexpected });
  const member = await buildChatProductRecommendationContext(db, { character: { id: "mascot_fixture", category_id: "mascot", site_id: site.id }, userText: "Personalization options", precomputedSearchIntent: intent, fetchProducts: unexpected, classifyCommerce: unexpected });
  for (const context of [guest.context, member]) {
    check(context.searchOutcome, searchState === "ready_to_search" ? "not_searched" : searchState, "producer does not label unqueried customization no-match");
    check(context.searchIntent.clarificationCount, 2, "producer retains clarification limit");
    check(context.searchIntent.searchState, searchState, "producer does not alter the intent decision");
  }
}
check(searches, 0, "both producer branches avoid external queries");
let emptyQueries = 0;
const searchedIntent = { ...base, shouldLoadProductContext: true, cardAllowed: false, searchState: "ready_to_search", requestedTeam: "Brazil", query: "Brazil shirt" };
const searchedGuest = await resolveGuestProductRecommendation(db, { guest: { site_id: site.id }, userText: "Brazil shirt", precomputedSearchIntent: searchedIntent,
  searchProducts: async () => { emptyQueries++; return { items: [] }; } });
const searchedMember = await buildChatProductRecommendationContext(db, { character: { id: "mascot_fixture", category_id: "mascot", site_id: site.id }, userText: "Brazil shirt", precomputedSearchIntent: searchedIntent,
  fetchProducts: async () => { emptyQueries++; return []; } });
for (const context of [searchedGuest.context, searchedMember]) {
  check(context.searchOutcome, "no_match", "actual empty catalogue query still yields no-match");
  const normalized = normalizeGuestReplyText({ text: "Guess.", productRequested: true, productSearchIntent: { ...context.searchIntent, answerRequired: false }, productSearchOutcome: context.searchOutcome });
  check(normalized, GUEST_PRODUCT_REPLY_COPY.en.noMatch, "actual producer no-match survives final normalization");
}
assert.ok(emptyQueries >= 2); checks++;
check(resolveUnconfirmedProductSearchOutcome({ searchState: "needs_clarification" }, "clarification_exhausted"), "clarification_exhausted", "exhausted context cannot restart clarification");
check(normalizeGuestReplyText({ text: "A grounded answer.", productRequested: true, productSearchIntent: { ...base, searchState: "needs_clarification" }, productSearchOutcome: "needs_clarification" }), "A grounded answer.", "answer-required complete replies remain unchanged");
const product = { name: "Verified shirt", sizes: [{ label: "M", available: true }] };
const successful = { text: "Verified factual answer.", speechText: "Verified factual answer.", sourceType: "ai" };
check(await enforceReplyBoundary({ replyResult: successful, searchIntent: base, productContext: { products: [product], searchOutcome: "matched" }, assess: async () => { throw new Error("matched evidence must not add an unrelated review"); } }), successful, "verified normal reply is unchanged");
check(await enforceReplyBoundary({ replyResult: successful, searchIntent: base, productContext: { products: [], sourceRef: "guest-current-product-sizing-context", sizingProduct: product }, assess: async () => { throw new Error("trusted sizing must not become missing evidence"); } }), successful, "verified current sizing is not empty-search evidence");
check(normalizeGuestReplyText({ text: successful.text, product, productRequested: true, productSearchIntent: base, productSearchOutcome: "matched" }), successful.text, "matched complete answer is unchanged");
const sizing = normalizeGuestReplyText({ text: "Guess size XL.", productRequested: true, productContextSourceRef: "guest-current-product-sizing-context", sizingProduct: product, productSearchIntent: { searchState: "ready_to_search" } });
assert.match(sizing, /listed sizes.*M/); checks++;
check(normalizeGuestReplyText({ text: "Transport failure notice.", productRequested: true, aiTransportFallback: true, productSearchIntent: { searchState: "ready_to_search" } }), "Transport failure notice.", "pure recommendation transport fallback keeps existing precedence");
check(normalizeGuestReplyText({ text: "Transport failure notice.", productRequested: true, aiTransportFallback: true, productSearchIntent: { searchState: "ready_to_search", replyBoundary: { salesAllowed: false } } }), "Transport failure notice.", "sales withdrawal does not replace the safe transport failure notice");
console.log(`Product state fallback self-check passed: ${checks} assertions, ${Object.keys(GUEST_PRODUCT_REPLY_COPY).length} languages; controlled guard/normalizer/guest/member services, no external calls or DB writes.`);
