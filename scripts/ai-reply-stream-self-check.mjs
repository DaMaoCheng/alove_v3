import assert from 'node:assert/strict';

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { requestOpenAiText } = await import('../server/ai-reply-provider-service.js');
const config = { id: 'fixture', model: 'fixture-backup', apiKey: 'fixture', baseUrl: 'https://fixture.invalid', apiMode: 'chat_completions', stream: true };
const prompt = { systemPrompt: 'Fixture', messages: [{ role: 'user', content: 'Fixture' }] };
const encoder = new TextEncoder();
const event = (delta = {}, finish = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const done = 'data: [DONE]\n\n';
const complete = (text) => event({ content: text }) + event({}, 'stop') + done;
const protocol = (error) => error?.code === 'AI_REPLY_PROTOCOL_ERROR';
let passed = 0;
let failed = 0;
async function check(name, run) {
  try { await run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); }
}
function streamResponse(value, { splitBytes = false, onCancel = () => {} } = {}) {
  const bytes = encoder.encode(value);
  return new Response(new ReadableStream({
    start(controller) {
      if (splitBytes) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(bytes);
      controller.close();
    },
    cancel: onCancel,
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
async function invoke(fetchImpl, options = {}) {
  return requestOpenAiText(prompt, { modelConfig: config, timeoutMs: 1000, recordProviderCallFn: async () => {}, fetchImpl, ...options });
}

await check('explicit backup streaming sends stream=true and collects answer', async () => {
  const text = await invoke(async (url, init) => {
    assert.equal(url, 'https://fixture.invalid/chat/completions');
    assert.equal(JSON.parse(init.body).stream, true);
    return streamResponse(complete('A complete answer.'));
  });
  assert.equal(text, 'A complete answer.');
});
await check('UTF-8 crossing chunks, CRLF, comments, multiline data and usage-only events', async () => {
  const frames = ': keepalive\r\n\r\n'
    + 'data: {"choices":\r\ndata: [{"index":0,"delta":{"role":"assistant","content":"你好 👋"},"finish_reason":null}]}\r\n\r\n'
    + event({ reasoning_content: 'private reasoning must not become an answer', content: ' mundo' })
    + event({}, 'stop')
    + 'data: {"choices":[],"usage":{"completion_tokens":7}}\n\n' + done;
  assert.equal(await invoke(async () => streamResponse(frames, { splitBytes: true })), '你好 👋 mundo');
});
await check('streamed JSON continues returning raw text for existing JSON parser', async () => {
  assert.equal(await invoke(async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body).response_format, { type: 'json_object' });
    return streamResponse(event({ content: '{"ok":' }) + event({ content: 'true}' }) + event({}, 'stop') + done);
  }, { jsonOutput: true }), '{"ok":true}');
});
await check('assistant role and null or empty tool fields preserve ordinary answers', async () => {
  assert.equal(await invoke(async () => streamResponse(
    event({ role: 'assistant', content: 'Normal', tool_calls: null, function_call: null, refusal: null })
      + event({ content: ' answer', tool_calls: [] }) + event({}, 'stop') + done,
  )), 'Normal answer');
});
for (const [name, frames] of [
  ['missing DONE', event({ content: 'partial' }) + event({}, 'stop')],
  ['missing stop', event({ content: 'partial' }) + done],
  ['length finish is truncated', event({ content: 'partial' }) + event({}, 'length') + done],
  ['tool call does not become answer', event({ tool_calls: [{ index: 0, function: { name: 'fixture', arguments: '{}' } }] }) + event({}, 'tool_calls') + done],
  ['tool call with prose is still rejected', event({ content: 'text', tool_calls: [{ index: 0, function: { name: 'fixture' } }] }) + event({}, 'stop') + done],
  ['tool role cannot masquerade as an assistant', event({ role: 'tool', content: 'text' }) + event({}, 'stop') + done],
  ['system role cannot masquerade as an assistant', event({ role: 'system', content: 'text' }) + event({}, 'stop') + done],
  ['malformed tool-call object is rejected', event({ content: 'text', tool_calls: {} }) + event({}, 'stop') + done],
  ['non-null function_call false is rejected', event({ content: 'text', function_call: false }) + event({}, 'stop') + done],
  ['non-null empty refusal is rejected', event({ content: 'text', refusal: '' }) + event({}, 'stop') + done],
  ['malformed event JSON', 'data: {broken}\n\n' + event({}, 'stop') + done],
  ['empty stream', ''],
  ['usage-only stream', 'data: {"choices":[],"usage":{"completion_tokens":0}}\n\n' + done],
  ['reasoning-only stream', event({ reasoning_content: 'not an answer' }) + event({}, 'stop') + done],
  ['empty answer despite terminal flags', event({}, 'stop') + done],
  ['oversized answer', complete('x'.repeat(65537))],
  ['oversized frame', ': ' + 'x'.repeat(1048577) + '\n\n' + complete('answer')],
]) await check(name, async () => {
  await assert.rejects(invoke(async () => streamResponse(frames)), protocol);
});
await check('deadline covers stream reading and cancels the reader', async () => {
  let cancelled = false;
  await assert.rejects(invoke(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(event({ content: 'pending' }))); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/event-stream' } }), { timeoutMs: 15 }), (error) => error?.code === 'AI_REPLY_TIMEOUT');
  assert.equal(cancelled, true);
});
await check('default non-streaming cannot silently accept SSE', async () => {
  let cancelled = false;
  await assert.rejects(invoke(async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, false);
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  }, { modelConfig: { ...config, stream: false } }), protocol);
  assert.equal(cancelled, true);
});
await check('normal JSON non-stream response retains output and default false', async () => {
  const { stream: _stream, ...normalConfig } = config;
  assert.equal(await invoke(async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, false);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Normal answer' } }] }), { headers: { 'content-type': 'application/json' } });
  }, { modelConfig: normalConfig }), 'Normal answer');
});
await check('Responses API rejects the unsupported chat-only stream flag', async () => {
  await assert.rejects(invoke(async () => { throw new Error('must not send'); }, { modelConfig: { ...config, apiMode: 'responses' } }), protocol);
});
await check('normal Responses API remains non-streaming', async () => {
  assert.equal(await invoke(async (url, init) => {
    assert.equal(url, 'https://fixture.invalid/responses');
    assert.equal(JSON.parse(init.body).stream, false);
    return new Response(JSON.stringify({ output_text: 'Normal responses answer' }), { headers: { 'content-type': 'application/json' } });
  }, { modelConfig: { ...config, apiMode: 'responses', stream: false } }), 'Normal responses answer');
});
for (const status of [402, 429]) await check(`HTTP ${status} retains status semantics`, async () => {
  await assert.rejects(invoke(async () => new Response(JSON.stringify({ error: { message: 'fixture failure' } }), { status, headers: { 'content-type': 'application/json', 'retry-after': '3' } })), (error) => error?.statusCode === status && error?.code !== 'AI_REPLY_PROTOCOL_ERROR');
});
console.log(`AI reply stream checks: ${passed} passed, ${failed} failed (mock transport; no provider calls or database writes).`);
if (failed) process.exitCode = 1;
