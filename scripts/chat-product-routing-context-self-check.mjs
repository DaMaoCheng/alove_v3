import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { classifyJevIntent, buildQuestions } = await import('../server/jev-intent-service.js');
const configOverride = { enabled: true, apiKey: 'isolated-check', baseUrl: 'https://jev.invalid', model: 'isolated', timeoutMs: 1000 };
let bodies = [];
const fetchImpl = async (_url, request) => {
  bodies.push(JSON.parse(request.body));
  const answers = Object.fromEntries(Object.entries(buildQuestions()).map(([key, q]) => [key, { choice: Object.hasOwn(q.criteria, 'no') ? 'no' : Object.keys(q.criteria)[0], confidence: .3 }]));
  answers.route = { choice: 'product_request', confidence: .95 }; answers.product_action = { choice: 'yes', confidence: .3 };
  return new Response(JSON.stringify({ answers }));
};
const productContext = { status: 'active', needsClarification: false, targetEvidence: 'Busco una camiseta del Real Madrid sin número',
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
const unresolvedRows = [{ ...last, productCandidateState: { ...state, proposal: null,
  unresolvedRequirements: [{ field: 'requestedColor', evidence: 'an exact user shade' }] } }];
assert.equal(normalizeChatProductRoutingContext(state).needsClarification, false,
  'The existing public normalizer accepts a stored active state with no derived clarification property');
assert.equal(normalizeChatProductRoutingContext(unresolvedRows[0].productCandidateState).needsClarification, true,
  'A stored active state derives clarification only from its actual unresolved fields');
const waitingContext = buildChatProductRoutingContext(unresolvedRows, location);
assert.equal(waitingContext.status, 'active', 'Actual owned task lifecycle must survive the finite main-JEV projection');
assert.equal(waitingContext.needsClarification, true, 'Only actual unresolved USER requirements establish pending clarification');
assert.equal(waitingContext.displayedCandidate, undefined);
assert.equal(normalizeChatProductRoutingContext({ ...waitingContext, status: 'cleared' }), null);
assert.equal(normalizeChatProductRoutingContext({ ...waitingContext, needsClarification: false }), null);
assert.equal(normalizeChatProductRoutingContext({ ...productContext, needsClarification: true }), null);
assert.equal(normalizeChatProductRoutingContext({ ...waitingContext, status: undefined }), null);
assert.equal(buildChatProductRoutingContext(unresolvedRows, { ...location, siteId: 'foreign' }), null);
assert.equal(buildChatProductRoutingContext([{ ...unresolvedRows[0], senderType: 'user' }], location), null);
assert.equal(buildChatProductRoutingContext([{ ...unresolvedRows[0], productCandidateState: {
  ...unresolvedRows[0].productCandidateState, status: 'cleared' } }], location), null);
const { status: unusedStatus, needsClarification: unusedClarification, ...legacyContext } = productContext;
assert.deepEqual(normalizeChatProductRoutingContext(legacyContext), legacyContext, 'Existing bounded contexts without lifecycle remain compatible');
let waitingForward;
const waitingTurn = await prepareChatIntentTurn({ execute: async () => [[]] }, { ...location, session: { id: 'waiting-session' },
  recentMessages: unresolvedRows, character: { id: location.characterId, category_id: 'mascot' },
  userText: 'a follow-up specification', userDisplayOrder: 100, commerceForImageOnly: true,
  classify: async options => { waitingForward = options; return { ok: true, confident: true, primaryIntent: 'daily_chat', productIntent: 'none' }; },
  classifyImage: async () => ({ hasIntent: false, allowed: false }) });
assert.deepEqual(waitingForward.conversationContext.productContext, waitingContext);
assert.notEqual(waitingForward.conversationContext.hasRecentProductImage, true, 'A waiting USER task is not a catalogue image source');
assert.equal(waitingTurn.decision.primaryIntent, 'daily_chat', 'Projected pending clarification never overrides this turn main route');
await classifyJevIntent({ userText: 'a follow-up specification', conversationContext: waitingForward.conversationContext,
  configOverride, fetchImpl, forceRefresh: true });
assert.deepEqual(bodies.at(-1).state.conversation_context.productContext, waitingContext,
  'The actual orchestration and main API body must keep the same lifecycle projection without a route override');
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
  commerceForImageOnly: true, classify: async options => { forwarded = options; return { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 }; },
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

// A pending USER multi-target request exists before any catalogue candidate.
const pendingScope = { ...scope, status: 'pending', selectedIndex: null };
const pendingRows = [{ senderType: 'character', productRequestState: pendingScope }];
const pendingContext = buildChatProductRoutingContext(pendingRows, location);
assert(pendingContext?.requestScope, 'Main JEV needs the actual owned pending USER request set before any candidate exists');
assert.equal(pendingContext.requestScope.status, 'pending');
assert.equal(pendingContext.requestScope.selectedIndex, null);
assert.deepEqual(pendingContext.requestScope.items, items.map(({evidence, sharedEvidence}) => ({evidence, sharedEvidence})));
assert.equal(pendingContext.displayedCandidate, undefined);
assert.equal(pendingContext.requirements, undefined, 'A pending set is not a selected product requirement');
assert.equal(buildChatProductRoutingContext(pendingRows, {...location, siteId:'foreign'}), null);
assert.equal(buildChatProductRoutingContext([{...pendingRows[0],senderType:'user'}], location), null);
assert.equal(buildChatProductRoutingContext([{...pendingRows[0],productRequestState:{...pendingScope,status:'cleared',items:[],clarificationCount:0}}], location), null);
assert.equal(normalizeChatProductRoutingContext({requestScope:{status:'pending',items:[{evidence:'only one',sharedEvidence:''}],selectedIndex:null}}), null);
let selectedForward;
await prepareChatIntentTurn(db, {...location, session:{id:'pending-session'}, character:{id:location.characterId,category_id:'mascot'},
 userText:'the first club',userDisplayOrder:100,recentMessages:pendingRows, commerceForImageOnly:true,
 classify:async options=>{selectedForward=options;return{ok:true,primaryIntent:'daily_chat',productIntent:'none'};},
 classifyImage:async()=>({hasIntent:false,allowed:false})});
assert.deepEqual(selectedForward.conversationContext.productContext, pendingContext);
assert.notEqual(selectedForward.conversationContext.hasRecentProductImage, true, 'Pending USER targets do not prove an image exists');
const routeOptions=buildQuestions({}, {productContext:pendingContext});
assert(routeOptions.route.criteria.product_request.includes('requestScope'), 'Main route must distinguish pending task selection from an isolated noun');
assert(routeOptions.product_action.instructions.includes('requestScope'));
for (const route of ['daily_chat','new_image','order_lookup']) {
 const out=(await import('../server/jev-intent-service.js')).normalizeJevResponse({answers:{route:{choice:route,confidence:.1},product_action:{choice:'yes',confidence:.1}}},{},{productContext:pendingContext});
 assert.equal(out.productIntent,'none','Pending context never overrides an unrelated main route');
}
console.log('Pending owned USER scope reaches main JEV without catalogue/image evidence or an automatic route override');
