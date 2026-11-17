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
      ...(calls.reviews.length === 1 || options.rejectRepair ? { allowed: false, ...(options.failureFields || { evidenceSupported: false }) } : {}) }; },
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
assert(eligibility({ ...base, reviewResult: { ...verdict, protocolFailures: [], protocolFailureHistory: ['claim_consistency'] } }),
  'A valid terminal semantic rejection may rewrite once despite a recovered earlier reviewer protocol failure');
assert(!eligibility({ ...base, reviewResult: { ...verdict, protocolFailures: ['claim_consistency'] } }),
  'An unresolved current reviewer protocol failure remains ineligible');
for (const commerceTopic of ['sizing', 'stock', 'price']) {
  const contextual = structuredClone(base);
  contextual.searchIntent.commerceTopic = commerceTopic;
  contextual.productContext.searchIntent.commerceTopic = commerceTopic;
  assert(eligibility(contextual), 'A verified successful empty catalogue result may correct wording regardless of its merchandise question subtype');
}
assert.equal(isGroundedCommerceRepairEligible({ ...base, reviewStatus: 'valid', reviewResult: { ...verdict, confidence: 0 }, failedContracts: ['evidence','confidence'] }), true, 'owned successful empty evidence may generate one fresh candidate even when the rejected wording has zero confidence; this is not approval');
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
  { reviewResult: { ...verdict, confidence: .539 } }]) assert(!eligibility({ ...base, ...extra }));
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
// A completed, owned empty lookup is text evidence even when uncertain JEV
// allowed the existing commerce fallback; it must not grant a new action.
const commerceOwned = structuredClone(base);
commerceOwned.searchIntent = { ...commerceOwned.searchIntent, primarySearchVerified: false, primarySearchBlocked: false,
  businessKnowledgeRequired: false, commerceConfidence: .99 };
commerceOwned.productContext.searchIntent = commerceOwned.searchIntent;
assert(contextFor(commerceOwned), 'A verified whole-turn catalogue lookup that actually completed can retain no-match text evidence without a strong primary action');
assert(eligibility(commerceOwned));
for (const change of [x => { x.searchIntent.primarySearchBlocked = true; },
  x => { x.productContext.searchIntent = { ...x.searchIntent, cardAllowed: false }; },
  x => { x.productContext.searchIntent = { ...x.searchIntent, query: 'different target' }; },
  x => { x.productContext.searchOutcome = 'not_searched'; }, x => { x.productContext.sourceErrorCode = 'timeout'; }]) {
  const probe = structuredClone(commerceOwned); probe.productContext.searchIntent = probe.searchIntent; change(probe);
  assert.equal(contextFor(probe), null, 'No evidence bypass for blocked, unadmitted, unexecuted or failed searches');
}
for (const patch of [{ businessKnowledgeRequired: true }, { commerceConfidence: .01 }, { businessKnowledgeRequired: undefined, commerceConfidence: undefined }]) {
  const probe = structuredClone(commerceOwned); Object.assign(probe.searchIntent, patch);
  probe.productContext.searchIntent = probe.searchIntent;
  assert(contextFor(probe), 'Classification scores and concurrent knowledge purposes cannot erase an already admitted completed empty source fact');
}
console.log('Completed commerce-owned empty lookup correction without primary permission escalation passed');
assert.equal(eligibility({ ...base, retained: 'The supplied size is a user report.' }), true,
  'an owned completed search can correct the whole answer despite a separately approved fragment');
// A natural empty-search follow-up is conversational assistance, never a
// completed second search. Both the fresh candidate and audit need the same
// server-owned capability instead of citing the catalogue outcome for it.
const { buildBusinessReviewCapability, buildBusinessClaimContext, validateBusinessClaimAudit } = await import('../server/business-claim-audit-service.js');
const noMatchCapabilityOptions = { ...base, businessFactsRequired: true,
  text: corrected + ' If you have more details in mind, I can help with another look.',
  catalogueOwner: { character: base.character, trustedSite: base.trustedSite }, boundary: base.searchIntent.replyBoundary };
const capability = buildBusinessReviewCapability(noMatchCapabilityOptions);
assert.equal(capability?.catalogueRefinementAvailable, true,
  'owned successful empty result supports a bounded offer to clarify the current target');
assert.equal(repairPacket.actionCapability?.catalogueRefinementAvailable, true,
  'the rewrite and reviewer receive the same capability source');
const claimContext = buildBusinessClaimContext(noMatchCapabilityOptions);
assert.equal(JSON.parse(claimContext.references.find(row => row.id === 'a0.catalogueRefinement').text).catalogueRefinementAvailable, true);
assert.equal(claimContext.units.length, 2);
const validClaims = claimContext.units.map((unit, index) => ({ unitId: unit.id, roles: [index === 0 ? 'catalogue' : 'capability'], factual: true,
  referenceIds: [index === 0 ? 's0' : 'a0.catalogueRefinement'], supported: true, sourceAllowsException: false, replyPreservesException: false }));
assert.equal(validateBusinessClaimAudit(validClaims, claimContext).accepted, true);
assert.equal(validateBusinessClaimAudit(validClaims.map(row => ({ ...row, referenceIds: ['s0'] })), claimContext).accepted, false,
  'an empty catalogue outcome still cannot prove an assistant capability');
for (const change of [input => { input.character = { ...input.character, category_id: 'personal' }; input.catalogueOwner.character = input.character; },
  input => { input.productContext.siteId = 'foreign'; }, input => { input.productContext.searchOutcome = 'source_error'; },
  input => { input.searchIntent.replyBoundary.salesAllowed = false; }, input => { input.productContext.products = [{ id: 'foreign' }]; }]) {
  const input = structuredClone(noMatchCapabilityOptions); change(input);
  assert.notEqual(buildBusinessReviewCapability(input)?.catalogueRefinementAvailable, true,
    'refinement capability cannot bypass source, role or sales permissions');
}
console.log('Owned no-match conversational capability is shared by rewrite/audit without source-kind or action escalation');
const { productRequestOwnerEvidence } = await import('../server/product-request-scope-service.js');
const { normalizeProductCandidateRequirements } = await import('../server/product-candidate-state-service.js');
const { buildProductContextLayer } = await import('../server/chat-prompt-layers.js');
const selectedEmpty = structuredClone(base);
delete selectedEmpty.searchIntent.productCandidateState;
selectedEmpty.character.categoryId = 'mascot';
selectedEmpty.searchIntent.productRequestState = { version: 1, status: 'selected', siteId: state.siteId, characterId: state.characterId,
  originalUserText: 'green away shirt for kids and a blue training top', selectedIndex: 0, clarificationCount: 1,
  items: [{ evidence: 'green away shirt for kids', sharedEvidence: '', text: 'green away shirt for kids' },
    { evidence: 'blue training top', sharedEvidence: '', text: 'blue training top' }] };
selectedEmpty.productContext.searchIntent = structuredClone(selectedEmpty.searchIntent);
assert(contextFor(selectedEmpty), 'a validated selected lookup can have a real empty result without an identity-candidate state');
assert(eligibility(selectedEmpty), 'the selected-scope recovery gate accepts only the proven no-match purpose');
const selectedResult = await run(selectedEmpty);
assert.equal(selectedResult.repairs.length, 1); assert.equal(selectedResult.reviews.length, 2); assert.equal(selectedResult.out.text, corrected);
const selectedProjection = contextFor(selectedEmpty);
assert.deepEqual(selectedProjection.userConditionEvidence, ['green away shirt for kids']);
assert(!JSON.stringify(selectedProjection).includes('blue training'), 'another target is never borrowed into this completed lookup');
const generationLayer = buildProductContextLayer(selectedEmpty.character, selectedEmpty.productContext, selectedEmpty.userText);
assert(generationLayer.content.includes(PRODUCT_NO_MATCH_CONTEXT_CONTRACT));
assert(generationLayer.content.includes(JSON.stringify({ noMatchContext: selectedProjection })));
const selectedReview = JSON.parse(buildReplyReviewMessages({ ...selectedResult.reviews[1], evidenceRequired: true }).findLast(row => row.role === 'user').content);
assert.deepEqual(selectedReview.evidence.noMatchContext, selectedProjection);
let selectedPrompt;
await repairGroundedCommerceReply({ ...selectedEmpty, reviewStatus: 'valid', reviewResult: verdict, failedContracts: ['evidence'],
  config: { apiKey: 'fixture-only', model: 'fixture', apiMode: 'chat_completions' },
  requestText: async prompt => { selectedPrompt = prompt; return JSON.stringify({ displayText: corrected }); }, recordLog: async () => {} });
assert.deepEqual(JSON.parse(selectedPrompt.messages[0].content).noMatchContext, selectedProjection,
  'generation, full review and one bounded repair share the same selected-item projection');
const selectedWithCandidate = structuredClone(selectedEmpty);
selectedWithCandidate.searchIntent.productCandidateState = { ...state, owner: 'selected', selectedIndex: 0,
  ownerEvidence: productRequestOwnerEvidence(selectedEmpty.searchIntent.productRequestState),
  requirements: normalizeProductCandidateRequirements(selectedEmpty.searchIntent) };
selectedWithCandidate.productContext.searchIntent = structuredClone(selectedWithCandidate.searchIntent);
assert(contextFor(selectedWithCandidate)); assert(eligibility(selectedWithCandidate));
for (const change of [
  input => { input.searchIntent.productRequestState.status = 'pending'; input.searchIntent.productRequestState.selectedIndex = null; },
  input => { input.searchIntent.productRequestState.selectedIndex = 1; },
  input => { input.searchIntent.productRequestState.siteId = 'foreign'; },
  input => { input.searchIntent.productRequestState.characterId = 'foreign'; },
  input => { input.productContext.searchIntent.productRequestState.items[0].evidence = 'different'; },
  input => { input.productContext.searchIntent.requestedTeam = 'other'; },
  input => { input.productContext.searchIntent.scopeUnverified = true; },
  input => { input.productContext.searchOutcome = 'source_error'; },
  input => { input.productContext.products = [{ id: 'not-empty' }]; },
]) {
  const input = structuredClone(selectedEmpty); change(input);
  assert.equal(contextFor(input), null); assert.equal(eligibility(input), false);
}
for (const change of [input => { delete input.productContext.searchIntent.productCandidateState; },
  input => { input.searchIntent.productCandidateState.selectedIndex = 1; },
  input => { input.searchIntent.productCandidateState.ownerEvidence = 'wrong-scope'; },
  input => { input.searchIntent.productCandidateState.owner = 'single'; },
  input => { input.searchIntent.productCandidateState.proposal.status = 'displayed'; }]) {
  const input = structuredClone(selectedWithCandidate); change(input);
  assert.equal(contextFor(input), null, 'an existing candidate cannot evade selected ownership or proposal limits');
}
console.log('Selected-item completed empty lookup: shared generation/review/repair, exact scope, candidate parity and negative isolation passed');
const selectedCleared = structuredClone(selectedEmpty);
selectedCleared.searchIntent.productCandidateState = { version: 1, status: 'cleared', siteId: state.siteId, characterId: state.characterId };
selectedCleared.productContext.searchIntent = structuredClone(selectedCleared.searchIntent);
assert(contextFor(selectedCleared), 'identical cleared identity-candidate state does not erase a newly completed selected-scope empty query');
const scopeFailure = { businessFactsSupported: false, productScopeSupported: false };
const repairedScope = await run({ ...selectedCleared, failureFields: scopeFailure });
assert.equal(repairedScope.repairs.length, 1, 'a source-proven empty selected result may correct a rejected scope statement once');
assert.equal(repairedScope.reviews.length, 2); assert.equal(repairedScope.out.text, corrected);
const rejectedScope = await run({ ...selectedCleared, failureFields: scopeFailure, rejectRepair: true });
assert.equal(rejectedScope.repairs.length, 1); assert.equal(rejectedScope.reviews.length, 2);
assert(rejectedScope.out.degraded);
const { buildGuestProductReplyCopy } = await import('../server/guest-product-reply-copy.js');
assert(rejectedScope.out.text.includes(buildGuestProductReplyCopy('noMatch', { languageCode: 'en' })),
  'known empty-result fallback uses the existing empty copy, not an implication that an unconfirmed result exists');
assert(!rejectedScope.out.text.includes('I cannot confirm that this result'), 'no contradictory scope-result note on trusted empty searches');
for (const change of [input => { delete input.productContext.searchIntent.productCandidateState; },
  input => { input.productContext.searchIntent.productCandidateState.characterId = 'foreign'; },
  input => { input.productContext.searchIntent.productCandidateState = selectedWithCandidate.searchIntent.productCandidateState; },
  input => { input.productContext.searchIntent.productRequestState.selectedIndex = 1; },
  input => { input.productContext.searchOutcome = 'source_error'; }]) {
  const input = structuredClone(selectedCleared); change(input);
  assert.equal(contextFor(input), null);
  assert.equal(eligibility({ ...input, failedContracts: ['product_scope', 'business_facts'], reviewResult: { ...verdict, ...scopeFailure } }), false,
    'scope correction never bypasses the same source/ownership/candidate proof');
}
assert.equal(eligibility({ ...base, failedContracts: ['product_scope'], reviewResult: { ...verdict, productScopeSupported: false } }), false,
  'single-target no-match does not acquire the selected-scope exception');
console.log('Cleared candidate vs selected-source separation, one scope-text correction and truthful terminal empty fallback passed');
