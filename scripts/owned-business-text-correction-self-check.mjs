import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('External calls forbidden'); };
const { isGroundedCommerceRepairEligible } = await import('../server/chat-grounded-reply-repair-service.js');
const base = { character: { id: 'mascot_fixture', category_id: 'mascot', site_id: 'shop' }, trustedSite: { id: 'shop' },
  userText: 'Why did the advertised price change?', replyResult: { sourceType: 'ai', sourceRef: 'venice-chat-completions', text: 'A rejected candidate.' },
  searchIntent: { commerceRoute: 'store_policy', knowledgeScope: 'business', answerRequired: true, cardAllowed: false,
    shouldLoadProductContext: false, needsLiveProductData: false, policyKnowledgeRequest: { source: 'jev', required: false },
    replyBoundary: { salesAllowed: false, contactAllowed: true } },
  knowledgeContext: { ok: true, strategy: 'not_requested', items: [], customerServiceIntent: false },
  factualContext: { required: false, searched: false, items: [] }, feedbackActionCandidate: { kind: 'feedback' },
  reviewStatus: 'valid', reviewResult: { allowed: false, confidence: .9, boundarySupported: true, businessFactsSupported: false }, failedContracts: ['business_facts'] };
assert(isGroundedCommerceRepairEligible(base), 'no-policy feedback must allow one owned text correction');
for (const promotionInquiry of [{ kind: 'policy' }, { kind: 'policy', evidence: base.userText }]) {
  assert(isGroundedCommerceRepairEligible({ ...base, searchIntent: { ...base.searchIntent, promotionInquiry, discountExplanationRequired: true } }), 'policy flags must not block text correction');
}
const image = { taskCreated: true, reason: 'image_task_created', trigger: { requestScope: 'mixed' }, imageStatus: { kind: 'generated', status: 'generating', currentTurn: true },
  _imageStatusAnchor: { messageId: 'image', assetId: 'asset', kind: 'generated', displayOrder: 3,
    scope: { sessionId: 'chat', characterId: 'mascot_fixture', guestId: 'guest', order: 2 } } };
assert(isGroundedCommerceRepairEligible({ ...base, chatImageContext: image }), 'owned mixed image is a read-only state, not a reason to lose the business answer');
for (const patch of [ { languageRepairAttempted: true }, { groundedRepairAttempted: true }, { guestBenefitContext: {} },
  { trustedSite: { id: 'foreign' } }, { chatImageContext: { ...image, _imageStatusAnchor: { ...image._imageStatusAnchor, scope: { ...image._imageStatusAnchor.scope, characterId: 'foreign' } } } },
  { knowledgeContext: { ...base.knowledgeContext, ok: false, selectionFailure: 'timeout' } },
  { knowledgeContext: { ...base.knowledgeContext, businessOwner: { siteId: 'foreign', characterId: 'mascot_fixture' } } },
  { searchIntent: { ...base.searchIntent, promotionInquiry: { kind: 'benefit_request' } } },
  { searchIntent: { ...base.searchIntent, commerceClassificationUnavailable: true } },
  { reviewStatus: 'timeout' }, { reviewResult: { ...base.reviewResult, protocolFailures: ['invalid'] } },
  { reviewResult: { ...base.reviewResult, businessFactsSupported: undefined } } ]) {
  assert(!isGroundedCommerceRepairEligible({ ...base, ...patch }), 'ownership, protocol and once-only guards remain closed');
}
console.log('owned business text correction eligibility passed');

// Exercise the real orchestration seam with deterministic reviewer fixtures.
// Real provider/page verification is a separate layer, not simulated here.
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const approved = { allowed: true, confidence: .99, boundarySupported: true, evidenceSupported: true,
  businessFactsSupported: true, guidanceSupported: true, candidateConfirmationSupported: true,
  productScopeSupported: true, imageStatusSupported: true, guestBenefitSupported: true, factualSupported: true };
for (const mixed of [false, true]) for (const acceptRewrite of [false, true]) {
  let reviews = 0, generations = 0, failure;
  const text = 'A fresh contextual answer to the business question.';
  const output = await enforceReplyBoundary({ ...base, ...(mixed ? { chatImageContext: image } : {}),
    language: 'en', languageQualityRequired: true, independentLanguageQualityRequired: true,
    recordReview: async () => {},
    ...(mixed ? { refreshImageStatus: async context => ({ ...context, imageStatus: { ...context.imageStatus, status: 'ready' } }) } : {}),
    assess: async () => { reviews++; return reviews === 1 || !acceptRewrite ? { ...approved, allowed: false, businessFactsSupported: false } : approved; },
    assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: .99, languageQualitySupported: true, languageIssues: [] }),
    regenerateReply: async (prior, context) => { generations++; failure = context; assert.equal(prior.text, base.replyResult.text);
      return { ...prior, text, displayText: text, speechText: text }; },
  });
  assert.equal(generations, 1, 'only one text generation across all recovery branches');
  assert.equal(reviews, 2, 'the changed reply receives the complete original review');
  assert(failure.repairFeedback.failedContracts.includes('business_facts'), 'specific failing contract reaches original generator');
  assert.equal(output.text === text, acceptRewrite, 'rejected new text cannot be published');
  if (mixed) { assert.equal(output._imageDeliveryReply.natural, acceptRewrite);
    assert.equal(output._imageDeliveryReply.businessReplyRetained, undefined, 'accepted wording is not proof every mixed question was answered'); }
}
console.log('owned business text correction full orchestration passed');

const liveProduct = { id: 'shirt', productId: 'shirt', name: 'Verified shirt', siteId: 'shop', siteSlug: 'shop', url: 'https://example.test/shirt', summary: 'Name and number customization is available.' };
const live = { ...base, feedbackActionCandidate: null, trustedSite: { id: 'shop', slug: 'shop' }, retained: 'A supported existing item attribute.',
  searchIntent: { ...base.searchIntent, commerceRoute: 'product_question', commerceTopic: 'other', productRequirementAction: 'continue', needsLiveProductData: true, referencedProductId: 'shirt' },
  recentMessages: [{ senderType: 'character', characterId: base.character.id, contentType: 'product', product: liveProduct }],
  productContext: { sourceType: 'product_api', sourceRef: 'live-displayed-product-reference', siteId: 'shop', searchOutcome: 'matched', cardAllowed: false, products: [liveProduct] } };
assert(isGroundedCommerceRepairEligible(live), 'an approved fragment must not block one complete correction of the unanswered current-item question');
for (const patch of [{ languageRepairAttempted: true }, { groundedRepairAttempted: true }, { trustedSite: { id: 'foreign' } },
  { recentMessages: [] }, { productContext: { ...live.productContext, sourceErrorCode: 'timeout' } }]) {
  assert(!isGroundedCommerceRepairEligible({ ...live, ...patch }), 'retained text never substitutes for current product proof or reopens recovery');
}
