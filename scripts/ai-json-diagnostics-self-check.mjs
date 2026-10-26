import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { requestAiJsonWithProviderFallback } = await import('../server/ai-json-provider-service.js');
const providers = ['venice', 'openai'].map(id => ({ id, apiKey: 'fixture', model: `fixture-${id}`, apiMode: 'chat_completions', baseUrl: `https://${id}.example.test` }));
const logContext = { requestId: 'msg_fixture', sessionId: 'chat_fixture', characterId: 'mascot_fixture', userId: 'user_fixture', private: 'PRIVATE_INPUT' };
for (const [kind, content] of [['parse', '{broken PRIVATE_RESPONSE}'], ['shape', '{}'], ['evidence', '{"allowed":true}']]) {
  let count = 0; const logs = [];
  const result = await requestAiJsonWithProviderFallback([{ role: 'user', content: 'PRIVATE_INPUT' }], {
    config: providers, timeoutMs: 1000, perProviderTimeout: true, logContext,
    fetchImpl: async url => { assert(url.endsWith('.example.test/chat/completions')); count++;
      if (count === 1) await new Promise(resolve => setTimeout(resolve, 25));
      return new Response(JSON.stringify({ choices: [{ message: { content: count === 1 ? content : '{"allowed":false}' } }] })); },
    validateParsed: value => ({ valid: value.allowed === false, reason: kind === 'evidence' ? 'evidence' : 'shape' }),
    recordProviderCallFn: async value => logs.push({ ...value, elapsed: Date.now() - value.startedAt }),
  });
  assert.deepEqual(result, { allowed: false });
  assert.equal(count, 2, 'protocol failure reuses the existing backup exactly once');
  assert.deepEqual(logs.map(row => row.status), ['success', 'error', 'success']);
  assert(logs[1].elapsed >= 20, 'protocol rejection must retain the network attempt duration, not start timing after the answer');
  assert.equal(logs[1].error.aiJsonProtocolKind, kind);
  for (const row of logs) { assert.equal(row.requestId, logContext.requestId); assert.equal(row.sessionId, logContext.sessionId); assert.equal(row.private, undefined); }
}
console.log('JSON diagnostics self-check passed: parse/shape/evidence, full attempt duration and bounded correlated fallback');
const { buildProviderCallLogEvent } = await import('../server/ai-reply-log-service.js');
for (const [code, aiJsonProtocolKind, reason] of [
  ['AI_JSON_PARSE_ERROR', 'parse', 'json_parse'], ['AI_JSON_INVALID_OUTPUT', 'shape', 'json_shape'],
  ['AI_JSON_INVALID_OUTPUT', 'evidence', 'json_evidence'], ['AI_JSON_INVALID_OUTPUT', 'PRIVATE_UNKNOWN', 'json_shape'],
]) {
  const event = buildProviderCallLogEvent({ ...logContext, provider: 'venice', model: 'fixture', sourceRef: 'fixture', status: 'error', durationMs: 45,
    error: { code, aiJsonProtocolKind, message: 'PRIVATE_UPSTREAM_RESPONSE' } });
  assert.equal(event.status, 'provider_error'); assert.equal(event.degradationReason, reason); assert.equal(event.durationMs, 45);
  assert(event.errorMessage.includes('phase=output_protocol')); assert(!JSON.stringify(event).includes('PRIVATE'));
}
const unknown = buildProviderCallLogEvent({ status: 'error', error: { code: 'PRIVATE_UNKNOWN', message: 'PRIVATE_BODY', aiJsonProtocolKind: 'PRIVATE_KIND' } });
assert.equal(unknown.degradationReason, 'request_failed'); assert(!JSON.stringify(unknown).includes('PRIVATE'));
const rateLimit = buildProviderCallLogEvent({ status: 'error', error: { statusCode: 429, providerRateLimit: { kind: 'model_overloaded', retryAfterSeconds: 30 } } });
assert(rateLimit.errorMessage.includes('reason=http_429')); assert(rateLimit.errorMessage.includes('cause=model_overloaded'));
for (const content of ['{"allowed":false}', '{broken PRIVATE_BODY}']) {
  let calls = 0; const events = [];
  const execute = () => requestAiJsonWithProviderFallback([{ role: 'user', content: 'fixture' }], {
    config: providers, timeoutMs: 1000, recordProviderCallFn: async row => events.push(row),
    fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content } }] })); },
  });
  if (content[1] === '"') { assert.deepEqual(await execute(), { allowed: false }); assert.equal(events.length, 1); }
  else { await assert.rejects(execute, error => error.code === 'AI_JSON_PARSE_ERROR'); assert.equal(events.length, 2); }
  assert.equal(calls, 1, 'default consumers and semantic refusal do not seek a different verdict');
}
const { selectBusinessKnowledgeReferences, selectGeneralKnowledgeReferences, requestBusinessKnowledgeSelection } = await import('../server/business-knowledge-selection-service.js');
const section = { id: 'section1', title: 'Delivery', content: 'Delivery depends on the destination.', scope: 'site', siteId: 'shop' };
for (const selectReferences of [selectBusinessKnowledgeReferences, selectGeneralKnowledgeReferences]) {
  const stages = [];
  await selectReferences({ query: 'How is delivery handled?', sections: [section], siteId: 'shop', logContext,
    select: async input => { assert.strictEqual(input.logContext, logContext); stages.push(input.stage);
      return input.stage === 'directory' ? { ids: ['section1'] } : { matches: [] }; } });
  assert.deepEqual(stages, ['directory', 'evidence'], 'both knowledge stages preserve request association');
}
await requestBusinessKnowledgeSelection({ stage: 'directory', query: 'delivery', sections: [section], limit: 1, logContext }, {
  config: providers[0], fetchImpl: async (_url, options) => { const body = JSON.stringify(JSON.parse(options.body));
    assert(!body.includes('msg_fixture') && !body.includes('PRIVATE_INPUT'), 'diagnostic context must not enter the knowledge model prompt');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ids":[]}' } }] })); },
});
console.log('Provider diagnostic formatting, unchanged refusal/default behavior and private knowledge context propagation passed');
const { buildCommerceDecisionLogEvent } = await import('../server/ai-reply-log-service.js');
const decision = JSON.parse(buildCommerceDecisionLogEvent({ searchIntent: { businessKnowledgeRequired: false }, stageDurations: { productMs: 3500, knowledgeMs: 0, private: 'PRIVATE_STAGE' } }).errorMessage);
assert.equal(decision.knowledgeRequired, false); assert.deepEqual(decision.timings, { productMs: 3500, knowledgeMs: 0 });
for (const invalid of [-1, 1200001, NaN, Infinity, .5, '50', null]) {
  const event = JSON.parse(buildCommerceDecisionLogEvent({ searchIntent: { businessKnowledgeRequired: 'false' }, stageDurations: { productMs: invalid, knowledgeMs: 10 } }).errorMessage);
  assert.equal(event.knowledgeRequired, undefined); assert.deepEqual(event.timings, { knowledgeMs: 10 });
}
const crowded = buildCommerceDecisionLogEvent({ searchIntent: { businessKnowledgeRequired: true, commerceClassificationFailure: 'missing_fields', productScopeReason: 'request_unverified', commerceClassificationFailures: [{ provider: 'venice', kind: 'protocol_shape' }] },
  knowledgeContext: { strategy: 'business_selection_unavailable', items: [{ id: 'x'.repeat(64) }], selectionFailure: { stage: 'evidence', kind: 'timeout' } },
  stageDurations: { productMs: 1200000, knowledgeMs: 1200000 }, factualContext: { required: true, status: 'not_required', searched: false, reason: 'not_requested', decisionSource: 'catalogue_scope', webSearchScore: .99 } });
assert(crowded.errorMessage.length <= 500); assert.doesNotThrow(() => JSON.parse(crowded.errorMessage));
let unsafeLog;
await requestAiJsonWithProviderFallback([{ role: 'user', content: 'fixture' }], { config: providers[0], logContext: { requestId: { toString: () => 'msg_fixture', private: 'PRIVATE_OBJECT' }, sessionId: 'invalid/path', userId: 'valid_id' },
  recordProviderCallFn: async row => { unsafeLog = row; }, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })) });
assert.equal(unsafeLog.requestId, undefined); assert.equal(unsafeLog.sessionId, undefined); assert.equal(unsafeLog.userId, 'valid_id');
console.log('Safe optional commerce timings, bounded diagnostics and invalid identifier rejection passed');
