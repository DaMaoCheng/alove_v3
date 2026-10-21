import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("External requests are forbidden in factual checks"); };
const { SUPPORTED_CHARACTER_LANGUAGES } = await import("../shared/language-library.js");
const { FACTUAL_REVIEW_CONTRACT, FACTUAL_REVIEW_CONTRACT_BASE, buildFactualContextLayer, buildFactualUnavailableCopy, toFactualReviewContext, factualReviewRequired } = await import("../server/chat-factual-policy.js");
const { enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { buildGuestBenefitContext } = await import("../server/guest-benefit-guidance-service.js");
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const context = { required: true, status: "matched", reason: "verified public fact", asOfUtc: "2026-09-30T11:00:00.000Z", timeZone: "UTC", searched: true,
  items: [{ title: "Official record", content: "The recorded result is 2–1.", url: "https://example.org/official-record" }] };
const original = { text: "The recorded result is 2–1.", speechText: "[happy] The recorded result is 2–1.", verifiedDiscountOffers: [{ code: "old" }], discountOfferReply: true };
const yes = { allowed: true, confidence: .99, factualSupported: true, evidenceSupported: true, guidanceSupported: true,
  businessFactsSupported: true, imageStatusSupported: true, languageQualitySupported: true, guestBenefitSupported: true };
const no = { ...yes, allowed: false, factualSupported: false };
check(factualReviewRequired(context) && !factualReviewRequired({ required: "true" }), "required must be an explicit server boolean");
check(!factualReviewRequired({ required: false, status: "matched" }), "absent valid date and search scope leaves old review untouched");
check(factualReviewRequired({ required: false, asOfUtc: context.asOfUtc }), "a valid server clock activates limited current-event companionship review");
check(!factualReviewRequired({ required: false, asOfUtc: "2026-02-30T00:00:00Z" }), "invalid clock cannot activate the adjacent review");
const safe = toFactualReviewContext({ ...context, secret: "must-not-pass", items: [{ ...context.items[0], secret: "must-not-pass" }] });
check(!JSON.stringify(safe).includes("must-not-pass") && safe.timeZone === "UTC", "only bounded public context fields are exposed");
check(toFactualReviewContext({ ...context, asOfUtc: "2026-02-30T00:00:00Z" }).asOfUtc === "", "invalid calendar dates cannot become time anchors");
check(toFactualReviewContext({ ...context, items: [{ content: "invented", url: "javascript:alert(1)" }] }).status === "no_result", "unsafe URLs never support a fact");
check(toFactualReviewContext({ ...context, items: [{ content: "invented", url: "https://name:secret@example.org/" }] }).items.length === 0, "credential URLs cannot enter references");
check(toFactualReviewContext({ ...context, searched: false }).items.length === 0, "unsearched supplied text is not matched evidence");
const large = toFactualReviewContext({ ...context, reason: "x".repeat(2000), items: Array.from({ length: 30 }, () => ({ title: "x".repeat(1000), content: "x".repeat(9000), url: "https://example.org/" })) });
check(large.items.length === 5 && large.items[0].content.length === 1800 && large.items[0].title.length === 200 && large.reason.length === 160, "references and fields have hard bounds");
const dateOnly = { ...context, required: false, status: "not_required" };
check(toFactualReviewContext(dateOnly).items.length === 0 && !toFactualReviewContext(dateOnly).searched, "nonrequired turns expose a clock but no search evidence");
check(buildFactualContextLayer(dateOnly).content.includes("Emotional companionship") && buildFactualContextLayer(dateOnly).content.includes("not verified facts"), "emotional chat does not gain unverified current-event claims");
check(buildFactualContextLayer(context).content.includes(context.asOfUtc) && buildFactualContextLayer(context).content.includes(context.items[0].url), "time and actual references reach the prompt");
check(FACTUAL_REVIEW_CONTRACT.includes("may accurately quote that supplied UTC date/time without search references")
  && FACTUAL_REVIEW_CONTRACT.includes("it never proves an event happened"), "server UTC date/time is evidence for the clock itself, never an event result");
check(buildFactualContextLayer(null).content === "", "missing optional context leaves the prompt unchanged");
check(FACTUAL_REVIEW_CONTRACT.includes("factualContext.required=false") && FACTUAL_REVIEW_CONTRACT.toLowerCase().includes("ordinary background knowledge and historical discussion do not automatically require web verification") && FACTUAL_REVIEW_CONTRACT.includes("uncertain or misspelled named entity") && FACTUAL_REVIEW_CONTRACT.includes("personal or emotional phrasing"), "limited contract preserves ordinary background discussion while closing ambiguous-entity invention and emotional current-event bypass");
check(FACTUAL_REVIEW_CONTRACT.includes("current/recent public events") && FACTUAL_REVIEW_CONTRACT.includes("current-year or current-season event being discussed") && FACTUAL_REVIEW_CONTRACT.includes("even when it ended months") && !FACTUAL_REVIEW_CONTRACT.includes("sporting-event"), "limited review covers general current-cycle events without event-specific examples or a sports-only boundary");
check(FACTUAL_REVIEW_CONTRACT.includes("review dates/timing, results, scores and completion status") && FACTUAL_REVIEW_CONTRACT.includes("plus the named-entity-clarity rule") && !FACTUAL_REVIEW_CONTRACT.includes("World Cup"), "limited event review and entity clarity use no named event exceptions");
for (const { code, label } of SUPPORTED_CHARACTER_LANGUAGES) {
  const copy = buildFactualUnavailableCopy(code);
  check(copy === buildFactualUnavailableCopy(label) && copy === buildFactualUnavailableCopy(`${code}-XX`), `${code}: language code and labels resolve`);
  check(Boolean(copy) && (code === "en" || copy !== buildFactualUnavailableCopy("en")), `${code}: supported language does not silently become English`);
  const reply = await enforceReplyBoundary({ replyResult: original, factualContext: context, language: code, assess: async () => no });
  check(reply.text === copy && reply.speechText === copy && reply.degradationReason === "factual_unverified", `${code}: factual failure uses public-facts copy for display and speech`);
  check(!reply.discountOfferReply && reply.verifiedDiscountOffers.length === 0, `${code}: degraded reply cannot retain discount permissions`);
}
let calls = 0;
const feelingReply = { text: "That sounds disappointing. I’m here with you." };
check(await enforceReplyBoundary({ replyResult: feelingReply, factualContext: null, assess: async () => { throw new Error("missing context must leave the old path untouched"); } }) === feelingReply, "no context leaves the old ordinary reply untouched");
check(await enforceReplyBoundary({ replyResult: feelingReply, factualContext: dateOnly, assess: async (input) => {
  calls++; check(input.factualRequired && input.factualContext.required === false && input.factualContext.status === "not_required" && !input.factualContext.searched && !input.factualContext.items.length, "limited review is independent of search requirement and never fabricates evidence"); return yes;
} }) === feelingReply && calls === 1, "date-only companionship shares one approved review and preserves original output");
const inventedCurrentEvent = { text: "Creo que la de Argentina fue la que más me dolió; verlos así..." };
const limitedFailure = await enforceReplyBoundary({ replyResult: inventedCurrentEvent, factualContext: dateOnly, language: "es", assess: async () => no });
check(limitedFailure.text === buildFactualUnavailableCopy("es") && limitedFailure.speechText === limitedFailure.text, "unverified current-event conclusion fails closed in limited companionship review");
const missingFact = await enforceReplyBoundary({ replyResult: inventedCurrentEvent, factualContext: dateOnly, language: "es", assess: async () => ({ ...yes, factualSupported: undefined }) });
check(missingFact.text !== inventedCurrentEvent.text && missingFact.text !== buildFactualUnavailableCopy("es") && missingFact.replyRecoveryState.reviewStatus === "missing_fields", "missing verdict blocks the unverified reply without pretending a factual rejection");
for (const text of ["Football brings people together.", "I understand why that felt sad.", "The supplied server time is 2026-09-30 11:00 UTC."]) {
  const reply = { text };
  check(await enforceReplyBoundary({ replyResult: reply, factualContext: dateOnly, assess: async () => yes }) === reply, "limited review permits approved ordinary background, emotions and accurate UTC time");
}
calls = 0;
const transportFallback = { text: "The server took too long to respond. Please try again later.", sourceRef: "ai-request-failed-fallback", degradationReason: "ai_request_failed_fallback" };
check(await enforceReplyBoundary({ replyResult: transportFallback, factualContext: context, assess: async () => { throw new Error("transport fallback must not request another factual verdict"); } }) === transportFallback, "existing safe transport fallback is not newly blocked or re-reviewed");
check(await enforceReplyBoundary({ replyResult: original, factualContext: context, assess: async (input) => {
  calls++; check(input.factualRequired === true && input.factualContext.items[0].url === context.items[0].url, "combined review gets public facts scope/evidence");
  check(input.speechText.includes("2–1"), "spoken factual content is assessed too"); return yes;
} }) === original && calls === 1, "one accepted combined assessment preserves TTS/metadata");
for (const patch of [{ factualSupported: undefined }, { factualSupported: "true" }, { confidence: "0.99" }, { confidence: 1.1 }, { confidence: .79 }, { allowed: "true" }]) {
  const reply = await enforceReplyBoundary({ replyResult: original, factualContext: context, assess: async () => ({ ...yes, ...patch }) });
  check(reply.text !== original.text && !reply.text.includes("2–1") && reply.text !== buildFactualUnavailableCopy("en") && reply.degraded === true, "missing/malformed verdict fails closed without mislabeling its reason as facts");
}
for (const status of ["disabled", "no_result", "error", "blocked"]) {
  const reply = await enforceReplyBoundary({ replyResult: original, factualContext: { ...context, status, searched: false }, assess: async (input) => {
    check(input.factualContext.items.length === 0, "failed search cannot retain public references"); return no;
  } });
  check(reply.text === buildFactualUnavailableCopy("en"), `${status}: honest uncertainty without pretending search succeeded`);
}
const failed = await enforceReplyBoundary({ replyResult: original, factualContext: context, assess: async () => { throw new Error("isolated timeout"); } });
check(failed.text !== original.text && !failed.text.includes("2–1") && failed.text !== buildFactualUnavailableCopy("en") && failed.degraded === true, "unavailable review blocks unverified score without asserting a factual verdict");
const timeReply = { text: "The supplied server time is 2026-09-30 11:00 UTC." };
check(await enforceReplyBoundary({ replyResult: timeReply, factualContext: { ...context, status: "no_result", searched: false, items: [] }, assess: async () => yes }) === timeReply, "an approved exact server UTC quote is allowed without event/search evidence");
const guestIntent = { commerceConfidence: .99, promotionInquiry: { kind: "benefit_request", evidence: "coupon" }, answerRequired: true };
const guestBenefitContext = buildGuestBenefitContext({ isGuest: true, searchIntent: guestIntent, userText: "coupon", languageCode: "en" });
const mixedGuestFailure = await enforceReplyBoundary({ replyResult: original, factualContext: context, guestBenefitContext, searchIntent: guestIntent, userText: "coupon",
  assess: async () => ({ ...no, guestBenefitSupported: false }) });
check(mixedGuestFailure.degradationReason === "guest_benefit_unverified" && mixedGuestFailure.text.includes(buildFactualUnavailableCopy("en")), "guest rights safety keeps priority while a concurrent unverified fact remains explicit");
const caring = "That sounds disappointing. I’m here with you.";
const mixed = { ...original, text: `${caring}\n\nThe recorded result is 2–1.` };
const remainder = { ...no, retainedText: caring, retainedTextAllowed: true, retainedBoundarySupported: true, retainedFactualSupported: true, retainedLanguageQualitySupported: true };
const partial = await enforceReplyBoundary({ replyResult: mixed, factualContext: context, assess: async () => remainder });
check(partial.text === `${caring}\n\n${buildFactualUnavailableCopy("en")}` && partial.partialAnswerRetained, "checked emotional paragraph survives a rejected factual claim");
const limitedPartial = await enforceReplyBoundary({ replyResult: mixed, factualContext: dateOnly, assess: async () => remainder });
check(limitedPartial.text === partial.text && limitedPartial.partialAnswerRetained && !limitedPartial.discountOfferReply && !limitedPartial.verifiedDiscountOffers.length, "limited current-event mode retains only explicitly approved paragraphs and clears benefit permissions");
check(!(await enforceReplyBoundary({ replyResult: mixed, factualContext: dateOnly, assess: async () => ({ ...remainder, retainedFactualSupported: undefined }) })).text.includes(caring), "limited retention also requires independent retained factual support");
for (const patch of [{ retainedText: "sounds disappointing." }, { retainedText: "Rewritten text" }, { retainedFactualSupported: false }, { retainedBoundarySupported: false }, { retainedLanguageQualitySupported: false }]) {
  const reply = await enforceReplyBoundary({ replyResult: mixed, factualContext: context, assess: async () => ({ ...remainder, ...patch }) });
  check(!reply.text.includes(caring), "every retained paragraph requires exact text and independent factual/boundary/language approval");
}
const singleParagraph = await enforceReplyBoundary({ replyResult: { text: `${caring}\nThe recorded result is 2–1.` }, factualContext: context, assess: async () => remainder });
check(!singleParagraph.text.includes(caring), "a line inside one paragraph is not an independently retainable paragraph");
const image = { imageStatus: { kind: "generated", status: "ready", currentTurn: true } };
const imageVerdict = { ...remainder, factualSupported: true, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true };
for (const flag of [false, undefined]) {
  const reply = await enforceReplyBoundary({ replyResult: mixed, factualContext: context, chatImageContext: image, assess: async () => ({ ...imageVerdict, retainedFactualSupported: flag }) });
  check(!reply.text.includes(caring), "old image retention cannot bypass independent factual approval");
}
const character = { category_id: "mascot" };
const storeIntent = { answerRequired: true, knowledgeScope: "business", commerceRoute: "store_policy", commerceTopic: "delivery" };
const businessVerdict = { ...remainder, factualSupported: true, businessFactsSupported: false, retainedBusinessFactsSupported: true };
const unsafeBusiness = await enforceReplyBoundary({ replyResult: mixed, factualContext: context, searchIntent: storeIntent, character,
  assess: async () => ({ ...businessVerdict, retainedFactualSupported: false }) });
check(!unsafeBusiness.text.includes(caring), "old business retention cannot bypass public factual approval");
const unconfirmedProduct = await enforceReplyBoundary({ replyResult: original, factualContext: context, searchIntent: { ...storeIntent, needsLiveProductData: true, commerceRoute: "product_question" }, character,
  assess: async () => ({ ...no, evidenceSupported: false }) });
check(unconfirmedProduct.degradationReason === "product_evidence_unverified", "existing product-evidence safety retains priority over public facts");
// A rejected model can volunteer an unrelated current-event assertion during a
// business question. Keep that factual rejection, but do not present it as the
// user's request for public verification when the server requires none.
const businessReply = { text: "Shipping is free. The current championship ended 2–1.", speechText: "Shipping is free. The current championship ended 2–1.", sourceType: "ai" };
const supportIntent = { ...storeIntent, commerceTopic: "support" };
const businessNo = { ...no, boundarySupported: true, businessFactsSupported: false, guidanceSupported: false, evidenceSupported: false };
for (const commerceRoute of ["store_policy", "product_question", "product_search"]) {
  let factualReviewRan = false;
  const reply = await enforceReplyBoundary({ replyResult: businessReply, factualContext: dateOnly, character, language: "es",
    searchIntent: { ...supportIntent, commerceRoute, needsLiveProductData: commerceRoute === "product_question", shouldLoadProductContext: commerceRoute === "product_search" },
    assess: async (input) => { factualReviewRan = input.factualRequired === true && input.factualContext.required === false; return businessNo; } });
  check(factualReviewRan && reply.degraded && !reply.text.includes("2–1"), `${commerceRoute}: clock-only factual rejection remains enforced`);
  check(!reply.text.includes(buildFactualUnavailableCopy("es")) && reply.speechText === reply.text, `${commerceRoute}: business/product fallback does not inherit public-fact inability copy`);
}
const explicitBusinessFact = await enforceReplyBoundary({ replyResult: businessReply, factualContext: context, character, searchIntent: supportIntent, language: "es", assess: async () => businessNo });
check(explicitBusinessFact.text.includes(buildFactualUnavailableCopy("es")) && !explicitBusinessFact.text.includes("2–1"), "explicit public verification still uses fact fallback alongside a business contract");
let noContextFactualReview = true;
const noContextBusiness = await enforceReplyBoundary({ replyResult: businessReply, character, searchIntent: supportIntent, language: "es", assess: async input => {
  noContextFactualReview = input.factualRequired; return businessNo;
} });
check(!noContextFactualReview && noContextBusiness.degraded && !noContextBusiness.text.includes(buildFactualUnavailableCopy("es")), "missing factual context does not create a new contract or change business fallback");
const generalFailure = await enforceReplyBoundary({ replyResult: businessReply, factualContext: dateOnly, character, searchIntent: { knowledgeScope: "general", commerceRoute: "chat" }, language: "es", assess: async () => no });
check(generalFailure.text === buildFactualUnavailableCopy("es"), "ordinary chat still rejects volunteered unsupported current events and retains its existing fallback");
const knownPolicy = "Standard shipping is free; the destination and exact time must be checked at checkout.";
const businessMixed = { text: `${knownPolicy}\n\nThe current championship ended 2–1.`, speechText: `${knownPolicy}\n\nThe current championship ended 2–1.` };
const businessRetained = { ...businessNo, businessFactsSupported: true, guidanceSupported: true, evidenceSupported: true,
  retainedText: knownPolicy, retainedTextAllowed: true, retainedBoundarySupported: true,
  retainedFactualSupported: true, retainedBusinessFactsSupported: true, retainedGuidanceSupported: true, retainedLanguageQualitySupported: true };
const retainedPolicy = await enforceReplyBoundary({ replyResult: businessMixed, factualContext: dateOnly, character, searchIntent: supportIntent, language: "es", assess: async () => businessRetained });
check(retainedPolicy.text === knownPolicy && retainedPolicy.partialAnswerRetained, "independently approved policy remainder is preserved without unrelated public-fact fallback");
const retainedMixedBusiness = await enforceReplyBoundary({ replyResult: businessMixed, factualContext: dateOnly, character, searchIntent: supportIntent, language: "es", assess: async () => ({ ...businessRetained, businessFactsSupported: false }) });
check(retainedMixedBusiness.text.startsWith(knownPolicy) && retainedMixedBusiness.text !== knownPolicy && !retainedMixedBusiness.text.includes(buildFactualUnavailableCopy("es")), "approved remainder retains existing business limitation for a concurrent rejected business claim");
const uncheckedPolicy = await enforceReplyBoundary({ replyResult: businessMixed, factualContext: dateOnly, character, searchIntent: supportIntent, language: "es", assess: async () => ({ ...businessRetained, retainedFactualSupported: undefined }) });
check(!uncheckedPolicy.text.includes(knownPolicy), "business-only fallback change cannot retain a paragraph lacking factual approval");
let body, transportCalls = 0;
const config = { apiKey: "isolated", model: "isolated", baseUrl: "https://fixture.invalid" };
const parsed = await assessReplyBoundary({ text: original.text, speechText: "A different spoken score.", factualContext: context, factualRequired: true,
  config, recordLog: async () => {}, fetchImpl: async (_url, options) => {
    transportCalls++; body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...yes, retainedFactualSupported: true }) } }] }) };
  } });
const payload = JSON.parse(body.messages.at(-1).content);
check(transportCalls === 1 && payload.factualRequired && payload.factualContext.items.length === 1, "public facts share the existing single provider review");
check(payload.factualContext.asOfUtc === context.asOfUtc && payload.factualContext.timeZone === "UTC", "the exact server date/time reaches the existing review without an additional request");
check(payload.proposedSpeech === "A different spoken score.", "provider receives the independent spoken answer");
check(body.messages.some((row) => row.content === FACTUAL_REVIEW_CONTRACT_BASE) && body.messages.some(row => row.content.includes("retainedFactualSupported:boolean")) && parsed.factualSupported && parsed.retainedFactualSupported, "separate contract and strict explicit verdict fields survive parsing");
const limitedParsed = await assessReplyBoundary({ text: feelingReply.text, factualContext: dateOnly, config, recordLog: async () => {},
  fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body), input = JSON.parse(request.messages.at(-1).content);
    check(input.factualRequired === true && input.factualContext.required === false && input.factualContext.asOfUtc === context.asOfUtc && input.proposedSpeech === feelingReply.text, "provider receives date-only review mode and independent speech without claiming search need");
    check(request.messages.some(row => row.content === FACTUAL_REVIEW_CONTRACT_BASE), "date-only mode uses same combined provider contract");
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(yes) } }] }) };
  } });
check(limitedParsed.factualSupported && limitedParsed.allowed, "limited mode parses the same strict factual verdict");
const malformed = await assessReplyBoundary({ text: original.text, factualContext: context, config, recordLog: async () => {},
  fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"allowed":true,"confidence":"0.99","factualSupported":"true"}' } }] }) }) });
check(malformed.confidence === 0 && malformed.factualSupported === undefined && malformed.reviewStatus === "invalid_fields", "provider string booleans/confidence never authorize facts or masquerade as explicit rejection");
const unavailable = await assessReplyBoundary({ text: original.text, factualContext: context, config, recordLog: async () => {}, fetchImpl: async () => { throw new Error("isolated timeout"); } });
check(unavailable.allowed === false && unavailable.confidence === 0, "provider errors cannot produce an accepted factual verdict");
const {buildLanguageQualityFallbackReply}=await import('../server/chat-reply-language-quality.js');
const qualityGuard={sourceType:'system',sourceRef:'quality-guard',degraded:true,degradationReason:'internal_info_leak',text:buildLanguageQualityFallbackReply('en'),speechText:buildLanguageQualityFallbackReply('en')};
const qualityLimited=await enforceReplyBoundary({replyResult:qualityGuard,factualContext:dateOnly,language:'en',assess:async()=>no,recordReview:async()=>{}});
check(qualityLimited.text===qualityGuard.text && qualityLimited.degradationReason==='internal_info_leak','clock-only review cannot turn a terminal quality failure into public-fact inability');
const qualityExplicit=await enforceReplyBoundary({replyResult:qualityGuard,factualContext:context,language:'en',assess:async()=>no,recordReview:async()=>{}});
check(qualityExplicit.text.includes(buildFactualUnavailableCopy('en')),'explicit public-fact failure retains its existing factual fallback');
const orderQuality=await enforceReplyBoundary({replyResult:qualityGuard,factualContext:dateOnly,language:'en',character:{id:'mascot_fixture',category_id:'mascot'},
 searchIntent:{commerceRoute:'order_lookup'},orderActionCandidate:{kind:'ttmall_order_lookup',siteSlug:'fixture',status:'login_required'},assess:async()=>({...no,guidanceSupported:false}),recordReview:async()=>{}});
check(orderQuality.text!==qualityGuard.text && /sign|log/i.test(orderQuality.text),'quality copy does not replace the order-entry failure guidance');
const imageQuality=await enforceReplyBoundary({replyResult:qualityGuard,factualContext:dateOnly,language:'en',chatImageContext:{imageStatus:{kind:'unknown',status:'unknown',currentTurn:true}},
 assess:async()=>({...no,imageStatusSupported:false,imageStatusRelevant:true,imageReferenceMatched:true}),recordReview:async()=>{}});
check(imageQuality.text!==qualityGuard.text && /image|photo|picture/i.test(imageQuality.text),'quality copy does not replace the image-status failure guidance');
const sharedClarificationRule=buildFactualContextLayer(dateOnly).content.split('\n').find(line=>line.startsWith('When factualContext.required=false'));
check(Boolean(sharedClarificationRule) && FACTUAL_REVIEW_CONTRACT_BASE.includes(sharedClarificationRule),'generation and review share one bounded entity-clarification contract');
check(sharedClarificationRule.includes('a brief ordinary distinguishing descriptor') && sharedClarificationRule.includes('a question mark or tentative wording does not exempt the whole response'),'tentative descriptors cannot exempt an entire question from facts review');
check(sharedClarificationRule.includes('exact records or numeric achievements') && sharedClarificationRule.includes('unsupported current/recent dates') && sharedClarificationRule.includes('required=true'),'record claims, current events and explicit verification preserve their evidence requirements');
check(FACTUAL_REVIEW_CONTRACT_BASE.includes('Top-level factualRequired only activates this review') && !buildFactualContextLayer(context).content.includes(sharedClarificationRule),'review activation is separate from scope and the exception never enters required=true generation');
console.log(`chat factual policy self-check passed (${checks} assertions; isolated assess/config/fetch, no DB or external calls)`);
