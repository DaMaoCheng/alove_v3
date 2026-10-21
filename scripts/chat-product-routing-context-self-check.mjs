import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { classifyJevIntent } = await import('../server/jev-intent-service.js');
const configOverride = { enabled: true, apiKey: 'isolated-check', baseUrl: 'https://jev.invalid', model: 'isolated', timeoutMs: 1000 };
let bodies = [];
const fetchImpl = async (_url, request) => {
  bodies.push(JSON.parse(request.body));
  return new Response(JSON.stringify({ answers: { route: { choice: 'product_request', confidence: .95 }, product_action: { noul: .95 } } }));
};
const productContext = { targetEvidence: 'Busco una camiseta del Real Madrid sin número',
  requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt', requestedPrinting: 'none' },
  displayedCandidate: { name: 'Madrid Fan Jersey', question: '¿Es esta la camiseta que buscas?' } };
await classifyJevIntent({ userText: 'Sí, esa', conversationContext: { productContext }, configOverride, fetchImpl, forceRefresh: true });
assert.deepEqual(bodies[0].state.conversation_context.productContext, productContext,
  'JEV must receive the bounded question and target without rewriting the current user message');
assert.equal(bodies[0].state.message, 'Sí, esa');
assert.equal(bodies[0].state.conversation_context.hasRecentProductContext, true);

const { buildChatProductRoutingContext, normalizeChatProductRoutingContext } = await import('../server/chat-product-routing-context-service.js');
const { createChatIntentTurn, prepareChatIntentTurn } = await import('../server/chat-intent-turn-service.js');
const location = { siteId: 'site-one', characterId: 'character-one' };
const state = { version: 1, status: 'active', ...location, owner: 'single',
  targetEvidence: productContext.targetEvidence, requirements: productContext.requirements,
  proposal: { status: 'displayed', candidateId: 'product-one', name: productContext.displayedCandidate.name, reply: productContext.displayedCandidate.question } };
const card = { senderType: 'character', characterId: location.characterId, contentType: 'product',
  product: { productId: 'product-one', name: state.proposal.name, siteId: location.siteId, matchStatus: 'candidate',
    priceNow: '$0', stock: 'available', attributeEvidence: { secret: true } } };
const last = { senderType: 'character', characterId: location.characterId, productCandidateState: state };
const rows = [card, last];
assert.deepEqual(buildChatProductRoutingContext(rows, location), productContext);
assert.equal(buildChatProductRoutingContext([card, { ...last, productCandidateState: { ...state, status: 'cleared' } }], location), null);
assert.equal(buildChatProductRoutingContext([card, { ...last, productCandidateState: { broken: true } }], location), null);
assert.equal(buildChatProductRoutingContext([card, { ...last, senderType: 'user' }], location), null);
assert.equal(buildChatProductRoutingContext(rows, { ...location, siteId: 'site-other' }), null);
assert.equal(buildChatProductRoutingContext(rows, { ...location, characterId: 'character-other' }), null);
assert.equal(buildChatProductRoutingContext([{ ...card, product: { ...card.product, siteId: 'site-other' } }, last], location).displayedCandidate, undefined);
assert.equal(buildChatProductRoutingContext([last], location).displayedCandidate, undefined);
assert.equal(buildChatProductRoutingContext([card, { ...last, productCandidateState: { ...state, proposal: null } }], location).displayedCandidate, undefined);
const items = [{ evidence: 'Madrid shirt', sharedEvidence: '', text: 'Madrid shirt' }, { evidence: 'Barcelona shirt', sharedEvidence: '', text: 'Barcelona shirt' }];
const scope = { version: 1, status: 'selected', ...location, selectedIndex: 0, clarificationCount: 0, items };
const selectedState = { ...state, owner: 'selected', selectedIndex: 0,
  ownerEvidence: createHash('sha256').update(JSON.stringify(items.map(item => [item.evidence, item.sharedEvidence]))).digest('hex') };
assert.deepEqual(buildChatProductRoutingContext([card, { ...last, productCandidateState: selectedState, productRequestState: scope }], location), productContext);
assert.equal(buildChatProductRoutingContext([card, { ...last, productCandidateState: selectedState, productRequestState: { ...scope, selectedIndex: 1 } }], location), null);
assert.equal(buildChatProductRoutingContext([card, { ...last, productCandidateState: selectedState }], location), null);
assert.equal(normalizeChatProductRoutingContext({ ...productContext, targetEvidence: 'x'.repeat(1201) }), null);
const finite = normalizeChatProductRoutingContext({ ...productContext, secret: 'should-not-leak', requirements: { ...productContext.requirements,
  stock: true, requestedFeatures: ['short_sleeve', 'invented'], requestedKeywords: ['do-not-forward'], requestedSizes: ['M'] } });
assert.deepEqual(finite.requirements.requestedFeatures, ['short_sleeve']);
assert.deepEqual(finite.requirements.requestedSizes, ['M']);
for (const forbidden of ['secret', 'stock', 'priceNow', 'attributeEvidence', 'requestedKeywords', 'site-one', '_productCandidateState']) assert.equal(JSON.stringify(finite).includes(forbidden), false);

let calls = 0;
const turn = createChatIntentTurn({ classify: async () => { calls++; return { ok: true }; } });
const a = { userText: 'Sí', conversationContext: { productContext } };
await turn.classify(a);
await turn.classify(structuredClone(a));
assert.equal(calls, 1);
await turn.classify({ ...a, conversationContext: { productContext: { ...productContext, displayedCandidate: { name: 'Different catalogue target', question: '¿Quieres esta otra?' } } } });
assert.equal(calls, 2, 'different target/question must not reuse a same-text request-local classification');
const before = bodies.length;
await classifyJevIntent({ userText: 'cache proof', conversationContext: { productContext }, configOverride, fetchImpl });
await classifyJevIntent({ userText: 'cache proof', conversationContext: { productContext }, configOverride, fetchImpl });
await classifyJevIntent({ userText: 'cache proof', conversationContext: { productContext: { ...productContext, displayedCandidate: { ...productContext.displayedCandidate, name: 'Another target' } } }, configOverride, fetchImpl });
assert.equal(bodies.length - before, 2, 'global cache must include exactly the normalized product context');

let commerceCalls = 0, forwarded = null;
const db = { execute: async () => [[]] };
const prepared = await prepareChatIntentTurn(db, { ...location, recentMessages: rows, session: { id: 'session-one' },
  character: { id: location.characterId, category_id: 'mascot' }, userText: 'Sí, esa', userDisplayOrder: 100,
  commerceForImageOnly: true, classify: async options => { forwarded = options; return { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: .95 }; },
  classifyImage: async () => ({ hasIntent: false, allowed: false }), classifyCommerce: async () => { commerceCalls++; } });
assert.deepEqual(forwarded.conversationContext.productContext, productContext);
assert.equal(forwarded.conversationContext.hasRecentProductContext, true);
assert.equal(commerceCalls, 0, 'initial ordinary text must still avoid commerce classification');
assert.strictEqual(prepared.recentMessages, rows);
let historyReads = 0, imageReads = 0;
await prepareChatIntentTurn({ execute: async sql => {
  if (sql.includes('SELECT id, character_id, sender_type')) {
    historyReads++;
    return [[{ id: 'card-row', character_id: location.characterId, sender_type: 'character', content_type: 'product',
      text_content: state.proposal.name, product_payload_json: card.product, display_order: 10 },
    { id: 'state-row', character_id: location.characterId, sender_type: 'character', content_type: 'text',
      text_content: state.proposal.reply, product_payload_json: { _productCandidateState: state }, display_order: 20 }]];
  }
  imageReads++;
  return [[]];
} }, { ...location, session: { id: 'session-one' }, character: { id: location.characterId, category_id: 'mascot' },
  userText: 'La quiero en manga corta', userDisplayOrder: 100,
  classify: async options => { assert.deepEqual(options.conversationContext.productContext, productContext); return { ok: false }; },
  classifyCommerce: async () => ({ confident: true, confidence: .95, route: 'chat',
    replyBoundary: { salesAllowed: false, contactAllowed: false }, productRequirement: { action: 'none' } }) });
assert.equal(historyReads, 1, 'JEV and commerce must reuse one same-order history read');
assert.equal(imageReads, 1);
console.log('chat product routing context self-check passed: actual displayed question, finite target, site/owner/cleared boundaries, both caches, unchanged current message; no network/DB/model calls');
