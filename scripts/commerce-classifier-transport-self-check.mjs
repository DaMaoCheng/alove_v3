// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { classifyCommerceIntentFallback: classifyCommerceIntent, commerceClassificationTimeout } = await import('../server/product-intent-classifier-service.js');
const state = { version: 1, status: 'active', owner: 'single', siteId: 's', characterId: 'c',
  targetEvidence: 'Real Madrid shirt', requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt' }, proposal: null };
const continuation = { siteId: 's', characterId: 'c', recentMessages: [{ senderType: 'character', productCandidateState: state }],
  jevDecision: { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 } };
assert.equal(commerceClassificationTimeout('Camiseta de niña retro Cristiano Ronaldo'), 40000, 'The same full merchandise protocol needs its bounded task budget even without a team');
assert.equal(commerceClassificationTimeout('manga corta', continuation), 40000, 'A validated contextual product continuation uses the same bounded merchandise task budget');
for (const options of [{ ...continuation, siteId: 'other' }, { ...continuation, jevDecision: { ...continuation.jevDecision, productAction: .5 } },
  { ...continuation, jevDecision: { ...continuation.jevDecision, primaryIntent: 'chat' } }, { ...continuation, recentMessages: [{ senderType: 'user', productCandidateState: state }] },
  { ...continuation, recentMessages: [{ senderType: 'character', productCandidateState: { ...state, status: 'cleared' } }] }]) {
  assert.equal(commerceClassificationTimeout('manga corta', options), 10000, 'An unrelated, unverified or different-scope turn retains its original deadline');
}
const config = { apiKey: 'fixture', model: 'fixture', baseUrl: 'https://fixture.example.test', apiMode: 'chat_completions' };
for (const [expected, output] of [['parse', '{broken}'], ['missing_fields', '{}']]) {
  let calls = 0;
  const result = await classifyCommerceIntent('Find Real Madrid jersey', { config, fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ choices: [{ message: { content: output } }] }));
  } });
  assert.equal(result.commerceClassificationFailure, expected);
  assert.equal(result.confident, false);
  assert.equal(calls, 1);
}
for (const [expected, error] of [['timeout', Object.assign(new Error('private body must not escape'), { code: 'AI_REPLY_TIMEOUT', retryable: true })],
  ['provider', Object.assign(new Error('private body must not escape'), { statusCode: 401 })]]) {
  const result = await classifyCommerceIntent('Find Real Madrid jersey', { config, fetchImpl: async () => { throw error; } });
  assert.equal(result.commerceClassificationFailure, expected);
  assert.equal(result.confident, false);
  assert.ok(!JSON.stringify(result).includes('private body'));
}
let body;
const result = await classifyCommerceIntent('Find Real Madrid jersey', { config, fetchImpl: async (_url, options) => {
  body = JSON.parse(options.body);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ route: 'chat', confidence: .4,
    replyBoundary: { salesAllowed: true, contactAllowed: true } }) } }] }));
} });
assert.equal(result.confident, true);
assert.equal(result.commerceClassificationFailure, undefined, 'A valid selection is usable independent of confidence and distinct from transport failure');
assert.match(body.messages[0].content, /compact JSON without indentation/);
assert.match(body.messages[0].content, /business inquiries and human-assistance requests semantically across all languages/);
assert.match(body.messages[0].content, /No field authorizes a search or proves availability/);
assert.match(body.messages[0].content, /at most one update per field/);
assert.match(body.messages[0].content, /an unspecified size does not mean requestedSizes:\[\]/);
assert.match(body.messages[0].content, /delivery, insurance, shipping speed, price calculation and return policies are not promotionInquiry policy/);
console.log('Commerce classifier transport self-check passed: safe timeout/provider/parse/missing-field codes, compact JSON and preserved business contracts; no network/DB');
