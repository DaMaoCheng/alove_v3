import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
process.env.VENICE_API_KEY = 'test';
process.env.TYPESAFE_API_KEY = '';
process.env.VENICE_BASE_URL = 'https://venice.example.test/v1';
const { resolveTtmallOrderAction, classifyOrderLookup } = await import('../server/chat-order-intent-service.js');
const dependencies = { resolveSiteAccess: async () => ({ mode: 'ttmall', source: {} }), classify: async () => true };
for (const text of ['我的订单号是 68277D8DF6C01449', '我的订单还有多久到？', 'Where is my order?', 'I placed my order yesterday, when will it arrive?', '¿Dónde está mi pedido?', 'Wo ist meine Bestellung?']) {
  assert.ok(await resolveTtmallOrderAction({ text, siteSlug: 'cf', dependencies }), text);
}
// An enabled site's semantic classifier, rather than a vocabulary gate, decides intent.
for (const text of [
  'Hola me decís el número de envío',
  '¿Puedes pasarme el nro de envvio de mi compra?',
  'Szabad megtudnom, merre jár a már megvett csomagom?',
  '既に買った品が今どこにあるか調べて',
  'I need the shipping policy, and also tell me where my existing order is.',
]) {
  let semanticCalls = 0;
  const result = await resolveTtmallOrderAction({ text, siteSlug: 'cf', dependencies: {
    ...dependencies, classify: async (candidate) => { assert.equal(candidate, text); semanticCalls++; return true; },
  } });
  assert.ok(result, `semantic lookup must not be blocked by surface words: ${text}`);
  assert.equal(semanticCalls, 1);
  assert.equal(result.status, 'binding_required', 'intent recognition never grants access to order data');
}
for (const text of ['If I order today, when will it arrive?', 'Can you help me with my purchase?', '123456789012345', '如果我现在下单，多久到？', 'What is your shipping policy?', 'No consultes mi pedido; solo dime la política de envíos.', '배송 정책만 알려줘', 'something about shipping, maybe']) {
  let semanticCalls = 0;
  assert.equal(await resolveTtmallOrderAction({ text, siteSlug: 'cf', dependencies: { ...dependencies,
    classify: async () => { semanticCalls++; return false; },
  } }), null, text);
  assert.equal(semanticCalls, 1, 'negative meaning is decided semantically without granting an action');
}
for (const input of [{ text: '', siteSlug: 'cf' }, { text: '查订单', siteSlug: '' }]) {
  assert.equal(await resolveTtmallOrderAction({ ...input, dependencies: {
    resolveSiteAccess: async () => { throw new Error('empty input must not resolve access'); },
    classify: async () => { throw new Error('empty input must not classify'); },
  } }), null);
}
let standaloneCalls = 0;
const standalone = await resolveTtmallOrderAction({ text: '68277D8DF6C01449', siteSlug: 'cf', dependencies: {
  ...dependencies, classify: async () => { standaloneCalls++; return false; },
} });
assert.equal(standalone.orderNumber, '68277D8DF6C01449');
assert.equal(standalone.status, 'binding_required');
assert.equal(standaloneCalls, 0, 'existing complete-order-reference shortcut is preserved');
assert.equal(await resolveTtmallOrderAction({ text: 'Where is my order?', siteSlug: 'fkk', dependencies: { ...dependencies, resolveSiteAccess: async () => ({ mode: 'not_ttmall' }), classify: async () => { throw new Error('disabled TTMall must not classify'); } } }), null);
const original = globalThis.fetch;
try {
  let unexpectedBackupCalls = 0;
  globalThis.fetch = async () => { unexpectedBackupCalls++; throw new Error('confident Jev decisions must not invoke a backup'); };
  let jevCalls = 0;
  const jevLookup = await classifyOrderLookup('Hola me decís el número de envío', { classifyJev: async (input) => {
    jevCalls++;
    assert.equal(input.userText, 'Hola me decís el número de envío');
    assert.equal(input.capabilities.canLookupOrder, true);
    return { ok: true, confident: true, orderIntent: 'lookup', unsupported: false };
  } });
  assert.equal(jevLookup, true);
  assert.equal(jevCalls, 1, 'reuse the caller-provided Jev entry without introducing a new classifier');
  for (const decision of [
    { ok: true, confident: true, orderIntent: 'none', unsupported: false },
    { ok: true, confident: true, orderIntent: 'lookup', unsupported: true },
  ]) {
    assert.equal(await classifyOrderLookup('No consultes mi pedido', { classifyJev: async () => decision }), false);
  }
  assert.equal(unexpectedBackupCalls, 0, 'a confident semantic refusal is terminal, not another vote');
  const context = { recentConversation: [{ role: 'user', kind: 'text', text: 'Argentina jersey fan and player edition' }] };
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.deepEqual(payload.conversationContext.recentConversation, context.recentConversation, 'fallback must retain the available product context');
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"orderLookup":true}' } }] }) };
  };
  assert.equal(await classifyOrderLookup('pregunto por la que tiene el número adelante y atrás', { conversationContext: context,
    classifyJev: async (options) => { assert.deepEqual(options.conversationContext.recentConversation, context.recentConversation); return { ok: true, confident: false, orderIntent: 'none' }; } }), false,
    'a bare backup vote cannot grant an order action without grounded existing-order evidence');
  globalThis.fetch = async (_url, options) => {
    const context = JSON.parse(JSON.parse(options.body).messages[1].content).conversationContext;
    assert.equal(context.secret, undefined);
    assert.equal(context.recentConversation.length, 6);
    assert(context.recentConversation.every(row => row.text.length === 600 && row.secret === undefined));
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"orderLookup":false}' } }] }) };
  };
  assert.equal(await classifyOrderLookup('Can I see the printed number?', { conversationContext: { secret: 'excluded fixture', recentConversation: Array.from({ length: 20 }, () => ({ role: 'user', text: 'x'.repeat(2000), secret: 'excluded fixture' })) },
    classifyJev: async () => ({ ok: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 }) }), false, 'bounded context cannot forward arbitrary caller fields');
  let backupCalls = 0;
  globalThis.fetch = async (url, options) => {
    backupCalls++;
    assert.equal(url, 'https://venice.example.test/v1/chat/completions');
    assert.equal(JSON.parse(options.body).response_format.type, 'json_object');
    return { ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"orderLookup":true,"referenceKind":"existing_order","requestEvidence":"my order"}\n```' } }] }) };
  };
  assert.equal(await classifyOrderLookup('Where is my order?', { classifyJev: async () => ({ ok: false, confident: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 }) }), true);
  assert.equal(backupCalls, 1, 'unavailable Jev reaches the existing bounded semantic backup once');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"orderLookup":false}' } }] }) });
  assert.equal(await classifyOrderLookup('maybe shipping?', { classifyJev: async () => ({ ok: true, confident: false, orderIntent: 'lookup' }) }), false,
    'an uncertain Jev lookup is not treated as permission');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"orderLookup":"yes"}' } }] }) });
  assert.equal(await classifyOrderLookup('maybe shipping?', { classifyJev: async () => ({ ok: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 }) }), false,
    'a malformed backup verdict cannot grant an action');
  for (const response of [
    { orderLookup: true, referenceKind: 'existing_order', requestEvidence: 'invented order' },
    { orderLookup: true, referenceKind: 'garment_number', requestEvidence: 'my order' },
    { orderLookup: true, referenceKind: 'existing_order', requestEvidence: '' },
  ]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(response) } }] }) });
    assert.equal(await classifyOrderLookup('Where is my order?', { classifyJev: async () => ({ ok: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 }) }), false, 'invalid evidence cannot reserve a real action');
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ orderLookup: true, referenceKind: 'tracking', requestEvidence: 'track my package' }) } }] }) });
  assert.equal(await classifyOrderLookup('Explain the return policy and track my package', { classifyJev: async () => ({ ok: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 }) }), true,
    'a separate genuine order lookup survives an independent policy question');
  globalThis.fetch = async () => { throw new Error('Venice unavailable'); };
  assert.equal(await classifyOrderLookup('Where is my order?', { classifyJev: async () => ({ ok: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 }) }), false);
} finally { globalThis.fetch = original; }
const { getChatOrderCopy, getChatOrderEntryCopy } = await import('../shared/chat-order-copy.js');
const { SUPPORTED_CHARACTER_LANGUAGES } = await import('../shared/language-library.js');
const memberEnglish = getChatOrderEntryCopy('en', 'binding_required');
assert.equal(memberEnglish, 'Use the order entry to view your orders. Link your store account only if prompted.');
assert.match(getChatOrderEntryCopy('en', 'login_required'), /^Please sign in first\./);
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const member = getChatOrderEntryCopy(language.code, 'binding_required');
  const guest = getChatOrderEntryCopy(language.code, 'login_required');
  assert.ok(member && guest && guest.includes(member) && guest.length > member.length, `${language.code} has a distinct sign-in instruction`);
  assert.equal(getChatOrderEntryCopy(language.label, 'binding_required'), member, `${language.code} accepts its canonical language label`);
  if (language.code !== 'en') assert.notEqual(member, memberEnglish, `${language.code} has localized entry copy, not English fallback`);
  assert.equal(getChatOrderEntryCopy(language.code, ''), '', 'unknown state does not invent an available entry');
}
assert.equal(getChatOrderEntryCopy('es-MX', 'binding_required'), getChatOrderEntryCopy('Spanish', 'binding_required'));
assert.equal(getChatOrderEntryCopy('en_US', 'login_required'), getChatOrderEntryCopy('English', 'login_required'));
assert.equal(getChatOrderEntryCopy('xx-unknown', 'binding_required'), memberEnglish);
assert.deepEqual(getChatOrderCopy('English', false), { text: 'Link your store account to view your orders.', label: 'View my orders' }, 'existing legacy consumer keeps its prior behavior');
assert.deepEqual(getChatOrderCopy('Spanish', true), { text: 'Inicia sesión y vincula tu cuenta de la tienda para consultar tus pedidos.', label: 'Ver mis pedidos' });
console.log(`chat order intent routing self-check: PASS (semantic routing and ${SUPPORTED_CHARACTER_LANGUAGES.length}-language entry copy)`);
