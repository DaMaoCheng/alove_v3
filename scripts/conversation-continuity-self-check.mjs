import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw Error('No network in continuity regression'); };
const { enforceReplyBoundary, assessReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const { normalizeCheckoutIssue } = await import('../server/checkout-support-guidance.js');
const { buildProductSizingFallback } = await import('../server/product-sizing-copy.js');
const { getChatOrderEntryCopy } = await import('../shared/chat-order-copy.js');
const { resolveChatFeedbackActionCandidate } = await import('../server/chat-feedback-action-service.js');
const { buildSizingConversationContext } = await import('../server/product-sizing-guidance-service.js');
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { repairGroundedCommerceReply, isGroundedCommerceRepairEligible } = await import('../server/chat-grounded-reply-repair-service.js');
const { ORDER_CONTRACT } = await import('../server/chat-reply-review-contracts.js');
const { buildCommerceDecisionLogEvent } = await import('../server/ai-reply-log-service.js');
const character = { id: 'mascot_continuity', categoryId: 'mascot' };
const recentMessages = [{ senderType: 'user', text: 'No puedo seleccionar el estado de Illinois en la dirección. No he enviado el pedido.' }];
const userText = 'Me dice que el estado es obligatorio; solo necesito terminar esta compra.';
const checkoutIssue = normalizeCheckoutIssue({ active: true, requestScope: 'checkout_only', evidence: 'Me dice que el estado es obligatorio', stage: 'address', stageEvidence: 'en la dirección', errorEvidence: 'el estado es obligatorio', orderPlaced: false, orderEvidence: 'No he enviado el pedido', lookupRequested: false, lookupEvidence: 'solo necesito terminar esta compra' }, { userText, recentMessages, confidence: .96 });
assert(checkoutIssue);
const checkout = { checkoutIssue, commerceRoute: 'store_policy', commerceTopic: 'support', answerRequired: true, knowledgeScope: 'business', replyBoundary: { salesAllowed: false, contactAllowed: false } };
const approved = { allowed: true, confidence: .96, guidanceSupported: true, businessFactsSupported: true, boundarySupported: true, evidenceSupported: true };
const rejected = { ...approved, allowed: false, guidanceSupported: false, businessFactsSupported: false };
const useful = 'Entiendo que falta seleccionar el estado. ¿Qué país aparece seleccionado?';
let reviews = 0;
const accepted = await enforceReplyBoundary({ character, searchIntent: checkout, knowledgeContext: { items: [] }, userText, recentMessages, language: 'es', replyResult: { text: useful, speechText: useful, sourceType: 'ai' }, assess: async input => {
  reviews++;
  assert.equal(input.checkoutContext.errorEvidence, 'el estado es obligatorio');
  return approved;
} });
assert.equal(reviews, 1, 'Empty knowledge must not bypass review');
assert.equal(accepted.text, useful, 'A reviewed question about a missing diagnostic detail must survive empty knowledge');
assert.equal(accepted.speechText, useful);
const failed = await enforceReplyBoundary({ character, searchIntent: checkout, knowledgeContext: { items: [] }, userText, recentMessages, language: 'es', replyResult: { text: 'Your address is wrong.', sourceType: 'ai' }, assess: async () => rejected });
assert.doesNotMatch(failed.text, /\?|¿/, 'Known-error terminal fallback must not endlessly ask for other error details');
assert.equal(failed.text, failed.speechText);
const sizingIntent = { commerceRoute: 'product_question', commerceTopic: 'sizing', answerRequired: true, knowledgeScope: 'business', needsLiveProductData: false, cardAllowed: false };
const sizingInput = { character, searchIntent: sizingIntent, userText: '45 centímetros', recentMessages: [{ senderType: 'character', text: '¿Cuánto mide tu pecho?' }, { senderType: 'user', text: 'Creo que 45 cm' }], knowledgeContext: { items: [], strategy: 'business_selection_unavailable' }, language: 'es' };
const uncertainSizing = await resolveCommerceSearchIntent({ userText: sizingInput.userText, recentMessages: sizingInput.recentMessages, enrichAllTurns: true,
  classifyCommerce: async () => ({ confident: false, confidence: .72, route: 'store_policy', topic: 'sizing', answerRequired: false }) });
assert.equal(uncertainSizing.cardAllowed, false);
assert.equal(uncertainSizing.shouldLoadProductContext, false);
assert.equal(uncertainSizing.replyBoundary.contactAllowed, false);
assert(buildSizingConversationContext({ ...sizingInput, searchIntent: uncertainSizing }), 'Tentative sizing purpose may constrain clarification without granting any action');
assert.equal(JSON.parse(buildCommerceDecisionLogEvent({ searchIntent: uncertainSizing }).errorMessage).replyTopicHint, 'sizing');
assert.equal(buildSizingConversationContext({ ...sizingInput, searchIntent: { ...sizingIntent, commerceRoute: 'chat', knowledgeScope: 'general' } }), null, 'A sizing term definition must not become a store measurement lookup');
const sizing = await enforceReplyBoundary({ ...sizingInput, replyResult: { text: 'That guarantees M fits.', sourceType: 'ai' }, assess: async () => rejected });
assert.equal(sizing.text, buildProductSizingFallback({}, 'es'), 'Unanchored sizing rejection must remain about sizing, never support channels');
let attempts = 0;
const clarified = '¿Es el ancho de la camiseta en plano o el contorno del cuerpo?';
const repaired = await enforceReplyBoundary({ ...sizingInput, replyResult: { text: 'That guarantees M fits.', sourceType: 'ai' }, assess: async input => input.text === clarified ? approved : rejected,
  repairGroundedReply: async input => { attempts++; assert.equal(input.userText, '45 centímetros'); return { text: clarified, speechText: clarified, sourceType: 'ai' }; } });
assert.equal(attempts, 1, 'Sizing clarification reuses exactly one grounded regeneration');
assert.equal(repaired.text, clarified);
let failedCorrections = 0;
const terminalSizing = await enforceReplyBoundary({ ...sizingInput, replyResult: { text: 'Guaranteed fit.', sourceType: 'ai' }, assess: async () => rejected,
  repairGroundedReply: async () => { failedCorrections++; return { text: 'Still guaranteed.', sourceType: 'ai' }; } });
assert.equal(failedCorrections, 1, 'A rejected correction cannot recursively retry');
assert.equal(terminalSizing.text, buildProductSizingFallback({}, 'es'));
const orderActionCandidate = { kind: 'ttmall_order_lookup', status: 'login_required', siteSlug: 'shop' };
const uncertainIntent = { commerceRoute: 'unclear', replyBoundaryReason: 'classification_uncertain', replyBoundary: { salesAllowed: false } };
const orderReply = await enforceReplyBoundary({ character, searchIntent: uncertainIntent, orderActionCandidate, language: 'es', userText: '¿Dónde está el paquete?', replyResult: { text: 'I did not understand.', sourceType: 'ai' }, assess: async () => rejected });
assert.equal(orderReply.text, getChatOrderEntryCopy('es', 'login_required'), 'Known order action must not acquire generic unclear-product text');
assert.equal(orderReply.text, orderReply.speechText);
const productScope = { ...uncertainIntent, replyBoundary: { salesAllowed: true }, scopeUnverified: true, productScopePending: true };
const genuineScope = await enforceReplyBoundary({ character, searchIntent: productScope, orderActionCandidate, language: 'es', replyResult: { text: 'Invented products.', sourceType: 'ai' }, assess: async () => ({ ...rejected, productScopeSupported: false }) });
assert.match(genuineScope.text, /pregunta/, 'A genuine separate unresolved product scope must survive an order action');
const mixedText = 'El envío estándar se describe como gratuito. Puedes consultar tu pedido mediante el acceso disponible.';
const mixed = await enforceReplyBoundary({ character, searchIntent: { commerceRoute: 'store_policy', commerceTopic: 'delivery', knowledgeScope: 'business', answerRequired: true }, orderActionCandidate, language: 'es', replyResult: { text: mixedText, speechText: mixedText, sourceType: 'ai' }, assess: async () => approved });
assert.equal(mixed.text, mixedText, 'Reviewed policy/order mixed replies must remain intact');
const verifiedPolicy = { strategy: 'business_verified_reference', items: [{ id: 'shipping', scope: 'site', siteId: 'shop',
  content: 'US delivery estimates are 5–13 days express and 10–25 days standard. Delays are possible.',
  evidenceQuote: 'US delivery estimates are 5–13 days express and 10–25 days standard.' }] };
const mixedPolicyIntent = { commerceRoute: 'store_policy', commerceTopic: 'delivery', knowledgeScope: 'business', answerRequired: true,
  shouldLoadProductContext: false, needsLiveProductData: false, cardAllowed: false, replyBoundary: { salesAllowed: false, contactAllowed: false } };
let mixedCorrections = 0, mixedReviews = 0;
const correctedMixed = 'El plazo estimado para Estados Unidos es de 5–13 días con envío exprés y de 10–25 con envío estándar; puede haber retrasos. Usa el acceso a pedidos; vincula tu cuenta solo si se solicita.';
const mixedRecovered = await enforceReplyBoundary({ character, searchIntent: mixedPolicyIntent, orderActionCandidate,
  knowledgeContext: verifiedPolicy, userText: 'How long is US shipping and where can I track my existing order?', language: 'es',
  replyResult: { text: 'Delivery is guaranteed tomorrow. Your account is definitely unlinked.', sourceType: 'ai' },
  assess: async input => { mixedReviews++; assert.equal(input.orderActionState, 'login_required'); return input.text === correctedMixed ? approved : rejected; },
  repairGroundedReply: async () => { mixedCorrections++; return { text: correctedMixed, speechText: correctedMixed, sourceType: 'ai' }; } });
assert.equal(mixedCorrections, 1, 'Verified policy plus existing order entry permits exactly one text correction');
assert.equal(mixedReviews, 2, 'Corrected mixed text must receive the original complete order/policy review');
assert.equal(mixedRecovered.text, correctedMixed);
assert.equal(mixedRecovered.speechText, correctedMixed);
let mixedRejectedAttempts = 0;
const mixedRejected = await enforceReplyBoundary({ character, searchIntent: mixedPolicyIntent, orderActionCandidate,
  knowledgeContext: verifiedPolicy, language: 'es', replyResult: { text: 'Guaranteed tomorrow.', sourceType: 'ai' }, assess: async () => rejected,
  repairGroundedReply: async () => { mixedRejectedAttempts++; return { text: 'Still guaranteed tomorrow.', sourceType: 'ai' }; } });
assert.equal(mixedRejectedAttempts, 1, 'A rejected mixed correction must not recurse or approve original text');
assert.equal(mixedRejected.text, getChatOrderEntryCopy('es', 'login_required'));
const mixedRepairOptions = { character, searchIntent: mixedPolicyIntent, orderActionCandidate, knowledgeContext: verifiedPolicy,
  replyResult: { text: 'Guaranteed next-day delivery.', sourceType: 'ai', businessFactsSupported: true, productScopeVerified: true },
  reviewResult: { ...rejected, reviewStatus: 'valid' }, failedContracts: ['guidance', 'business_facts', 'boundary'], language: 'es' };
for (const invalid of [
  { knowledgeContext: { ...verifiedPolicy, items: [] } },
  { knowledgeContext: { ...verifiedPolicy, strategy: 'business_selection_unavailable' } },
  { orderActionCandidate: { ...orderActionCandidate, kind: 'unknown' } },
  { orderActionCandidate: { ...orderActionCandidate, status: 'already_delivered' } },
  { orderActionCandidate: { ...orderActionCandidate, siteSlug: '' } },
  { chatImageContext: { taskCreated: true } }, { guestBenefitContext: { issuanceAllowed: false } },
  { searchIntent: { ...mixedPolicyIntent, productScopePending: true } }, { groundedRepairAttempted: true },
]) assert.equal(isGroundedCommerceRepairEligible({ ...mixedRepairOptions, ...invalid }), false, 'Mixed policy correction cannot bypass source, action, image, benefit or scope limits');
for (const status of ['login_required', 'binding_required']) {
  let generated = 0;
  const candidate = await repairGroundedCommerceReply({ ...mixedRepairOptions, orderActionCandidate: { ...orderActionCandidate, status, orderNumber: 'DO_NOT_DUPLICATE' },
    config: { apiKey: 'isolated', model: 'fixture', apiMode: 'chat_completions' }, recordLog: async () => {},
    requestText: async input => {
      generated++;
      assert(input.systemPrompt.includes(ORDER_CONTRACT), 'Reuse the original order entry limits in correction');
      const data = JSON.parse(input.messages[0].content);
      assert.equal(data.orderActionState, status);
      assert.equal(JSON.stringify(data).includes('DO_NOT_DUPLICATE'), false, 'Correction receives only the finite entry state');
      assert.deepEqual(data.replyBoundary, { salesAllowed: false, contactAllowed: false });
      return JSON.stringify({ displayText: correctedMixed });
    } });
  assert.equal(generated, 1);
  assert.equal(candidate.text, correctedMixed);
  assert.equal(candidate.productScopeVerified, undefined, 'A correction must not inherit prior approval');
}


const feedbackInput = { character, searchIntent: { ...sizingIntent, replyBoundary: { contactAllowed: true } }, knowledgeContext: { customerServiceIntent: true, customerServiceTopic: 'sizing', items: [] }, userText: '45 cm' };
assert.equal(resolveChatFeedbackActionCandidate(feedbackInput), null, 'Missing sizing context alone does not require a human handoff');
assert(resolveChatFeedbackActionCandidate({ ...feedbackInput, userText: '45 cm. Also, how can I return my order?', knowledgeContext: { ...feedbackInput.knowledgeContext, customerServiceTopic: 'returns' } }), 'A concurrent return concern keeps its existing feedback entry');
for (const factual of [true, false]) {
  const text = factual ? 'That measurement would be too tight.' : 'Is that a garment width or a body circumference?';
  const reviewed = await assessReplyBoundary({ text, userText: sizingInput.userText, searchIntent: sizingIntent,
    sizingConversationContext: buildSizingConversationContext(sizingInput), businessFactsRequired: true, guidanceRequired: true,
    knowledgeContext: { items: [] }, config: { apiKey: 'isolated', baseUrl: 'https://continuity.invalid', model: 'fixture' }, recordLog: async () => {},
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const data = JSON.parse(body.messages.at(-1).content);
      assert(data.businessClaimContext?.units.length, 'Every sizing output sentence must be audited even without KB');
      assert.deepEqual(data.businessClaimContext.references, []);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...approved,
        businessClaimAudit: data.businessClaimContext.units.map(unit => ({ unitId: unit.id, factual, referenceIds: [], supported: !factual, sourceAllowsException: false, replyPreservesException: false })) }) } }] }));
    } });
  assert.equal(reviewed.reviewStatus, 'valid');
  assert.equal(reviewed.allowed, !factual, 'An unreferenced fit inference fails; a useful measurement question survives');
}
const ordinary = await enforceReplyBoundary({ character: { categoryId: 'babe' }, searchIntent: {}, replyResult: { text: 'Good to see you.', speechText: '[happy] Good to see you.', sourceType: 'ai' }, assess: async () => { throw Error('Unrelated conversation must not gain business review'); } });
assert.equal(ordinary.speechText, '[happy] Good to see you.');
console.log('conversation continuity regression passed (real guard, no network/DB)');
