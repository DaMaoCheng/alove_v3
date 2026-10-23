import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('No external calls in matched-caption checks'); };
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const { hasMatchedCatalogueCaptionContext, isGroundedCommerceRepairEligible, repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
const { buildLanguageQualityFallbackReply } = await import('../server/chat-reply-language-quality.js');
const { selectProductsForReply } = await import('../server/chat-product-reply-service.js');
const intent = { commerceRoute: 'product_search', commerceTopic: 'other', knowledgeScope: 'business',
  knowledgeQuery: 'Which Club shirt would you choose?', query: 'Arsenal shirt', primarySearchVerified: true,
  shouldLoadProductContext: true, needsLiveProductData: true, cardAllowed: true, answerRequired: true,
  requestedTeam: 'Arsenal', requestedProductType: 'shirt', requestedKeywords: [], searchState: 'ready_to_search',
  replyBoundary: { salesAllowed: true, contactAllowed: true } };
const product = { id: 'home', name: 'Arsenal Home Jersey 2026/27', siteId: 'shop', url: 'https://example.test/home', available: true,
  attributeEvidence: { edition: 'unknown', sleeve: 'unknown', printing: 'unknown', giveaway: null } };
const no = { reviewStatus: 'valid', allowed: false, confidence: .99, boundarySupported: false,
  businessFactsSupported: false, evidenceSupported: true, factualSupported: false, guidanceSupported: true,
  languageQualitySupported: false };
const yes = { ...no, allowed: true, boundarySupported: true, businessFactsSupported: true, factualSupported: true };
const base = { character: { id: 'mascot', category_id: 'mascot', site_id: 'shop' }, trustedSite: { id: 'shop' }, language: 'hu',
  userText: 'Which Arsenal shirt would you choose?', searchIntent: intent,
  productContext: { sourceType: 'product_api', sourceRef: 'guest-site-product-context', siteId: 'shop',
    searchOutcome: 'matched', cardAllowed: true, searchIntent: intent, products: [product] },
  knowledgeContext: { ok: true, strategy: 'business_no_relevant_section', customerServiceIntent: true, customerServiceTopic: 'other', items: [] },
  factualContext: { required: false, status: 'not_required', asOfUtc: '2026-10-23T00:00:00Z', searched: false, items: [] },
  replyResult: { text: 'Malformed candidate.', speechText: 'Malformed candidate.', sourceType: 'ai', sourceRef: 'venice-chat-completions' } };
assert.equal(hasMatchedCatalogueCaptionContext(base), true);
assert.equal(isGroundedCommerceRepairEligible({ ...base, reviewResult: no, reviewStatus: 'valid',
  failedContracts: ['language', 'factual', 'business_facts', 'boundary'] }), true);
for (const patch of [
  { searchIntent: { ...intent, commerceTopic: 'delivery' } },
  { searchIntent: { ...intent, businessInquiry: { kind: 'wholesale' } } },
  { searchIntent: { ...intent, humanHandoff: { explicitRequest: true } } },
  { searchIntent: { ...intent, replyBoundary: { salesAllowed: false } } },
  { orderActionCandidate: { kind: 'order' } }, { feedbackActionCandidate: { kind: 'feedback' } },
  { chatImageContext: {} }, { guestBenefitContext: {} },
  { knowledgeContext: { items: [], customerServiceTopic: 'delivery' } },
  { knowledgeContext: { items: [{ id: 'shipping', content: 'Verified shipping policy.' }] } },
  { factualContext: { ...base.factualContext, required: true } },
  { trustedSite: { id: 'other' } },
  { productContext: { ...base.productContext, searchOutcome: 'candidate' } },
]) assert.equal(hasMatchedCatalogueCaptionContext({ ...base, ...patch }), false);
async function run(mode) {
  let reviews = 0, repairs = 0, languages = 0;
  const output = await enforceReplyBoundary({ ...base, requireIdentityReview: true, languageQualityRequired: true,
    independentLanguageQualityRequired: true, recordReview: async () => {},
    assess: async () => (++reviews === 1 || mode === 'rejected' ? no : yes),
    assessLanguageQuality: async () => ({ reviewStatus: 'valid', languageQualitySupported: ++languages > 1,
      retainedLanguageQualitySupported: false, confidence: .99, severity: languages === 1 ? 'major' : 'none', languageIssues: [] }),
    repairGroundedReply: async () => { repairs++; return mode === 'timeout' ? null
      : { ...base.replyResult, text: 'Én ezt választanám.', speechText: 'Én ezt választanám.' }; },
  });
  assert.equal(repairs, 1, 'one fresh correction only');
  assert.equal(selectProductsForReply(base.productContext, output).length, 1, 'ordinary matched-card permissions are unchanged');
  if (mode === 'accepted') {
    assert.equal(reviews, 2); assert.equal(languages, 2); assert.equal(output.text, 'Én ezt választanám.');
    assert.equal(output.replyRecoveryState, undefined);
  } else {
    assert.equal(reviews, mode === 'timeout' ? 1 : 2);
    assert.equal(output.text, buildLanguageQualityFallbackReply('hu'), 'pure matched failure cannot become a support-policy refusal or no-match claim');
    assert.equal(output.replyRecoveryState.guardApplied, true, 'fallback never pretends review acceptance');
  }
}
await run('accepted'); await run('timeout'); await run('rejected');
console.log('matched caption recovery checks passed: knowledge hint, mixed scopes, one correction, full re-review and honest terminal state');

const twoProducts = { ...base, productContext: { ...base.productContext, products: [product,
  { ...product, id: 'away', name: 'Arsenal Away Jersey 2026/27', url: 'https://example.test/away' }] } };
let captionPacket;
await repairGroundedCommerceReply({ ...twoProducts, reviewResult: no, reviewStatus: 'valid',
  failedContracts: ['language', 'factual', 'business_facts', 'boundary'],
  config: { apiKey: 'fixture', model: 'fixture', apiMode: 'chat_completions' },
  requestText: async prompt => { captionPacket = JSON.parse(prompt.messages[0].content); return JSON.stringify({displayText:'Én ezt választanám.'}); } });
assert.deepEqual(captionPacket.matchedCatalogue.products.map(p=>p.id), ['home', 'away'], 'verified comparison evidence remains available without changing the selected cards');
assert.deepEqual(captionPacket.matchedCatalogue.productCardDelivery.cards.map(p=>p.id), ['home']);
assert.equal(twoProducts.productContext.products.length, 2, 'original evidence pool and selection are unchanged');
console.log('matched correction preserves comparison evidence and exact card delivery');
const canonical = { ...base, character: { ...base.character, site_id: 'old-demo' },
  trustedSite: { id: 'shop', identity_mascot_character_id: 'mascot' } };
assert.equal(hasMatchedCatalogueCaptionContext(canonical), true, 'current server canonical mascot binding owns caption purpose despite legacy role site metadata');
for (const patch of [
  { trustedSite: { id: 'foreign', identity_mascot_character_id: 'mascot' } },
  { trustedSite: { id: 'shop', identity_mascot_character_id: 'other' } },
  { character: { ...canonical.character, category_id: 'creator' } },
  { trustedSite: { id: 'shop' } },
]) assert.equal(hasMatchedCatalogueCaptionContext({ ...canonical, ...patch }), false, 'canonical exception cannot grant another site or unrelated character caption authority');
