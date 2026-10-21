import assert from 'node:assert/strict';
Object.assign(process.env, { AIOVE_PROVIDER_LOG_WRITE_ENABLED: 'false', VENICE_API_KEY: 'fixture',
  OPENAI_API_KEY: 'fixture', OPENAI_API_MODE: 'responses', OPENAI_FALLBACK_MODEL: '',
  VENICE_BASE_URL: 'https://primary.example.test', OPENAI_BASE_URL: 'https://backup.example.test' });
const { requestAiJsonWithProviderFallback } = await import('../server/ai-json-provider-service.js');
const messages = [{ role: 'system', content: 'Return a strict decision.' }, { role: 'user', content: 'Test' }];
const responseFormat = { type: 'json_schema', json_schema: { name: 'isolated_decision', strict: true,
  schema: { type: 'object', additionalProperties: false, properties: { allowed: { type: 'boolean' } }, required: ['allowed'] } } };
const calls = [], events = [], startedAt = Date.now();
const result = await requestAiJsonWithProviderFallback(messages, { timeoutMs: 120, fallbackReserveMs: 60, responseFormat,
  recordProviderCallFn: async e => events.push(e), fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (calls.length === 1) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return new Response(JSON.stringify({ output_text: '{"allowed":false}' }));
  } });
assert.deepEqual(result, { allowed: false });
assert.equal(calls.length, 2, 'Primary timeout must leave one real fallback attempt within the total deadline');
assert.ok(Date.now() - startedAt < 450, 'All attempts share the caller total budget');
assert.deepEqual(calls[0].body.response_format, responseFormat);
assert.deepEqual(calls[1].body.text.format, { type: 'json_schema', ...responseFormat.json_schema });
assert.equal(calls[1].body.response_format, undefined, 'Responses format must use its own API shape');
assert.deepEqual(events.map(e => e.status), ['error', 'success']);
let invalidCalls = 0;
await assert.rejects(() => requestAiJsonWithProviderFallback(messages, { timeoutMs: 120, fallbackReserveMs: 60, responseFormat,
  recordProviderCallFn: async () => {}, fetchImpl: async () => { invalidCalls++; return new Response(JSON.stringify({ output_text: '{broken}' })); } }), SyntaxError);
assert.equal(invalidCalls, 1, 'HTTP 200 parse failure cannot seek another verdict');
let rejectedCalls = 0;
assert.deepEqual(await requestAiJsonWithProviderFallback(messages, { timeoutMs: 120, fallbackReserveMs: 60,
  recordProviderCallFn: async () => {}, fetchImpl: async () => { rejectedCalls++; return new Response(JSON.stringify({ output_text: '{"allowed":false,"confidence":0}' })); } }), { allowed: false, confidence: 0 });
assert.equal(rejectedCalls, 1, 'Rejected and low-confidence decisions never trigger fallback');
let invalidShapeCalls = 0;
assert.deepEqual(await requestAiJsonWithProviderFallback(messages, { timeoutMs: 120, fallbackReserveMs: 60, responseFormat,
  recordProviderCallFn: async () => {}, fetchImpl: async () => { invalidShapeCalls++; return new Response(JSON.stringify({ output_text: '{"allowed":"yes"}' })); } }), { allowed: 'yes' });
assert.equal(invalidShapeCalls, 1, 'Business validation of HTTP 200 remains caller-owned and cannot seek a second verdict');
const allSlowStart = Date.now();
let allSlowCalls = 0;
await assert.rejects(() => requestAiJsonWithProviderFallback(messages, { timeoutMs: 120, fallbackReserveMs: 60,
  recordProviderCallFn: async () => {}, fetchImpl: async (_url, { signal }) => {
    allSlowCalls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } }), e => e.code === 'AI_REPLY_TIMEOUT');
assert.equal(allSlowCalls, 2, 'All slow providers stop after the finite total budget');
assert.ok(Date.now() - allSlowStart < 450);
let now = 0, expiredCalls = 0;
await assert.rejects(() => requestAiJsonWithProviderFallback(messages, { timeoutMs: 120, fallbackReserveMs: 60, nowFn: () => now,
  recordProviderCallFn: async () => {}, fetchImpl: async () => {
    expiredCalls++; now = 120; return new Response(JSON.stringify({ error: { message: 'fixture' } }), { status: 402 });
  } }));
assert.equal(expiredCalls, 1, 'No provider starts at or after the total deadline');
console.log('JSON task budget self-check passed: reserved transport fallback, shared deadline, API-specific identical strict schema, no verdict shopping; no network/DB');
