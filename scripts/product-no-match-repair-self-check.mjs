import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('External calls forbidden in no-match repair checks'); };
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const state = { version: 1, status: 'active', siteId: 'fixture-shop', characterId: 'fixture-guide', owner: 'single',
  targetEvidence: 'green away shirt for kids', requestedConditionEvidence: ['green away shirt for kids', 'still the kids shirt'],
  requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt', requestedColor: 'green', requestedAudience: 'kids', requestedVariants: ['away'] },
  proposal: { status: 'rejected', candidateId: 'old', name: 'Earlier kit', reply: 'Is that the one?' } };
const intent = { commerceRoute: 'product_search', commerceTopic: 'other', searchState: 'ready_to_search', primarySearchVerified: true,
  shouldLoadProductContext: true, needsLiveProductData: true, cardAllowed: true, answerRequired: false,
  knowledgeScope: 'business', replyBoundary: { salesAllowed: true, contactAllowed: true }, ...state.requirements, productCandidateState: state };
const base = { trustedSite: { id: state.siteId }, feedbackActionCandidate: { kind: 'feedback', label: 'Open feedback' }, character: { id: state.characterId, category_id: 'mascot' }, userText: 'still the kids shirt', language: 'en',
  searchIntent: intent, productContext: { sourceType: 'product_api', sourceRef: 'guest-site-product-no-match', siteId: state.siteId,
    searchIntent: intent, searchOutcome: 'no_match', cardAllowed: true, products: [] }, knowledgeContext: { items: [] },
  factualContext: { required: false, status: 'not_required', searched: false, items: [], asOfUtc: '2026-10-23T08:00:00Z' },
  replyResult: { text: 'Only the separate shirt has no available sizes.', speechText: 'Only the separate shirt has no available sizes.', sourceType: 'ai', sourceRef: 'fixture-generation' } };
const approved = { allowed: true, confidence: .99, boundarySupported: true, evidenceSupported: true, factualSupported: true, factualLimitationRelevant: true,
  businessFactsSupported: true, guidanceSupported: true, candidateConfirmationSupported: true, productScopeSupported: true };
const corrected = 'I did not find a matching green away shirt for kids in this search.';
async function run(options = {}) {
  const calls = { reviews: [], repairs: [], languages: [] };
  const out = await enforceReplyBoundary({ ...base, ...options, languageQualityRequired: true, independentLanguageQualityRequired: true,
    recordReview: async () => {}, assess: async input => { calls.reviews.push(input); return { ...approved,
      ...(calls.reviews.length === 1 || options.rejectRepair ? { allowed: false, evidenceSupported: false } : {}) }; },
    assessLanguageQuality: async input => { calls.languages.push(input); return { reviewStatus: 'valid', confidence: .99, languageQualitySupported: true, languageIssues: [] }; },
    repairGroundedReply: async input => { calls.repairs.push(input); return { ...input.replyResult, text: corrected, displayText: corrected, speechText: corrected }; },
  });
  return { ...calls, out };
}
const result = await run();
assert.equal(result.repairs.length, 1, 'successful current no-match gets one contextual correction');
assert.equal(result.reviews.length, 2); assert.equal(result.out.text, corrected); assert(!result.out.degraded);
assert.equal(result.repairs[0].timeoutMs, 15000, 'no-match wording keeps the diagnostic budget');
assert.equal(result.repairs[0].repairScope, '');
assert.strictEqual(result.reviews[0].productContext, result.reviews[1].productContext);
assert(!result.out.candidateEvidenceVerified && !result.out.alternativeEvidenceVerified, 'no product-card authority');
const rejected = await run({ rejectRepair: true });
assert.equal(rejected.repairs.length, 1); assert.equal(rejected.reviews.length, 2); assert(rejected.out.degraded);
console.log('No-match receives one new text candidate, complete review and finite rejection');
const { toNoMatchReviewContext, PRODUCT_NO_MATCH_CONTEXT_CONTRACT } = await import('../server/product-candidate-context-service.js');
const { isGroundedCommerceRepairEligible, repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
const { buildReplyReviewMessages } = await import('../server/chat-reply-review-contracts.js');
const contextFor = input => toNoMatchReviewContext(input.productContext, { searchIntent: input.searchIntent, characterId: input.character.id, siteId: input.trustedSite.id });
assert.equal(contextFor(base).requirements.requestedColor, 'green');
const verdict = { ...approved, allowed: false, evidenceSupported: false };
const eligibility = input => isGroundedCommerceRepairEligible({ reviewStatus: 'valid', reviewResult: verdict, failedContracts: ['evidence'], ...input });
for (const [name, change] of [
  ['source failure', x => { x.productContext.searchOutcome = 'source_error'; }],
  ['hidden source error', x => { x.productContext.sourceErrorCode = 'timeout'; }],
  ['unverified search', x => { x.searchIntent.primarySearchVerified = false; }],
  ['unknown source reference', x => { x.productContext.sourceRef = 'fixture-unknown'; }],
  ['not searched', x => { x.searchIntent.searchState = 'not_searched'; }],
  ['classification failure', x => { x.searchIntent.commerceClassificationFailure = 'missing_fields'; }],
  ['foreign site', x => { x.productContext.siteId = 'other'; }],
  ['whole foreign context', x => { x.productContext.siteId = 'other'; x.searchIntent.productCandidateState.siteId = 'other'; }],
  ['hidden source state', x => { x.productContext.searchState = 'source_error'; }],
  ['contradictory source intent', x => { x.productContext.searchIntent = { ...x.searchIntent, primarySearchBlocked: true }; }],
  ['foreign character', x => { x.character.id = 'other'; }],
  ['cleared target', x => { x.searchIntent.productCandidateState.status = 'cleared'; }],
  ['changed requirements', x => { x.searchIntent.requestedColor = 'blue'; }],
  ['unverified scope', x => { x.searchIntent.scopeUnverified = true; }],
  ['multiple scope', x => { x.searchIntent.productRequestState = { status: 'pending' }; }],
  ['candidate still displayed', x => { x.searchIntent.productCandidateState.proposal.status = 'displayed'; }],
  ['nonempty results', x => { x.productContext.products = [{ id: 'foreign' }]; }],
  ['candidate context', x => { x.productContext.candidateContext = { requiresConfirmation: true, products: [] }; }],
  ['alternative outcome', x => { x.productContext.searchOutcome = 'alternative'; }],
  ['mixed order entry', x => { x.orderActionCandidate = { state: 'login_required' }; }],
  ['mixed policy evidence', x => { x.knowledgeContext.items = [{ id: 'policy', content: 'Different policy' }]; }],
  ['image turn', x => { x.chatImageContext = { imageStatus: { status: 'ready' } }; }],
  ['public facts', x => { x.factualContext.required = true; }],
]) {
  const input = structuredClone(base); change(input);
  assert.equal(eligibility(input), false, name + ' cannot borrow the new correction purpose');
}
for (const extra of [{ groundedRepairAttempted: true }, { languageRepairAttempted: true },
  { reviewStatus: 'timeout' }, { reviewResult: { ...verdict, evidenceSupported: undefined } },
  { reviewResult: { ...verdict, confidence: .79 } }]) assert(!eligibility({ ...base, ...extra }));
// The same finite USER context reaches correction and BOTH complete reviews.
const reviewPacket = JSON.parse(buildReplyReviewMessages({ ...result.reviews[1], evidenceRequired: true }).findLast(x => x.role === 'user').content);
assert.deepEqual(reviewPacket.evidence.noMatchContext, contextFor(base));
let prompt, requests = 0;
const fresh = await repairGroundedCommerceReply({ ...base, reviewStatus: 'valid', reviewResult: verdict, failedContracts: ['evidence'],
  config: { apiKey: 'fixture-only', model: 'fixture', apiMode: 'chat_completions' },
  requestText: async value => { requests++; prompt = value; return JSON.stringify({ displayText: corrected }); }, recordLog: async () => {} });
assert(fresh && requests === 1);
const repairPacket = JSON.parse(prompt.messages[0].content);
assert.deepEqual(repairPacket.noMatchContext, reviewPacket.evidence.noMatchContext);
assert(!Object.hasOwn(repairPacket, 'proposedResponse'), 'rejected unsupported details are not fed back into the empty-search rewrite');
assert(prompt.systemPrompt.includes(PRODUCT_NO_MATCH_CONTEXT_CONTRACT));
assert(!JSON.stringify(contextFor(base)).includes('Only the separate shirt'), 'rejected model additions do not become USER provenance');
assert.equal(base.productContext.products.length, 0);
assert.equal(base.feedbackActionCandidate.kind, 'feedback', 'real server feedback action is preserved');
console.log('Owned no-match context, negative boundaries, common correction/review provenance and unchanged feedback passed');
