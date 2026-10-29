import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('No external calls in mixed policy checks'); };
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const { repairGroundedCommerceReply, isGroundedCommerceRepairEligible, hasMatchedCatalogueCaptionContext } = await import('../server/chat-grounded-reply-repair-service.js');
const { buildBusinessClaimContext, validateBusinessClaimAudit } = await import('../server/business-claim-audit-service.js');
const { buildReplyReviewMessages } = await import('../server/chat-reply-review-contracts.js');
const character = { id: 'guide', category_id: 'mascot', site_id: 'shop' }, trustedSite = { id: 'shop' };
const text = 'Find an Arsenal shirt. How long is standard shipping, and can I return it?';
const intent = { query: 'Arsenal shirt', commerceRoute: 'product_search', commerceTopic: 'delivery', primarySearchVerified: true,
  primarySearchBlocked: false, searchState: 'ready_to_search', shouldLoadProductContext: true, needsLiveProductData: true, cardAllowed: true, answerRequired: true,
  requestedTeam: 'Arsenal', requestedProductType: 'shirt', knowledgeScope: 'business', replyBoundary: { salesAllowed: true, contactAllowed: true } };
const state = { version: 1, status: 'active', owner: 'single', siteId: 'shop', characterId: 'guide', targetEvidence: 'Find an Arsenal shirt',
  requestedConditionEvidence: ['Find an Arsenal shirt'], requirements: { requestedTeam: 'Arsenal', requestedProductType: 'shirt' }, proposal: null };
intent.productCandidateState = state;
const product = { id: 'shirt', name: 'Arsenal Home Soccer Jersey', siteId: 'shop', url: 'https://fixture.invalid/shirt', available: true, matchStatus: 'matched' };
const quote = 'Standard shipping usually takes about 15–30 days, varies by country, and is not guaranteed.';
const knowledge = { ok: true, strategy: 'business_verified_reference', businessOwner: { siteId: 'shop', characterId: 'guide' }, customerServiceTopic: 'delivery',
  items: [{ id: 'policy', category: 'customer_service', title: 'Shipping', content: quote, evidenceQuote: quote }] };
const approved = { allowed: true, confidence: .99, boundarySupported: true, evidenceSupported: true, factualSupported: true,
  factualLimitationRelevant: true, businessFactsSupported: true, guidanceSupported: true, candidateConfirmationSupported: true, productScopeSupported: true };
const verdict = { ...approved, allowed: false, evidenceSupported: false, businessFactsSupported: false };
const base = { character, trustedSite, userText: text, language: 'en', searchIntent: intent,
  productContext: { sourceType: 'product_api', sourceRef: 'guest-site-product-context', siteId: 'shop', searchOutcome: 'matched', cardAllowed: true, searchIntent: intent, products: [product] },
  knowledgeContext: knowledge, factualContext: { required: false, status: 'not_required', searched: false, items: [] },
  replyResult: { text: 'Rejected fabricated policy: any non-custom shirt is returnable.', speechText: 'Rejected fabricated policy: any non-custom shirt is returnable.', sourceType: 'ai', sourceRef: 'fixture' },
  reviewStatus: 'valid', reviewResult: verdict, failedContracts: ['evidence', 'business_facts'] };
assert(!hasMatchedCatalogueCaptionContext({ ...base, searchIntent: { ...intent, commerceTopic: 'other' } }), 'A mixed other-topic lookup does not borrow the pure caption terminal');
const corrected = 'Standard shipping is usually about 15–30 days, depending on country, with no guarantee. I cannot verify the return policy here.';
for (const outcome of ['matched', 'no_match']) {
  const input = structuredClone(base); input.productContext.searchIntent = input.searchIntent;
  if (outcome === 'no_match') Object.assign(input.productContext, { sourceRef: 'guest-site-product-no-match', searchOutcome: 'no_match', products: [] });
  assert(isGroundedCommerceRepairEligible(input), `${outcome}: verified parallel policy receives one fresh candidate`);
  assert(!hasMatchedCatalogueCaptionContext(input), 'A mixed answer never becomes a pure caption');
  let reviews = 0, repairs = 0;
  const out = await enforceReplyBoundary({ ...input, languageQualityRequired: true, independentLanguageQualityRequired: true,
    assess: async () => { reviews++; return reviews === 1 ? verdict : approved; },
    assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: .99, languageQualitySupported: true, languageIssues: [] }),
    repairGroundedReply: async value => { repairs++; return { ...value.replyResult, text: corrected, displayText: corrected, speechText: corrected }; }, recordReview: async () => {} });
  assert.equal(repairs, 1); assert.equal(reviews, 2); assert.equal(out.text, corrected); assert(!out.degraded);
  let packet, system, calls = 0;
  await repairGroundedCommerceReply({ ...input, config: { apiKey: 'fixture', model: 'fixture', apiMode: 'chat_completions' },
    requestText: async prompt => { calls++; packet = JSON.parse(prompt.messages[0].content); system = prompt.systemPrompt; return JSON.stringify({ displayText: corrected }); }, recordLog: async () => {} });
  assert.equal(calls, 1); assert(!Object.hasOwn(packet, 'proposedResponse')); assert(!JSON.stringify(packet).includes('any non-custom shirt is returnable'));
  assert.equal(packet.catalogueEvidence.searchOutcome, outcome); assert.equal(packet.knowledge[0].evidenceQuote, quote);
  assert(!Object.hasOwn(packet, 'matchedCatalogue'), 'Policy recovery does not borrow pure caption scope');
  assert(system.includes('independent business question'));
  const claims = buildBusinessClaimContext({ ...input, text: corrected, businessFactsRequired: true, catalogueOwner: { character, trustedSite }, characterId: character.id, siteId: trustedSite.id });
  assert(claims?.references.some(ref => ref.kind === 'catalogue'), 'Completed search facts must have references separate from policy sentences');
  assert(claims.references.some(ref => ref.kind === 'knowledge'));
  const epistemic = { units: [{ id: 'u0', text: 'I cannot verify the return policy from the supplied information.' }], references: claims.references, bounded: true };
  const uncertainty = { unitId: 'u0', factual: false, referenceIds: [], supported: true, sourceAllowsException: false, replyPreservesException: false };
  assert(validateBusinessClaimAudit([uncertainty], epistemic).accepted);
  assert(!validateBusinessClaimAudit([{ ...uncertainty, factual: true }], epistemic).valid, 'A supported factual assertion without references remains invalid');
  const reviewPacket = JSON.parse(buildReplyReviewMessages({ ...input, text: corrected, boundaryReviewRequired: true, characterId: character.id, siteId: trustedSite.id, evidenceRequired: outcome === 'no_match', catalogueOwner: { character, trustedSite } }).findLast(r => r.role === 'user').content);
  if (outcome === 'matched') {
    const reference = JSON.parse(claims.references.find(ref => ref.id === 'p0').text);
    assert.equal(reference.name, reviewPacket.evidence.catalogueProducts[0].name);
    assert.equal(reference.attributeSource, 'evidence.catalogueProducts[0]');
    assert.equal(reviewPacket.evidence.matchedProductCount, 1);
  }
  assert.equal(outcome === 'matched' ? reviewPacket.evidence.catalogueProducts.length : reviewPacket.evidence.noMatchContext.searchOutcome, outcome === 'matched' ? 1 : 'no_match');
}
for (const change of [
  x => { x.knowledgeContext.businessOwner.siteId = 'foreign'; },
  x => { Object.assign(x.knowledgeContext.items[0], { scope: 'site', siteId: 'foreign' }); }, x => { x.knowledgeContext.businessOwner.characterId = 'other'; },
  x => { delete x.knowledgeContext.businessOwner; }, x => { x.knowledgeContext.items[0].evidenceQuote = 'fabricated'; },
  x => { x.knowledgeContext.strategy = 'business_no_verified_answer'; }, x => { x.knowledgeContext.items = []; },
  x => { x.productContext.searchOutcome = 'candidate'; }, x => { x.productContext.searchOutcome = 'alternative'; },
  x => { x.productContext.sourceErrorCode = 'timeout'; }, x => { x.productContext.snapshotOnly = true; },
  x => { x.searchIntent.primarySearchBlocked = true; }, x => { x.searchIntent.scopeUnverified = true; },
  x => { x.orderActionCandidate = { state: 'login_required' }; }, x => { x.chatImageContext = { status: 'ready' }; },
  x => { x.factualContext.required = true; }, x => { x.searchIntent.humanHandoff = { explicitRequest: true }; },
  x => { x.searchIntent.promotionInquiry = { kind: 'policy' }; }, x => { x.searchIntent.checkoutIssue = { active: true }; },
  x => { x.reviewResult.confidence = .5; }, x => { x.reviewResult.missingFields = ['evidenceSupported']; },
  x => { delete x.reviewResult.businessFactsSupported; }, x => { x.groundedRepairAttempted = true; },
]) {
  const input = structuredClone(base); input.productContext.searchIntent = input.searchIntent; change(input);
  assert(!isGroundedCommerceRepairEligible(input), 'Foreign, incomplete, unsupported and action-mixed inputs cannot borrow policy correction');
}
let reviews = 0, repairs = 0;
const rejected = await enforceReplyBoundary({ ...base, languageQualityRequired: true, independentLanguageQualityRequired: true,
  assess: async () => { reviews++; return verdict; }, assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: .99, languageQualitySupported: true, languageIssues: [] }),
  repairGroundedReply: async value => { repairs++; return { ...value.replyResult, text: corrected, speechText: corrected }; }, recordReview: async () => {} });
assert.equal(repairs, 1); assert.equal(reviews, 2); assert(rejected.degraded);
console.log('Mixed policy: source/owner/quote boundaries, matched and empty evidence, one fresh candidate/full review and finite failure passed');
{
  const uncertain = structuredClone(base); uncertain.productContext.searchIntent = uncertain.searchIntent;
  uncertain.reviewResult = { ...verdict, confidence: .5 }; uncertain.failedContracts = ['business_facts', 'evidence', 'confidence'];
  assert(isGroundedCommerceRepairEligible(uncertain), 'owned matched mixed policy with uncertain review may regenerate once, not approve');
  uncertain.reviewResult.evidenceSupported = undefined;
  assert(!isGroundedCommerceRepairEligible(uncertain), 'missing original evidence verdict cannot enter mixed recovery');
}
console.log('mixed policy low confidence: owned result may regenerate once, incomplete protocol remains closed');
