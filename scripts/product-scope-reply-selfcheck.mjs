import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Unexpected external request"); };
const { enforceReplyBoundary, assessReplyBoundary, mergeReplyCommerceContext, applyReplyBoundaryPromptPolicy } = await import("../server/chat-reply-boundary-service.js");
const { normalizeGuestReplyText, applyGuestProductClarificationPromptPolicy } = await import("../server/guest-chat-output-policy.js");
const { buildUnconfirmedProductStateReply } = await import("../server/guest-product-reply-copy.js");
const { buildProductRequestScopeCopy } = await import("../server/product-request-scope-copy.js");
const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
const state = { version: 1, status: "pending", siteId: "fixture_site", characterId: "fixture_character", clarificationCount: 1, selectedIndex: null,
  items: [{ evidence: "original first item", sharedEvidence: "", text: "original first item" }, { evidence: "original second item", sharedEvidence: "", text: "original second item" }] };
const intent = { productScopePending: true, productRequestState: state, answerRequired: true, searchState: "needs_clarification", replyBoundary: { salesAllowed: true, contactAllowed: true } };
const yes = { allowed: true, confidence: .99, productScopeSupported: true, retainedProductScopeSupported: true, languageQualitySupported: true,
  evidenceSupported: true, guidanceSupported: true, businessFactsSupported: true, imageStatusSupported: true, factualSupported: true };
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const expected = buildProductRequestScopeCopy(intent);
const blocked = mergeReplyCommerceContext({ sourceRef: "guest-current-product-image-card", products: [{ name: "Old card" }], sizingProduct: { name: "Old size" }, cardAllowed: true }, intent);
check(blocked.cardAllowed === false && blocked.products.length === 0 && !blocked.sizingProduct, "pending beats requested-current-image exception and stale sizing evidence");
check(intent.replyBoundary.salesAllowed === true, "pending does not invent a sales refusal");
check(buildUnconfirmedProductStateReply({ searchIntent: intent, searchOutcome: "no_match" }) === expected, "unselected requests cannot claim all items have no match");
const body = "The verified policy permits returns.\n\nWhich item should we start with?";
check(normalizeGuestReplyText({ text: body, productSearchIntent: intent, productRequested: true, sizingProduct: { name: "Old size", sizes: [{ label: "XL" }] }, productContextSourceRef: "guest-current-product-sizing-context" }) === body, "pending preserves parallel answer and paragraph boundaries instead of a stale size answer");
check(!applyGuestProductClarificationPromptPolicy({ systemPrompt: "base" }, { productRequested: true, searchIntent: intent }).systemPrompt.includes("[guest_product_clarification"), "pending cannot force the old single-item token");
check(applyReplyBoundaryPromptPolicy({ systemPrompt: "base" }, intent).systemPrompt.includes("parallel"), "shared prompt preserves parallel questions");
let calls = 0;
const accepted = await enforceReplyBoundary({ replyResult: { text: body, speechText: body }, searchIntent: intent, assess: async (input) => { calls++; check(input.productScopeRequired === true && input.productScopeContext.items.length === 2, "same review receives bounded scope evidence"); return yes; } });
check(calls === 1 && accepted.text === body, "one existing assessment preserves accepted complete reply");
check(accepted.productScopeVerified === true, "accepted scoped reply exposes an explicit verified result to card selection");
for (const productScopeSupported of [false, undefined, "true", 1]) {
  const result = await enforceReplyBoundary({ replyResult: { text: "Both items are out of stock." }, searchIntent: intent, assess: async () => ({ ...yes, productScopeSupported }) });
  check(result.text === expected && !result.text.includes("out of stock"), "invalid scope verdict uses selection copy");
  check(result.productScopeVerified === false, "rejected scope blocks cards without inventing a sales refusal");
}
const retained = "The verified policy permits returns.";
const partial = await enforceReplyBoundary({ replyResult: { text: `${retained}\n\nBoth items are out of stock.` }, searchIntent: intent, languageQualityRequired: true,
  assess: async () => ({ ...yes, allowed: false, productScopeSupported: false, retainedText: retained, retainedTextAllowed: true, retainedBoundarySupported: true, retainedLanguageQualitySupported: true }) });
check(partial.text.startsWith(retained) && partial.text.includes(expected) && !partial.text.includes("out of stock"), "independently reviewed parallel answer is retained with safe selection copy");
check(partial.productScopeVerified === false, "retaining a supported paragraph cannot approve rejected product cards");
for (const patch of [{ retainedProductScopeSupported: false }, { retainedBoundarySupported: false }, { retainedLanguageQualitySupported: false }, { retainedText: "verified policy" }]) {
  const result = await enforceReplyBoundary({ replyResult: { text: `${retained}\n\nBad claim.` }, searchIntent: intent, languageQualityRequired: true,
    assess: async () => ({ ...yes, allowed: false, productScopeSupported: false, retainedText: retained, retainedTextAllowed: true, retainedBoundarySupported: true, retainedLanguageQualitySupported: true, ...patch }) });
  check(!result.text.includes(retained), "retention cannot bypass any independent approval or whole-paragraph match");
}
const selected = { ...intent, productScopePending: false, productRequestState: { ...state, status: "selected", selectedIndex: 1 } };
const selectedFailure = await enforceReplyBoundary({ replyResult: { text: "No matches for either item." }, searchIntent: selected, assess: async () => ({ ...yes, allowed: false, productScopeSupported: false }) });
check(selectedFailure.text.includes("original second item") && !selectedFailure.text.includes("original first item") && !selectedFailure.text.includes("either item"), "failed selected attribution references only the current item");
check(selectedFailure.productScopeVerified === false && selectedFailure.replyBoundary.salesAllowed === true, "selected rejection suppresses cards separately from existing sales permission");
const config = { apiKey: "fixture", model: "fixture", baseUrl: "https://invalid.test" };
let payload, messages;
const parsed = await assessReplyBoundary({ text: body, productScopeRequired: true, productScopeContext: { status: "pending", items: [{ evidence: "a" }, { evidence: "b" }], secret: "private" }, config, recordLog: async () => {},
  fetchImpl: async (_url, options) => { const request = JSON.parse(options.body); messages = request.messages; payload = JSON.parse(messages.at(-1).content); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...yes, productScopeSupported: "true" }) } }] }) }; } });
check(parsed.productScopeSupported === undefined && parsed.reviewStatus === "invalid_fields", "invalid scope field cannot grant approval or masquerade as explicit rejection");
check(messages.some((message) => message.role === "system" && message.content.includes("retainedProductScopeSupported")), "independent scope contract joins existing request");
check(!JSON.stringify(payload.productScopeContext).includes("private"), "review projection excludes unknown fields");
const completeScope = { status: "selected", selectedIndex: 1, items: [
  { evidence: "original first item", sharedEvidence: "size M", updates: [], text: "ignored internal reconstruction" },
  { evidence: "original second item", sharedEvidence: "size M", updates: ["change to blue", "no printed number"], secret: "private update" },
] };
const project = async (productScopeContext) => {
  await assessReplyBoundary({ text: "The selected item matches all conditions.", productScopeRequired: true, productScopeContext,
    productContext: { products: [{ id: "fixture_product", name: "Verified blue item", summary: "Blue in size M", available: true, sizes: ["M"] }], sizingProduct: { name: "Verified blue item", sizeChartResolved: true, sizes: ["M"] } }, config, recordLog: async () => {},
    fetchImpl: async (_url, options) => { const request = JSON.parse(options.body); messages = request.messages; payload = JSON.parse(messages.at(-1).content); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(yes) } }] }) }; } });
  return payload.productScopeContext;
};
const projected = await project(completeScope);
check(projected.items[1].sharedEvidence === "size M" && JSON.stringify(projected.items[1].updates) === JSON.stringify(["change to blue", "no printed number"]), "same assessment receives complete shared conditions and chronological updates without truncation");
check(payload.evidence?.catalogueProducts?.[0]?.name === "Verified blue item" && payload.evidence?.sizingSnapshot?.sizeChartResolved === true, "scope-only actual assessment includes catalogue and sizing evidence in the same request");
check(!JSON.stringify(projected).includes("private update") && !JSON.stringify(projected).includes("ignored internal"), "scope review exposes only bounded original condition fields");
check(messages.some((message) => message.content.includes("satisfy its current complete conditions") && message.content.includes("actual supplied catalogue/tool evidence") && message.content.includes("Unknown conditions")), "selected review requires complete conditions and actual catalogue evidence");
for (const updates of [null, "blue", [""], ["a", "b", "c"], ["a".repeat(241)], [42]]) {
  const unsafe = await project({ ...completeScope, items: [completeScope.items[0], { ...completeScope.items[1], updates }] });
  check(unsafe.status === "unverified" && unsafe.items.length === 0, "malformed or oversized updates invalidate the whole review context");
}
const revisedItems = state.items.map((item, index) => index === 1 ? { ...item, sharedEvidence: "size M", updates: ["change to blue"], text: `${item.evidence} size M change to blue` } : item);
await enforceReplyBoundary({ replyResult: { text: "Current item only." }, searchIntent: { ...selected, productRequestState: { ...selected.productRequestState, items: revisedItems } },
  assess: async (input) => { check(input.productScopeContext.items[1].sharedEvidence === "size M" && input.productScopeContext.items[1].updates[0] === "change to blue", "canonical selected state preserves all conditions in the guard input"); return yes; } });
for (const { code } of SUPPORTED_CHARACTER_LANGUAGES) {
  const failed = await enforceReplyBoundary({ replyResult: { text: "All unavailable." }, searchIntent: intent, language: code, assess: async () => null });
  check(failed.text === buildProductRequestScopeCopy(intent, { languageCode: code }) && failed.speechText === failed.text, `${code}: pending failure is local and display/speech aligned`);
}
const withdrawal = { ...intent, replyBoundary: { salesAllowed: false, contactAllowed: false } };
const refused = await enforceReplyBoundary({ replyResult: { text: "Browse or send email." }, searchIntent: withdrawal, assess: async () => ({ ...yes, allowed: false, productScopeSupported: false }) });
check(!/[?？]|original first|original second|email|Browse/.test(refused.text), "independent sales/contact refusal forbids a selection invitation");
const uncertainty = { scopeUnverified: true, productScopePending: true, commerceRoute: 'unclear',
  replyBoundaryReason: 'classification_uncertain', shouldLoadProductContext: false, cardAllowed: false,
  replyBoundary: { salesAllowed: false, contactAllowed: false } };
for (const { code } of SUPPORTED_CHARACTER_LANGUAGES) {
  const result = await enforceReplyBoundary({ replyResult: { text: 'I searched both items; buy now.' }, searchIntent: uncertainty,
    language: code, assess: async () => ({ ...yes, allowed: false, productScopeSupported: false }) });
  check(result.text === buildProductRequestScopeCopy({ scopeUnverified: true }, { languageCode: code }), `${code}: uncertain routing asks neutral clarification while sales stay blocked`);
  check(result.replyBoundary.salesAllowed === false && result.replyBoundary.contactAllowed === false && result.productScopeVerified === false,
    `${code}: clarification grants no action or product evidence`);
}
check(applyReplyBoundaryPromptPolicy({}, uncertainty).systemPrompt.includes('neutral clarification'), 'uncertainty prompt permits neutral clarification without purchase invitation');
const noContact = await enforceReplyBoundary({ replyResult: { text: "Leave email." }, searchIntent: { ...intent, replyBoundary: { salesAllowed: true, contactAllowed: false } }, assess: async () => ({ ...yes, allowed: false, productScopeSupported: false }) });
check(noContact.text.includes(expected) && !noContact.text.includes("email"), "contact refusal permits an authorized product selection without contact navigation");
const coupon = normalizeGuestReplyText({ text: "The supported answer.\n\nUse code SAVE20 for 20% off.", productSearchIntent: intent, productRequested: true });
check(coupon.startsWith("The supported answer.\n\n") && !coupon.includes("SAVE20"), "pending does not bypass guest coupon sanitization");
const transport = await enforceReplyBoundary({ replyResult: { text: "Timed out.", sourceRef: "ai-request-fallback" }, searchIntent: intent, assess: async () => { throw new Error("transport failure must not invoke review"); } });
check(transport.text === expected, "transport failure cannot imply a multi-item product search happened");
check(transport.productScopeVerified === false, "transport failure cannot approve product cards");
const exhaustedIntent = { ...intent, searchState: "clarification_exhausted" };
const exhausted = await enforceReplyBoundary({ replyResult: { text: "Ask again?" }, searchIntent: exhaustedIntent, assess: async () => null });
check(exhausted.text === buildProductRequestScopeCopy(exhaustedIntent) && !/[?？]/.test(exhausted.text), "exhausted scope cannot ask a third question");
const selectedError = buildUnconfirmedProductStateReply({ searchIntent: { ...selected, searchState: "source_error" }, searchOutcome: "source_error", sourceErrorCode: "timeout" });
check(selectedError.includes("original second item") && !selectedError.includes("original first item"), "source errors are attributed only to the selected item");
for (const confidence of ["0.99", 1.1, NaN, .7]) {
  const result = await enforceReplyBoundary({ replyResult: { text: "Unsafe item assertion." }, searchIntent: intent, assess: async () => ({ ...yes, confidence }) });
  check(result.text === expected, "scope review requires numeric in-range confidence");
}
const contradicted = { ...intent, productRequestState: { ...state, status: "selected", selectedIndex: 0 } };
await enforceReplyBoundary({ replyResult: { text: "Safe question." }, searchIntent: contradicted, assess: async (input) => { check(input.productScopeContext.status === "unverified", "pending flag cannot silently allow a contradictory selected scope"); return yes; } });
const single = { text: "Single-item answer.", speechText: "[happy] Single-item answer." };
check(await enforceReplyBoundary({ replyResult: single, searchIntent: {}, assess: async () => { throw new Error("single-item scope adds no review"); } }) === single, "ordinary single item remains unchanged");
check(!Object.hasOwn(single, "productScopeVerified"), "ordinary replies do not acquire a new product scope flag");
console.log(`Product scope reply self-check passed (${checks} assertions; mocked assessments, no DB/network/models)`);
