// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from 'node:assert/strict';
Object.assign(process.env, { AIOVE_PROVIDER_LOG_WRITE_ENABLED: 'false', VENICE_API_KEY: 'fixture', VENICE_MODEL: 'candidate-original-primary',
  OPENAI_API_KEY: 'fixture', OPENAI_FALLBACK_API_KEY: 'fixture', OPENAI_FALLBACK_MODEL: 'candidate-tertiary' });
const { classifyCommerceIntentFallback: classifyCommerceIntent } = await import('../server/product-intent-classifier-service.js');
const { COMMERCE_INTENT_RESPONSE_FORMAT, validateCommerceIntentShape } = await import('../server/commerce-intent-response-format.js');
const payload = { route: 'product_search', topic: 'other', needsLiveProductData: true, searchQuery: 'Real Madrid away shirt 2026/27',
  referencedProductId: '', knowledgeScope: 'business', knowledgeQuery: '', answerRequired: true,
  businessInquiry: null, humanHandoff: null, promotionInquiry: null, checkoutIssue: null,
  replyBoundary: { salesAllowed: true, contactAllowed: true },
  commerceConstraints: { edition: null, team: { value: 'Real Madrid', role: 'product_target', evidence: 'Real Madrid' } },
  productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
  productRequirement: { action: 'new', evidence: 'Real Madrid away shirt 2026/27', priorTargetEvidence: '', updates: [], suspectedTerm: null },
  candidateResponse: { action: 'none', evidence: '', candidateId: '' }, confidence: .95 };
const userText = 'Real Madrid away shirt 2026/27';
const jevDecision = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 };
const config = { id: 'venice', apiKey: 'fixture', baseUrl: 'https://fixture.example.test', model: 'fixture', apiMode: 'chat_completions' };
let body;
const invoke = (output, primary = jevDecision) => classifyCommerceIntent(userText, { config, jevDecision: primary, fetchImpl: async (_url, options) => {
  body = JSON.parse(options.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
} });
const result = await invoke(payload);
assert.equal(result.confident, true);
assert.equal(result.candidateDecisionRequired, true);
assert.deepEqual(body.response_format, COMMERCE_INTENT_RESPONSE_FORMAT);
assert.ok(body.messages[0].content.includes('FINAL user message'), 'Current-turn structure is explicit without duplicating the native schema');
assert.equal(validateCommerceIntentShape(payload), true);
assert.match(body.messages[0].content, /personal preference or identity question/,
  'commerce classification must distinguish preference answers from purchase assent');
assert.match(body.messages[0].content, /explicitly asks for browsing, recommendations or product selection/,
  'the preference boundary must retain shopping follow-ups and requests');
for (const bad of [{ ...payload, confidence: 2 }, { ...payload, surprise: true },
  { ...payload, productRequest: { ...payload.productRequest, items: [{ evidence: 'first', sharedEvidence: '' }] } },
  { ...payload, productRequirement: { ...payload.productRequirement, updates: [{ field: 'requestedProductType', value: 'jersey', evidence: 'shirt' }] } },
  { ...payload, productRequirement: { ...payload.productRequirement, priorTargetEvidence: undefined } }]) {
  assert.equal(validateCommerceIntentShape(bad), false);
  const rejected = await invoke(bad);
  assert.equal(rejected.confident, false);
  assert.equal(rejected.commerceClassificationFailure, 'missing_fields');
}
await invoke(payload, { ok: true, confident: true, primaryIntent: 'chat', productIntent: 'none' });
assert.deepEqual(body.response_format, COMMERCE_INTENT_RESPONSE_FORMAT, 'Other classification tasks keep their original native output protocol');
const location = { siteId: 'site-one', characterId: 'character-one' };
const { applyProductCandidateState } = await import('../server/product-candidate-state-service.js');
const target = applyProductCandidateState({ commerceRoute: 'product_search', shouldLoadProductContext: true,
  requestedTeam: 'Real Madrid', requestedProductType: 'shirt', requestedSeason: '2026/27', replyBoundary: { salesAllowed: true } },
  { confident: true, productRequirement: { action: 'new', evidence: userText, updates: [], suspectedTerm: null } }, { ...location, userText });
const history = [{ senderType: 'user', text: 'I want long sleeves' },
  { senderType: 'character', text: 'Sign in for benefits', productCandidateState: target.productCandidateState }];
await classifyCommerceIntent(userText, { ...location, recentMessages: history, config, jevDecision,
  fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] })); } });
const projected = JSON.parse(body.messages.find(message => message.role === 'user').content);
assert.deepEqual(projected.recentConversation, [{ role: 'user', text: 'I want long sleeves' }], 'Candidate projection keeps USER boundaries/context while omitting unrelated assistant claims');
assert.equal(projected.priorProductCandidate.requirements.requestedTeam, 'Real Madrid');
assert.equal(projected.contextOnly, true);
assert.equal(projected.latestMessage, undefined);
assert.deepEqual(body.messages.at(-1), { role: 'user', content: userText }, 'Actual current turn is separate and final');
console.log('Candidate JSON self-check passed: native full strict contract, canonical typed validation, safe malformed output, unrelated tasks unchanged; no network/DB');

let defaultBody;
const defaultResult = await classifyCommerceIntent(userText, { jevDecision, fetchImpl: async (_url, options) => {
  defaultBody = JSON.parse(options.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }));
} });
assert.equal(defaultResult.confident, true);
assert.equal(defaultBody.model, 'candidate-original-primary', 'Default candidate interpretation reuses the existing configured primary model');
assert.deepEqual(defaultBody.response_format, { type: 'json_object' }, 'Complex candidate grammar is supplied as a textual contract, not native constrained grammar');
assert.ok(defaultBody.messages[0].content.includes(JSON.stringify(COMMERCE_INTENT_RESPONSE_FORMAT.json_schema.schema)),
  'The same single classification request contains the complete original schema before USER context');
assert.deepEqual(defaultBody.messages.at(-1), { role: 'user', content: userText }, 'The current turn remains final');
const userPacket = JSON.parse(defaultBody.messages.find(message => message.role === 'user').content);
assert.equal(userPacket.contextOnly, true);
let ordinaryBody;
await classifyCommerceIntent('What is your shipping policy?', { jevDecision: { ok: true, primaryIntent: 'chat', productIntent: 'none' },
  fetchImpl: async (_url, options) => { ordinaryBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...payload, route: 'store_policy', needsLiveProductData: false, searchQuery: '',
      commerceConstraints: { edition: null, team: null },
      productRequest: { relation: 'none', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
      productRequirement: { action: 'none', evidence: '', priorTargetEvidence: '', updates: [], suspectedTerm: null } }) } }] })); } });
assert.equal(ordinaryBody.model, 'candidate-original-primary', 'Ordinary interpretation reuses the same configured primary model');
assert.deepEqual(ordinaryBody.response_format, { type: 'json_object' }, 'Ordinary commerce shares complete schema guidance and strict local validation');
assert.ok(ordinaryBody.messages[0].content.includes(JSON.stringify(COMMERCE_INTENT_RESPONSE_FORMAT.json_schema.schema)));
assert.equal(ordinaryBody.messages.at(-1).content, 'What is your shipping policy?');
console.log('Candidate classification provider self-check passed: existing independent model, same complete schema via JSON object, explicit override isolated, ordinary commerce shares validated reasoning transport; no network/DB/model');
