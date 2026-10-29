import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
process.env.VENICE_API_KEY = 'isolated-image-boundary';
process.env.TYPESAFE_API_KEY = 'fixture-image-jev';
const { classifyChatImageIntent: actualClassifyImage, isProductCapableCharacter } = await import('../server/chat-image-intent-classifier-service.js');
const { classifyJevImageDetails } = await import('../server/jev-image-decision-service.js');
const classifyChatImageIntent = (text, options) => actualClassifyImage(text, { ...options,
  classifyImageJev: (input, detailOptions) => classifyJevImageDetails(input, { ...detailOptions,
    evaluate: async body => {
      calls++; lastBody = { ...body, messages: [{ content: Object.values(body.questions).map(q => q.instructions).join('\n') }, { content: JSON.stringify(body.state) }] };
      if (fail) return { ok: false };
      const chooseSpan = (criteria, evidence) => Object.keys(criteria).find(key => key !== 'none' && criteria[key] === evidence) || 'none';
      const selected = { image_type: response?.intentType || 'unclear', image_scope: response?.requestScope || 'unknown',
        clothing_target: response?.clothingTarget || (response?.intentType === 'try_on' ? 'generic' : 'none'),
        previous_outfit: response?.appearanceContext?.previousOutfit || 'uncertain', appearance_relation: response?.appearanceContext?.relation || 'uncertain' };
      const answers = Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key, {
        choice: key === 'actor_evidence' ? chooseSpan(q.criteria, response?.actorEvidence)
          : key === 'action_evidence' ? chooseSpan(q.criteria, response?.requestEvidence || response?.actionEvidence)
          : selected[key] || Object.keys(q.criteria)[0], confidence: response?.confidence ?? .98,
      }]));
      return { ok: true, answers };
    },
  }),
});
const { evaluateChatImageRequest: actualEvaluateImage, maybeCreateGuestChatImagePlaceholder: actualMaybeGuest } = await import('../server/chat-image-generation-service.js');
const maybeCreateGuestChatImagePlaceholder = async (db, options) => {
 const imageDecision = options.imageDecision || await classifyChatImageIntent(options.userText, { character: options.character,
  jevDecision: options.jevDecision, conversationContext: options.conversationContext, forceTargetVerification: true });
 return actualMaybeGuest(db, { ...options, imageDecision });
};
const evaluateChatImageRequest = async (db, options) => {
 if (!options.imageDecision && options.jevDecision) {
  const imageDecision = await classifyChatImageIntent(options.userText, { character: options.character,
   jevDecision: options.jevDecision, conversationContext: options.conversationContext, forceTargetVerification: true });
  return actualEvaluateImage(db, { ...options, imageDecision });
 }
 return actualEvaluateImage(db, options);
};
const { normalizeGuestReplyText } = await import('../server/guest-chat-output-policy.js');
const { getChatImageStatusCopy } = await import('../server/chat-image-copy-service.js');
const character = { id: 'mascot_test', category_id: 'mascot' };
const mistaken = { ok: true, confident: true, confidence: .99, imageIntent: 'try_on', imageConditions: { wants_clothing: true, wants_no_clothing: false } };
let response, calls = 0, lastBody, fail = false;
const { applyChatImageCommercePolicy } = await import('../server/chat-image-commerce-policy-service.js');
const mistakenPhoto = { hasIntent: true, allowed: true, intentType: 'library_photo', actionEvidence: 'La del paris st de dior', actorEvidence: 'dior' };
for (const intent of [
  { commerceRoute: 'unclear', replyTopicHint: 'product_selection' },
  { commerceRoute: 'unclear', productScopePending: true },
]) {
  assert.equal(applyChatImageCommercePolicy(mistakenPhoto, { commerceIntent: intent, userText: 'La del paris st de dior' }).hasIntent, false,
    'uncertain product admission cannot become a character photo');
}
let checks = 0;
try {
  const nonImage = { ...mistaken, imageIntent: 'none', primaryIntent: 'chat' };
  const beforeNonImage = calls;
  for (const text of [
    'Hola camiseta de Italia ?',
    'Hello do you guys provide discounts for bulk orders?',
    'What is the product price?',
    'Can I order a batch of shirts?',
    'Do you offer catalog access?',
    'Show me the product image and its price',
    '这件商品图是哪个款式，批量购买有优惠吗？',
    'Can I buy the white background poster?',
    '批量购买有优惠吗',
    '我要多张银行卡',
    '你们卖多套球衣吗',
    'generate two reports',
    'make three recommendations',
    'ok déjame verlas... cuanto tarda el envío?',
    'Messi bucsumezet lehet e kerni messi felirat nelkul ? Magyarul valaszolj',
    '这件球衣的照片不清楚，什么时候发货？',
    'Zeig mir das Trikot. Wie lange dauert die Lieferung?',
    'Montre ce maillot et explique les tailles.',
    'Bu formanın baskısı çıkarılabilir mi?',
    'このユニフォームを見せて、配送は何日ですか？',
  ]) {
    response = { hasIntent: false, allowed: false, confidence: .98, intentType: 'none', imageSubject: 'product', requestEvidence: text };
    const result = await maybeCreateGuestChatImagePlaceholder({ execute: () => { throw new Error('commerce must never touch image writes or quota'); } }, { character, userText: text, jevDecision: nonImage, conversationContext: {} });
    assert.equal(result.requested, false, text); assert.equal(result.taskCreated, false); checks++;
  }
  assert.equal(calls, beforeNonImage, 'non-image primary selection must not invoke image type classification');
  // A mistaken positive primary decision is no longer overturned by stage two; test primary routing separately.
  for (const [text, intentType] of [['Send your selfie', 'library_photo'], ['Try this shirt on', 'try_on'], ['Create a photo of us together', 'group_photo']]) {
    response = { hasIntent: true, allowed: true, confidence: .98, intentType, communicativeAction: 'request_visual_output', requestKind: 'character_image', imageSubject: 'character', requestEvidence: text, actorEvidence: text.split(' ')[0], actionEvidence: text, clothingTarget: intentType === 'try_on' ? 'generic' : 'none', wants_clothing: intentType === 'try_on', wants_no_clothing: false };
    const result = await evaluateChatImageRequest(null, { character, userText: text, jevDecision: mistaken, conversationContext: { recentConversation: [{ role: 'user', text: 'Arsenal shirt' }], latestImageKind: 'product' } });
    assert.equal(result.trigger.hasIntent, true); assert.equal(result.trigger.allowed, true); assert.equal(result.trigger.intentType, intentType); checks++;
  }
  response = { hasIntent: true, allowed: true, confidence: .98, intentType: 'library_photo', communicativeAction: 'request_visual_output',
    requestKind: 'character_image', imageSubject: 'character', requestScope: 'mixed',
    requestEvidence: 'send it to me again', actorEvidence: 'your', actionEvidence: 'send it to me again',
    clothingTarget: 'none', wants_clothing: false, wants_no_clothing: false };
  const resendText = 'Okay, send it to me again, see if I can see the image.';
  const resend = await classifyChatImageIntent(resendText, { character, jevDecision: { ...mistaken, imageConditions: {} }, conversationContext: { recentConversation: [
    { role: 'user', kind: 'text', text: 'Send your photo' }, { role: 'assistant', kind: 'mascot_library_image', text: '' },
  ], latestImageKind: 'character' } });
  assert.equal(resend.hasIntent, true, 'inspection wording cannot discard an independently grounded resend request');
  assert.equal(resend.explicitGeneration, false, 'resend does not authorize synthesis');
  assert.equal(resend.requestScope, 'mixed'); checks++;
  const independentPhoto = { ...resend, actionEvidence: 'Send your selfie', actorEvidence: 'your' };
  assert.equal(applyChatImageCommercePolicy(independentPhoto, { commerceIntent: { commerceRoute: 'unclear', productScopePending: true }, userText: 'Send your selfie and clarify the shirt options' }).hasIntent,
    true, 'pending merchandise must preserve an independent current character photo request'); checks++;
  // Preserve the prior payload assertion's original scenario.
  response = { hasIntent: true, allowed: true, confidence: .98, intentType: 'group_photo', communicativeAction: 'request_visual_output', requestKind: 'character_image', imageSubject: 'character', requestEvidence: 'Create a photo of us together', actorEvidence: 'us', actionEvidence: 'Create a photo of us together', wants_clothing: false, wants_no_clothing: false };
  await classifyChatImageIntent('Create a photo of us together', { character, jevDecision: mistaken, conversationContext: { recentConversation: [{ role: 'user', text: 'Arsenal shirt' }], latestImageKind: 'product' } });
  const payload = JSON.parse(lastBody.messages[1].content);
  assert.equal(payload.recentConversation[0].text, 'Arsenal shirt'); assert.equal(payload.latestImageKind, 'product'); checks++;
  // A real selected type remains valid even at low confidence. Evidence and unsupported-task safeguards remain independent.
  response = { intentType: 'library_photo', confidence: .1, requestEvidence: 'Show your photo', actorEvidence: 'your' };
  const lowScore = await evaluateChatImageRequest(null, { character, userText: 'Show your photo', jevDecision: mistaken, conversationContext: {} });
  assert.equal(lowScore.trigger.hasIntent, true); checks++;
  response = { hasIntent: false, allowed: false, confidence: .98, intentType: 'none', communicativeAction: 'merchandise_question', requestKind: 'non_image' };
  await classifyChatImageIntent('Can this shirt be supplied without a name?', { character, jevDecision: mistaken, conversationContext: { latestImageKind: 'character', recentConversation: [{ role: 'assistant', kind: 'mascot_greeting_image', text: 'Welcome!' }] } });
  const greetingPayload = JSON.parse(lastBody.messages[1].content);
  assert.equal(greetingPayload.characterImageFollowup, null, 'automatic greeting cannot establish followup permission'); assert.deepEqual(greetingPayload.recentConversation, []); checks++;
  await classifyChatImageIntent('Can this shirt be supplied without a name?', { character, jevDecision: mistaken, conversationContext: { latestImageKind: 'character', recentConversation: [{ role: 'assistant', kind: 'mascot_greeting_image', text: 'Welcome!' }, ...Array.from({ length: 6 }, () => ({ role: 'user', kind: 'text', text: 'Hello' }))] } });
  assert.equal(JSON.parse(lastBody.messages[1].content).characterImageFollowup, null, 'an older automatic greeting cannot establish followup permission'); checks++;
  await classifyChatImageIntent('Can this shirt be supplied without a name?', { character, jevDecision: mistaken, conversationContext: { latestImageKind: 'character', recentConversation: [{ role: 'assistant', kind: 'mascot_greeting_image', text: 'Welcome!' }, { role: 'user', kind: 'text', text: 'Send your selfie' }, { role: 'assistant', kind: 'image_generation', text: 'Here is my photo' }] } });
  const requestedPayload = JSON.parse(lastBody.messages[1].content);
  assert.equal(requestedPayload.latestImageKind, 'character'); assert.equal(requestedPayload.recentConversation.length, 2); checks++;
  fail = true;
  const unavailable = await evaluateChatImageRequest(null, { character, userText: 'Show your photo', jevDecision: mistaken, conversationContext: {} });
  assert.equal(unavailable.hasIntent, false, 'failed verifier cannot restore deterministic positive'); checks++;
  fail = false;
  for (const text of ['Create multiple photos of you', 'Create multiple personal photos of you', 'Create two beautiful photos of you', 'Create two unusually expressive photos of you', '拍多张你的照片', 'Create a poster of you']) {
    const restrictive = await evaluateChatImageRequest(null, { character, userText: text, conversationContext: {},
      imageDecision: { hasIntent: true, allowed: true, intentType: 'explicit_generation', explicitGeneration: true,
        actionEvidence: text, actorEvidence: 'you', conditions: { wants_clothing: false, wants_no_clothing: false } } });
    assert.equal(restrictive.trigger.allowed, false, 'semantic approval cannot override an unsupported current visual-output task'); checks++;
  }
  const narrow = await evaluateChatImageRequest(null, { character, userText: 'Create multiple photos of you', conversationContext: {},
    imageDecision: { hasIntent: true, allowed: true, intentType: 'explicit_generation', explicitGeneration: true,
      requestEvidence: 'photos of you', actionEvidence: 'photos of you', actorEvidence: 'you' } });
  assert.equal(narrow.trigger.allowed, false, 'narrow exact evidence cannot erase an overlapping batch qualifier'); checks++;
  for (const text of ['Create two reports; send a photo of you', 'Create two reports and send a photo of you']) {
    const separatePhoto = await evaluateChatImageRequest(null, { character, userText: text, conversationContext: {},
      imageDecision: { hasIntent: true, allowed: true, intentType: 'library_photo', requestEvidence: 'send a photo of you', actionEvidence: 'send a photo of you', actorEvidence: 'you' } });
    assert.equal(separatePhoto.trigger.allowed, false, 'retain the existing conservative batch restriction for mixed image tasks'); checks++;
  }
  const separateChinese = await evaluateChatImageRequest(null, { character, userText: '生成多张发票，再给我你的照片', conversationContext: {},
    imageDecision: { hasIntent: true, allowed: true, intentType: 'library_photo', requestEvidence: '给我你的照片', actionEvidence: '给我你的照片', actorEvidence: '你' } });
  assert.equal(separateChinese.trigger.allowed, false, 'retain the existing conservative batch restriction for mixed image tasks'); checks++;
  const inconsistentScope = await evaluateChatImageRequest(null, { character, userText: 'Create two reports and send a photo of you', conversationContext: {},
    imageDecision: { hasIntent: true, allowed: true, intentType: 'library_photo', requestScope: 'image_only', requestEvidence: 'send a photo of you', actionEvidence: 'send a photo of you', actorEvidence: 'you' } });
  assert.equal(inconsistentScope.trigger.allowed, false, 'an image-only assertion cannot be used to discard a separate task'); checks++;
  const mixedDomain = await evaluateChatImageRequest(null, { character, userText: 'Can I buy the product photo poster? Send your selfie.', conversationContext: {},
    commerceIntent: { commerceRoute: 'product_question' }, imageDecision: { hasIntent: true, allowed: true, intentType: 'library_photo', explicitGeneration: false,
      requestEvidence: 'Send your selfie', actionEvidence: 'Send your selfie', actorEvidence: 'your', conditions: { wants_clothing: false, wants_no_clothing: false } } });
  assert.equal(mixedDomain.trigger.allowed, false, 'retain the pre-existing product-artwork restriction for mixed image tasks'); checks++;
  response = { hasIntent: false, allowed: false, confidence: 1, intentType: 'none', communicativeAction: 'other', requestKind: 'non_image' };
  const inspectOnly = await evaluateChatImageRequest(null, { character, userText: 'What is this picture?', jevDecision: nonImage, conversationContext: {} });
  assert.equal(inspectOnly.hasIntent, false, 'semantic confirmation keeps actual inspection free of image actions'); checks++;
  for (const text of ['Generate a white background product photo', '创建一张商品主图']) {
    response = { hasIntent: true, allowed: false, confidence: .99, intentType: 'disallowed', communicativeAction: 'request_visual_output',
      requestKind: 'unsupported_image', imageSubject: 'product', requestEvidence: text };
    const unsupported = await evaluateChatImageRequest(null, { character, userText: text, jevDecision: mistaken, conversationContext: {} });
    assert.equal(unsupported.trigger.hasIntent, true); assert.equal(unsupported.trigger.allowed, false);
    assert.equal(unsupported.trigger.reason, 'disallowed_request'); checks++;
  }
  const before = calls;
  response = { intentType: 'try_on', clothingTarget: 'generic', requestEvidence: 'Try this shirt on', actorEvidence: '' };
  const other = await classifyChatImageIntent('Try this shirt on', { character: { id: 'companion' }, jevDecision: mistaken });
  assert.equal(other.hasIntent, true); assert.equal(calls, before + 1, 'non-commerce image requests also select a type'); checks++;
  const ordinary = 'El envío estándar tarda el plazo indicado en la política de esta tienda.';
  assert.equal(normalizeGuestReplyText({ text: ordinary, imageTaskCreated: true, languageCode: 'es', userText: 'Manda tu foto y dime cuándo llega.' }), ordinary, 'image status must not overwrite the other answer'); checks++;
  for (const languageCode of ['es', 'hu', 'zh']) {
    assert.equal(normalizeGuestReplyText({ text: '', imageTaskCreated: true, imageDeliveryType: 'mascot_library_image', languageCode }), getChatImageStatusCopy({ language: languageCode, status: 'ready' })); checks++;
  }
  for (const options of [
    { productRequested: true, productSearchIntent: { searchState: 'source_error', sourceErrorCode: 'market_currency_mismatch' }, userText: 'Send your selfie and show the price.' },
    { productRequested: true, productSearchIntent: { searchState: 'ready' }, userText: 'Send your selfie and show an Arsenal shirt.' },
    { productRequested: true, productSearchIntent: { searchState: 'needs_clarification' }, userText: 'Send your selfie and show a shirt.' },
    { productRequested: true, skipProductClarification: true, productSearchIntent: { commerceRoute: 'product_question', needsLiveProductData: true, customerServiceKnowledgeRequest: true, searchState: 'ready' }, userText: 'Can this shirt be supplied without a name?' },
    { productRequested: false, productSearchIntent: { commerceRoute: 'product_question', needsLiveProductData: true, unresolvedProductReference: true }, userText: 'Can this shirt from another shop be supplied without a name?' },
    { userText: 'Here is my tracking number 1Z9999999999999999. Send your selfie.' },
    { userText: 'Send your selfie and a discount code.' },
  ]) {
    const input = { text: 'This item is in stock for $20. Your order arrives tomorrow.', languageCode: 'en', ...options };
    const guarded = normalizeGuestReplyText(input);
    assert.notEqual(guarded, input.text, 'fixture must engage an existing guard');
    assert.equal(normalizeGuestReplyText({ ...input, imageTaskCreated: true }), guarded, 'image delivery must preserve product/order/promotion guards'); checks++;
  }
  assert.equal(normalizeGuestReplyText({ text: ordinary, productRequested: true, skipProductClarification: true, productSearchIntent: { commerceRoute: 'store_policy', needsLiveProductData: false, customerServiceKnowledgeRequest: true }, languageCode: 'es', userText: 'How long is standard delivery?' }), ordinary, 'general policy answers remain available without a product'); checks++;
  console.log(`image commerce boundary self-check passed: ${checks} cases; synthetic image type choices, no DB writes or images generated`);
} finally { /* No external calls or database writes. */ }
