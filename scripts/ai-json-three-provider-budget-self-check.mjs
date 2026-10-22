import assert from 'node:assert/strict';
Object.assign(process.env, { OPENAI_FALLBACK_STREAM: 'false', AIOVE_PROVIDER_LOG_WRITE_ENABLED: 'false', VENICE_API_KEY: 'fixture', OPENAI_API_KEY: 'fixture',
  VENICE_BASE_URL: 'https://primary.example.test', OPENAI_BASE_URL: 'https://backup.example.test',
  OPENAI_API_MODE: 'responses', OPENAI_FALLBACK_MODEL: 'fixture-third' });
const { requestAiJsonWithProviderFallback } = await import('../server/ai-json-provider-service.js');
const messages = [{ role: 'user', content: 'Return a bounded decision.' }];
const delayed = signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('fixture abort')), { once: true }));
for (const initialFailure of ['timeout', 'http_402']) {
  const calls = [], start = Date.now();
  const result = await requestAiJsonWithProviderFallback(messages, { timeoutMs: 210, fallbackReserveMs: 90,
    recordProviderCallFn: async () => {}, fetchImpl: async (url, options) => {
      assert.ok(url.includes('.example.test'), 'fixtures cannot reach a real provider');
      calls.push(JSON.parse(options.body).model);
      if (calls.length === 1 && initialFailure === 'http_402') return new Response('{}', { status: 402 });
      if (calls.length < 3) return delayed(options.signal);
      return new Response(JSON.stringify({ output_text: '{"allowed":false}' }));
    } });
  assert.deepEqual(result, { allowed: false });
  assert.equal(calls.length, 3, 'A slow first backup must not starve the configured third provider');
  assert.equal(calls[2], 'fixture-third');
  assert.ok(Date.now() - start < 400, 'No extension of the caller total budget');
}
for (const content of ['{"allowed":false}', '{broken}']) {
  let calls = 0;
  const request = () => requestAiJsonWithProviderFallback(messages, { timeoutMs: 210, fallbackReserveMs: 90,
    recordProviderCallFn: async () => {}, fetchImpl: async () => {
      calls++; return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    } });
  if (content === '{broken}') await assert.rejects(request, error => error.code === 'AI_JSON_PARSE_ERROR');
  else assert.deepEqual(await request(), { allowed: false });
  assert.equal(calls, 1, 'A completed HTTP200 verdict or malformed output never seeks another verdict');
}
let defaultCalls = 0;
await assert.rejects(() => requestAiJsonWithProviderFallback(messages, { timeoutMs: 40, recordProviderCallFn: async () => {},
  fetchImpl: async (_url, { signal }) => { defaultCalls++; return delayed(signal); } }), error => error.code === 'AI_REPLY_TIMEOUT');
assert.equal(defaultCalls, 1, 'Callers without reserved fallback retain the original budget behavior');
console.log('Three-provider JSON budget self-check passed: no backup starvation, same total deadline, no verdict shopping; no network/DB');
