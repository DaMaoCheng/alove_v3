import assert from "node:assert/strict";

import { isRetryableAiReplyTransportError, requestOpenAiReply, requestOpenAiText, shouldFallbackAiReplyProvider } from "../server/ai-reply-provider-service.js";

const originalFetch = globalThis.fetch;
const promptContext = { systemPrompt: "Reply briefly.", messages: [{ role: "user", content: "Hello" }] };
const providerEvents = [];
const recordProviderCallFn = async (event) => providerEvents.push(event);

try {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "temporary outage" } }), { status: 503 });
  await assert.rejects(
    () => requestOpenAiReply(promptContext, { timeoutMs: 1000, recordProviderCallFn }),
    (error) => error?.statusCode === 503 && error?.retryable === true && isRetryableAiReplyTransportError(error)
  );

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 });
  await assert.rejects(
    () => requestOpenAiReply(promptContext, { timeoutMs: 1000, recordProviderCallFn }),
    (error) => error?.statusCode === 401 && error?.retryable === false && !isRetryableAiReplyTransportError(error)
  );

  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  await assert.rejects(
    () => requestOpenAiReply(promptContext, { timeoutMs: 1000, recordProviderCallFn }),
    (error) => error?.code === "AI_REPLY_NETWORK_ERROR" && error?.retryable === true
  );

  let capturedRequest = null;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return new Response(JSON.stringify({ output_text: "Fallback reply" }), { status: 200 });
  };
  const fallbackModelConfig = {
    apiKey: "fallback-test-key",
    baseUrl: "https://fallback.example.test/v1",
    model: "fallback-test-model",
    apiMode: "responses",
    reasoningEffort: "minimal",
  };
  await requestOpenAiReply(promptContext, { timeoutMs: 1000, modelConfig: fallbackModelConfig, recordProviderCallFn });
  assert.equal(capturedRequest?.url, "https://fallback.example.test/v1/responses", "the fallback request must use its configured endpoint");
  assert.equal(capturedRequest?.options?.headers?.Authorization, "Bearer fallback-test-key", "the fallback request must use its configured API key");
  assert.equal(JSON.parse(capturedRequest?.options?.body || "{}").model, "fallback-test-model", "the fallback request must use its configured model");
  assert.deepEqual(providerEvents.map((event) => event.status), ["error", "error", "error", "success"], "every provider transport outcome must be audit logged");
  assert.equal(providerEvents.at(-1)?.sourceRef, "chat-reply", "chat reply provider calls must retain their source");
  // HTTP success with no model text is not a successful provider answer.
  // stream:false may still receive an upstream SSE body with usage only.
  for (const [body, contentType] of [
    ['<html>private-body-must-not-be-logged</html>', 'text/html'],
    ['data: {"choices":[],"usage":{"completion_tokens":0}}\n\ndata: [DONE]\n\n', 'text/event-stream'],
    ['{}', 'application/json'],
    ['{"choices":[]}', 'application/json'],
    ['{"choices":[{"message":{"content":null}}]}', 'application/json'],
    ['{"choices":[{"message":{"content":"  "}}]}', 'application/json'],
    ['{"output":[]}', 'application/json'],
  ]) {
    const events = [];
    await assert.rejects(() => requestOpenAiText(promptContext, {
      modelConfig: fallbackModelConfig, timeoutMs: 1000, recordProviderCallFn: async event => events.push(event),
      fetchImpl: async () => new Response(body, { headers: { 'Content-Type': contentType } }),
    }), error => error.code === 'AI_REPLY_PROTOCOL_ERROR' && shouldFallbackAiReplyProvider(error)
      && !isRetryableAiReplyTransportError(error) && !error.message.includes('private-body'));
    assert.deepEqual(events.map(event => event.status), ['error'], 'empty/invalid envelopes never record successful calls');
  }
  for (const status of [401, 402, 429, 503]) {
    await assert.rejects(() => requestOpenAiText(promptContext, { modelConfig: fallbackModelConfig, timeoutMs: 1000,
      recordProviderCallFn: async () => {}, fetchImpl: async () => new Response('not JSON', { status }) }),
    error => error.statusCode === status && shouldFallbackAiReplyProvider(error) === (status !== 401));
  }
  assert.equal(shouldFallbackAiReplyProvider({ statusCode: 401, code: 'AI_REPLY_PROTOCOL_ERROR' }), false,
    'an HTTP authorization error cannot become a protocol fallback');
  for (const [payload, expected] of [
    [{ choices: [{ message: { content: '{"allowed":false}' } }] }, '{"allowed":false}'],
    [{ output_text: '{"ids":[]}' }, '{"ids":[]}'],
    [{ output: [{ content: [{ type: 'output_text', text: 'Normal response' }] }] }, 'Normal response'],
    [{ choices: [{ message: { content: 'Nonempty semantic JSON refusal' } }] }, 'Nonempty semantic JSON refusal'],
  ]) {
    const events = [];
    const text = await requestOpenAiText(promptContext, { modelConfig: fallbackModelConfig, timeoutMs: 1000,
      recordProviderCallFn: async event => events.push(event), fetchImpl: async () => new Response(JSON.stringify(payload)) });
    assert.equal(text, expected, 'normal text and valid negative/empty-result review JSON remain intact');
    assert.deepEqual(events.map(event => event.status), ['success']);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("ai reply provider retry classification self-check passed");
