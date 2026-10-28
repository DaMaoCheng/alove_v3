import assert from 'node:assert/strict';

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
// Direct role-title consumers read this compatible slot; keep all their tests
// isolated from developer credentials and real network endpoints.
process.env.AI_REPLY_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'fixture';
process.env.OPENAI_BASE_URL = 'https://fixture.invalid';
process.env.OPENAI_MODEL = 'deepseek-flash';
process.env.OPENAI_API_MODE = 'responses';
const { requestOpenAiText } = await import('../server/ai-reply-provider-service.js');
const { buildProviderCallLogEvent } = await import('../server/ai-reply-log-service.js');
const { requestAiJsonWithProviderFallback } = await import('../server/ai-json-provider-service.js');
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
for (const content of ['', '{"allowed":true}']) await check(`non-stream token limit rejects ${content ? 'apparently complete' : 'reasoning-only'} output`, async () => {
  let captured;
  await assert.rejects(invoke(async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content, reasoning_content: 'private-reasoning-fixture' } }],
    usage: { prompt_tokens: 6733, completion_tokens: 3000, completion_tokens_details: { reasoning_tokens: 3000 } },
  })), { modelConfig: { ...config, stream: false, requestBodyExtras: { max_tokens: 3000 } },
    recordProviderCallFn: async event => { captured = event; } }), error => error?.code === 'AI_REPLY_PROTOCOL_ERROR'
      && error.protocolKind === 'output_truncated');
  assert.equal(captured.error.providerOutputDiagnostic.reasoningTokens, 3000);
  assert.equal(captured.error.providerOutputDiagnostic.completionTokens, 3000);
  const log = buildProviderCallLogEvent(captured);
  assert.match(log.errorMessage, /protocol=output_truncated; stop=length/);
  assert.match(log.errorMessage, /reasoning_tokens=3000/);
  assert.match(log.errorMessage, /max_tokens=3000/);
  assert(!JSON.stringify(captured.error).includes('private-reasoning-fixture'));
  assert(log.errorMessage.length <= 500);
});
await check('complete non-stream answer ignores reasoning text and preserves stop behavior', async () => {
  assert.equal(await invoke(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop',
    message: { content: 'Formal answer', reasoning_content: 'private-reasoning-fixture' } }] })),
  { modelConfig: { ...config, stream: false } }), 'Formal answer');
});
await check('output diagnostics persist only bounded numeric counters and fixed stop reasons', async () => {
  const log = buildProviderCallLogEvent({ status: 'error', error: { code: 'AI_REPLY_PROTOCOL_ERROR', protocolKind: 'output_truncated',
    message: 'secret-fixture', providerOutputDiagnostic: { finishReason: 'length', promptTokens: 'secret-fixture',
      completionTokens: -1, reasoningTokens: Infinity, maxTokens: 1e15, headersMs: 12, bodyMs: 21,
      raw: 'secret-fixture', authorization: 'secret-fixture' } } });
  assert.match(log.errorMessage, /headers_ms=12; body_ms=21/);
  assert(!log.errorMessage.includes('secret-fixture'));
  assert(!/prompt_tokens|completion_tokens|reasoning_tokens|max_tokens/.test(log.errorMessage));
});
await check('non-stream truncation uses the finite JSON backup and preserves its valid rejection', async () => {
  let calls = 0;
  const result = await requestAiJsonWithProviderFallback([{ role: 'user', content: 'Fixture' }], {
    config: ['first', 'second', 'third'].map(id => ({ ...config, id, model: id, stream: false })),
    timeoutMs: 1000, recordProviderCallFn: async () => {},
    validateParsed: value => ({ valid: typeof value?.allowed === 'boolean' }),
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ finish_reason: calls === 1 ? 'length' : 'stop',
        message: { content: JSON.stringify({ allowed: calls === 1 }) } }] }));
    },
  });
  assert.equal(calls, 2, 'the third provider must not be asked to overturn a valid rejection');
  assert.deepEqual(result, { allowed: false });
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

const responsesConfig = { ...config, model: 'deepseek-flash', apiMode: 'responses', stream: false, reasoningEffort: 'low' };
const formalMessage = text => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] });
await check('official Responses reasoning items never become formal answer text', async () => {
  assert.equal(await invoke(async () => new Response(JSON.stringify({ status: 'completed', output: [
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'PRIVATE_REASONING_FIXTURE' }] }, formalMessage('{"allowed":false}'),
  ] })), { modelConfig: responsesConfig }), '{"allowed":false}');
});
await check('reasoning-only Responses payload is not an answer', async () => {
  await assert.rejects(() => invoke(async () => new Response(JSON.stringify({ status: 'completed', output: [
    { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'PRIVATE_REASONING_FIXTURE' }] },
  ] })), { modelConfig: responsesConfig }), error => protocol(error) && error.protocolKind === 'empty_answer');
});
for (const status of ['incomplete', 'failed', 'in_progress', 'queued', 'cancelled']) {
  await check(`Responses ${status} cannot certify even complete-looking JSON`, async () => {
    await assert.rejects(() => invoke(async () => new Response(JSON.stringify({ status, output_text: '{"allowed":true}',
      incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : undefined,
    })), { modelConfig: responsesConfig }), protocol);
  });
}
await check('incomplete Responses message cannot certify a completed envelope', async () => {
  await assert.rejects(() => invoke(async () => new Response(JSON.stringify({ status: 'completed', output: [
    { ...formalMessage('{"allowed":true}'), status: 'incomplete' },
  ] })), { modelConfig: responsesConfig }), protocol);
});
await check('untyped legacy Responses still rejects explicit incomplete message status', async () => {
  await assert.rejects(() => invoke(async () => new Response(JSON.stringify({ output: [
    { status: 'incomplete', content: [{ text: '{"allowed":true}' }] },
  ] })), { modelConfig: responsesConfig }), error => protocol(error) && error.protocolKind === 'incomplete_response');
});
await check('Responses failure falls back once and valid rejection remains terminal', async () => {
  let calls = 0;
  const actual = await requestAiJsonWithProviderFallback([{ role: 'user', content: 'Fixture JSON.' }], {
    config: [responsesConfig, { ...responsesConfig, model: 'other-fixture' }, { ...responsesConfig, model: 'unused-fixture' }],
    validateParsed: raw => ({ valid: typeof raw?.allowed === 'boolean' }), recordProviderCallFn: async () => {},
    fetchImpl: async () => new Response(JSON.stringify(++calls === 1
      ? { status: 'incomplete', output_text: '{"allowed":true}' }
      : { status: 'completed', output: [formalMessage('{"allowed":false}')] })),
  });
  assert.equal(calls, 2);
  assert.deepEqual(actual, { allowed: false });
});
await check('legacy untyped Responses text stays compatible and explicit non-answer content is ignored', async () => {
  assert.equal(await invoke(async () => new Response(JSON.stringify({ output: [
    { content: [{ text: 'Legacy' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'reasoning_text', text: 'PRIVATE_REASONING_FIXTURE' }, { type: 'output_text', text: 'answer' }] },
  ] })), { modelConfig: responsesConfig }), 'Legacy\nanswer');
});
await check('official Responses keeps native schema, reasoning field, instructions and system role', async () => {
  const format = { type: 'json_schema', json_schema: { name: 'audit', strict: true, schema: { type: 'object', properties: { allowed: { type: 'boolean' } }, required: ['allowed'], additionalProperties: false } } };
  const actual = await requestAiJsonWithProviderFallback([{ role: 'system', content: 'Audit JSON.' }, { role: 'system', content: 'Preserve evidence.' }, { role: 'user', content: 'Fixture.' }], {
    config: [{ ...responsesConfig, apiKey: 'fixture', baseUrl: 'https://official.example.test', requestBodyExtras: { max_output_tokens: 3000 } }],
    responseFormat: format, recordProviderCallFn: async () => {}, fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(url, 'https://official.example.test/responses');
      assert.equal(body.model, 'deepseek-flash');
      assert.deepEqual(body.reasoning, { effort: 'low' });
      assert.equal(body.stream, false);
      assert.equal(body.max_output_tokens, 3000);
      assert.equal(body.instructions, 'Audit JSON.');
      assert.deepEqual(body.input[0], { role: 'system', content: 'Preserve evidence.' });
      assert.deepEqual(body.text.format, { type: 'json_schema', ...format.json_schema });
      assert.equal(body.response_format, undefined);
      return new Response(JSON.stringify({ status: 'completed', output: [formalMessage('{"allowed":false}')] }));
    },
  });
  assert.deepEqual(actual, { allowed: false });
});
await check('role-title consumer uses shared formal extraction without exposing reasoning', async () => {
  const { deriveCharacterRoleTitle } = await import('../server/character-polish-service.js');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(url, 'https://fixture.invalid/responses');
      return new Response(JSON.stringify({ status: 'completed', output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'PRIVATE_REASONING_FIXTURE' }] }, formalMessage('Matchday Spark'),
      ] }));
    };
    const result = await deriveCharacterRoleTitle({ name: 'Fixture', backstory: 'A football guide.' });
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Matchday Spark');
  } finally { globalThis.fetch = original; }
});
for (const status of ['completed', 'incomplete']) await check(`knowledge consumer handles official Responses ${status}`, async () => {
  const { requestKnowledgeAiJson } = await import('../server/knowledge-ai-service.js');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(url, 'https://fixture.invalid/responses');
      return new Response(JSON.stringify({ status, output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'PRIVATE_REASONING_FIXTURE' }] }, formalMessage('{"sections":[]}'),
      ] }));
    };
    const run = () => requestKnowledgeAiJson({ task: 'outline', payload: { sourceText: 'Fixture.' },
      config: { provider: 'openai', openai: { apiKey: 'fixture', baseUrl: 'https://fixture.invalid', model: 'deepseek-flash', apiMode: 'responses', timeoutMs: 1000 } } });
    if (status === 'completed') assert.deepEqual((await run()).data, { sections: [] });
    else await assert.rejects(run);
  } finally { globalThis.fetch = original; }
});
for (const status of [402, 429]) await check(`HTTP ${status} retains status semantics`, async () => {
  await assert.rejects(invoke(async () => new Response(JSON.stringify({ error: { message: 'fixture failure' } }), { status, headers: { 'content-type': 'application/json', 'retry-after': '3' } })), (error) => error?.statusCode === status && error?.code !== 'AI_REPLY_PROTOCOL_ERROR');
});
console.log(`AI reply stream checks: ${passed} passed, ${failed} failed (mock transport; no provider calls or database writes).`);
if (failed) process.exitCode = 1;
