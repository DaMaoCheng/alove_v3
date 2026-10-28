// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from "node:assert/strict";

Object.assign(process.env, {
  AIOVE_PROVIDER_LOG_WRITE_ENABLED: "false",
  VENICE_API_KEY: "fixture-venice", VENICE_BASE_URL: "https://venice.example.test/v1",
  OPENAI_API_KEY: "fixture-openai", OPENAI_BASE_URL: "https://openai.example.test/v1",
  OPENAI_FALLBACK_API_KEY: "fixture-deepseek", OPENAI_FALLBACK_MODEL: "fixture-deepseek",
  OPENAI_API_MODE: "chat_completions",
});
const { SERVER_CONFIG } = await import("../server/config.js");
const { requestAiJsonWithProviderFallback, isAiJsonProviderConfigured } = await import("../server/ai-json-provider-service.js");
const { requestOpenAiText, isRetryableAiReplyTransportError, shouldFallbackAiReplyProvider } = await import("../server/ai-reply-provider-service.js");
const { requestReplyWithProviderFallback } = await import("../server/ai-reply-service.js");
const messages = [{ role: "system", content: "Return JSON only: {allowed:boolean}." }, { role: "user", content: "Fixture untrusted text" }];
const prompt = { systemPrompt: "Reply.", messages: [messages[1]] };
const chain = SERVER_CONFIG.aiReply.replyChain;
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
function fixture(outcomes) {
  const calls = [], logs = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, key: options.headers.Authorization });
    const outcome = outcomes[calls.length - 1];
    assert(outcome, "unexpected provider call");
    if (outcome.throw) throw outcome.throw;
    if (outcome.before) outcome.before();
    return new Response(JSON.stringify(outcome.status >= 400
      ? { error: { message: outcome.message || "fixture error" } }
      : { choices: [{ message: { content: outcome.text ?? '{"allowed":true}' } }] }), { status: outcome.status || 200 });
  };
  return { calls, logs, fetchImpl, recordProviderCallFn: async (event) => logs.push(event) };
}
const invoke = (f, extra = {}) => requestAiJsonWithProviderFallback(messages, { ...f, ...extra });

for (const count of [1, 2]) {
  const f = fixture([...Array.from({ length: count }, () => ({ status: 402, message: "balance exhausted; network timeout help" })), { text: '{"allowed":true}' }]);
  assert.deepEqual(await invoke(f), { allowed: true });
  check(f.calls.length === count + 1, "402 switches immediately, never retries the same provider");
  assert.deepEqual(f.logs.map((event) => event.provider), chain.slice(0, count + 1).map((config) => config.id));
  assert.deepEqual(f.logs.map((event) => event.status), [...Array(count).fill("error"), "success"]);
  check(f.calls[0].body.venice_parameters?.include_venice_system_prompt === false, "primary keeps Venice parameters");
  check(f.calls.slice(1).every((call) => !call.body.venice_parameters), "Venice parameters never reach backups");
  check(f.calls.every((call) => call.body.response_format?.type === "json_object"), "all chat-completions classifiers request JSON");
  check(f.calls.every((call) => call.body.messages[0].content === messages[0].content), "classifier contract is preserved without chat reply instructions");
  assert.deepEqual(f.calls.map((call) => call.key), chain.slice(0, count + 1).map((config) => `Bearer ${config.apiKey}`));
}
const allFailed = fixture([{ status: 402 }, { status: 402 }, { status: 402 }]);
await assert.rejects(() => invoke(allFailed), (error) => error.statusCode === 402);
check(allFailed.calls.length === 3, "all failed JSON providers stop after one attempt each");
for (const status of [400, 401, 403]) {
  const f = fixture([{ status, message: "network timeout" }]);
  await assert.rejects(() => invoke(f), (error) => error.statusCode === status && !isRetryableAiReplyTransportError(error) && !shouldFallbackAiReplyProvider(error));
  check(f.calls.length === 1, "other nonretryable 4xx preserve existing stop behavior");
}
for (const text of ['{"allowed":false,"confidence":0.95}', '{"ids":[]}', '{"allowed":true,"confidence":0.1}']) {
  const f = fixture([{ text }]);
  assert.deepEqual(await invoke(f), JSON.parse(text));
  check(f.calls.length === 1, "valid negative, empty knowledge and low confidence do not seek another verdict");
}
for (const text of ["network malformed JSON", "I cannot comply", "{broken}"]) {
  const f = fixture([{ text }]);
  await assert.rejects(() => invoke(f), SyntaxError);
  check(f.calls.length === 1, "HTTP 200 malformed/refused output cannot trigger provider shopping");
}
// A missing provider answer is different from nonempty semantic JSON output.
const emptyEnvelope = fixture([{ text: "" }, { text: '{"allowed":false}' }]);
assert.deepEqual(await invoke(emptyEnvelope), { allowed: false });
assert.deepEqual(emptyEnvelope.logs.map(event => event.status), ["error", "success"]);
check(emptyEnvelope.calls.length === 2, "empty envelope switches once and accepts the next valid negative review");
const allEmptyEnvelopes = fixture([{ text: "" }, { text: " " }, { text: "" }]);
await assert.rejects(() => invoke(allEmptyEnvelopes), error => error.code === "AI_REPLY_PROTOCOL_ERROR");
check(allEmptyEnvelopes.calls.length === 3, "empty provider envelopes exhaust the finite chain once per provider");
for (const outcome of [{ status: 503 }, { status: 429 }, { throw: new Error("fetch failed") }]) {
  const f = fixture([outcome, { text: '{"allowed":false}' }]);
  assert.deepEqual(await invoke(f), { allowed: false });
  check(f.calls.length === 2, "transient failures switch with one attempt per provider for JSON tasks");
}
let now = 0;
const exhausted = fixture([{ status: 402, before: () => { now = 3500; } }]);
await assert.rejects(() => invoke(exhausted, { nowFn: () => now, timeoutMs: 3500 }));
check(exhausted.calls.length === 1, "no request is made after the shared deadline");
const timeoutStarted = Date.now();
let timeouts = 0;
await assert.rejects(() => requestAiJsonWithProviderFallback(messages, {
  timeoutMs: 35, recordProviderCallFn: async () => {},
  fetchImpl: async (_url, { signal }) => {
    timeouts++;
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  },
}));
check(Date.now() - timeoutStarted < 500, "auxiliary tasks never inherit backup's 40 second timeout");
check(timeouts <= 2, "deadline is shared across the chain");
// Headers alone do not prove successful transport: an aborted/incomplete body
// must use the same transport fallback, not become a semantic JSON parse vote.
for (const bodyFailure of ["timeout", "network"]) {
  const calls = [], logs = [];
  const result = await requestAiJsonWithProviderFallback(messages, {
    timeoutMs: 160, fallbackReserveMs: 80,
    recordProviderCallFn: async event => logs.push(event),
    fetchImpl: async (_url, { signal }) => {
      calls.push(true);
      if (calls.length > 1) return new Response(JSON.stringify({ choices: [{ message: { content: '{"allowed":false}' } }] }));
      return { ok: true, status: 200, json: async () => {
        if (bodyFailure === "network") throw new TypeError("terminated");
        await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("body aborted"), { name: "AbortError" })), { once: true }));
      } };
    },
  });
  assert.deepEqual(result, { allowed: false });
  assert.deepEqual(logs.map(event => event.status), ["error", "success"]);
  check(calls.length === 2, "incomplete response body switches once within the original shared deadline");
  check(logs[0].error?.code === (bodyFailure === "timeout" ? "AI_REPLY_TIMEOUT" : "AI_REPLY_NETWORK_ERROR"), "body failures preserve their transport reason");
}
for (const status of [200, 401, 402]) {
  let calls = 0;
  const run = () => requestAiJsonWithProviderFallback(messages, {
    recordProviderCallFn: async () => {},
    fetchImpl: async () => {
      calls++;
      if (calls > 1) return new Response(JSON.stringify({ choices: [{ message: { content: '{"allowed":true}' } }] }));
      return new Response("not json", { status });
    },
  });
  if (status === 200 || status === 402) assert.deepEqual(await run(), { allowed: true });
  else await assert.rejects(run, error => error.statusCode === 401);
  check(calls === (status === 401 ? 1 : 2), "malformed transport envelopes switch providers while HTTP authorization errors remain terminal");
}
const isolated = fixture([{ status: 402 }]);
await assert.rejects(() => invoke(isolated, { config: { apiKey: "test", model: "test", baseUrl: "https://isolated.example.test/v1" } }));
check(isolated.calls.length === 1, "explicit fixture config never reaches configured real backups");
check(isAiJsonProviderConfigured() && !isAiJsonProviderConfigured({ apiKey: "", model: "test" }), "configuration checks cover the chain and isolated overrides");
const responseCalls = [], responseLogs = [];
assert.deepEqual(await requestAiJsonWithProviderFallback(messages, {
  config: { id: "responses-fixture", apiKey: "test", model: "test", baseUrl: "https://responses.example.test/v1", apiMode: "responses", reasoningEffort: "minimal" },
  fetchImpl: async (url, options) => { responseCalls.push({ url, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ output: [{ content: [{ text: '{"allowed":true}' }] }] })); },
  recordProviderCallFn: async (event) => responseLogs.push(event),
}), { allowed: true });
check(responseCalls[0].url.endsWith("/responses") && responseCalls[0].body.text.format.type === "json_object", "Responses API uses its own endpoint and JSON format");
check(responseCalls[0].body.instructions === messages[0].content && !responseCalls[0].body.response_format, "Responses task contract and API-specific format stay intact");
check(responseLogs[0].provider === "responses-fixture", "logs use the actual selected provider");
const reviewContracts = [messages[0], { role: "system", content: "Additional business contract; never loosen the first contract." }, messages[1]];
for (const apiMode of ["chat_completions", "responses"]) {
  let body;
  await requestAiJsonWithProviderFallback(reviewContracts, {
    config: { apiKey: "test", model: "test", baseUrl: "https://contracts.example.test/v1", apiMode },
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ output_text: '{"allowed":false}' })); },
    recordProviderCallFn: async () => {},
  });
  assert.deepEqual(apiMode === "chat_completions" ? body.messages : [{ role: "system", content: body.instructions }, ...body.input], reviewContracts);
  check(true, "separate system contracts and their original order survive both API modes");
}

for (const count of [1, 2, 3]) {
  const f = fixture([...Array.from({ length: count }, () => ({ status: 402, message: "network timeout balance" })), ...(count < 3 ? [{ text: "Backup complete." }] : [])]);
  const events = [];
  const run = () => requestReplyWithProviderFallback((context, options) => requestOpenAiText(context, { ...options, fetchImpl: f.fetchImpl, recordProviderCallFn: f.recordProviderCallFn }), prompt, {
    providerConfigs: chain, validateReply: () => ({ valid: true }), sleepFn: async () => assert.fail("402 must not retry or sleep"), onProviderEvent: async (event) => events.push(event),
  });
  if (count === 3) await assert.rejects(run, (error) => error.aiAttemptCount === 3 && error.statusCode === 402);
  else { const result = await run(); check(result.providerId === chain[count].id && result.model === chain[count].model, "reply reports actual backup provider and model"); }
  check(f.calls.length === Math.min(count + 1, 3), "main reply 402 does not consume repeated primary attempts");
  assert.deepEqual(events.filter((event) => event.type === "attempt_failure").map((event) => event.nextProvider), Array.from({ length: count }, (_, index) => chain[index + 1]?.id || ""));
}
const { classifyCommerceIntentFallback: classifyCommerceIntent, classifyProductIntent } = await import("../server/product-intent-classifier-service.js");
const { classifyCatalogueEditions } = await import("../server/product-edition-service.js");
const { classifyOrderLookup } = await import("../server/chat-order-intent-service.js");
const { classifyChatImageIntent } = await import("../server/chat-image-intent-classifier-service.js");
const { assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { classifyProactiveContent } = await import("../server/proactive-content-policy-service.js");
const { selectBusinessKnowledgeReferences } = await import("../server/business-knowledge-selection-service.js");
const unavailableJev = async () => ({ ok: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 });
const commerceVerdict = { route: "chat", topic: "other", needsLiveProductData: false, searchQuery: "", referencedProductId: "",
  knowledgeScope: "general", knowledgeQuery: "", answerRequired: false, businessInquiry: null, humanHandoff: null, promotionInquiry: null, checkoutIssue: null,
  replyBoundary: { salesAllowed: true, contactAllowed: true }, commerceConstraints: { edition: null, team: null },
  productRequest: { relation: "none", action: "new", items: [], selectedIndex: null, selectionEvidence: "" },
  productRequirement: { action: "none", evidence: "", priorTargetEvidence: "", updates: [], suspectedTerm: null },
  candidateResponse: { action: "none", evidence: "", candidateId: "" }, confidence: .95 };
const consumers = [
  { name: "commerce", protocolFallback: true, run: () => classifyCommerceIntent("Hello"), verdict: commerceVerdict, valid: (result) => result.confident === true },
  { name: "catalogue edition", run: () => classifyCatalogueEditions([{ name: "Fan shirt" }]), verdict: { items: [{ index: 0, edition: "fan", confidence: .95 }] }, valid: (result) => result[0]?.edition === "fan" },
  { name: "legacy product", run: () => classifyProductIntent("Find me a shirt", { classifyJev: unavailableJev }), verdict: { isProductRequest: true, confidence: .95 }, valid: (result) => result.isProductRequest === true },
  { name: "order", run: () => classifyOrderLookup("Where is my order?", { classifyJev: unavailableJev }), verdict: { orderLookup: true, referenceKind: "existing_order", requestEvidence: "Where is my order?" }, valid: (result) => result === true },
  { name: "image", run: () => classifyChatImageIntent("Send your photo", { jevDecision: { ok: false, llmFallbackAllowed: true, exhausted: true, attempts: 2 } }), verdict: { hasIntent: true, allowed: true, confidence: .95, intentType: "library_photo" }, valid: (result) => result.allowed === true },
  { name: "reply review", protocolFallback: true, run: () => assessReplyBoundary({ text: "Hello", recordLog: async () => {} }), verdict: { allowed: true, confidence: .95 }, valid: (result) => result.allowed === true },
  { name: "proactive review", run: () => classifyProactiveContent({ recentMessages: [{ senderType: "user", text: "Hello" }], classifyJevState: unavailableJev }), verdict: { state: "neutral", candidateKind: "care", confidence: .95, quality: { natural: true, grounded: true, novel: true } }, valid: (result) => result.candidateKind === "care" },
];
const originalFetch = globalThis.fetch;
try {
  for (const consumer of consumers) {
    const baseline = fixture([{ text: JSON.stringify(consumer.verdict) }]);
    globalThis.fetch = baseline.fetchImpl;
    const expected = await consumer.run();
    check(consumer.valid(expected), `${consumer.name} baseline is an accepted decision`);
    const recovered = fixture([{ status: 402 }, { text: JSON.stringify(consumer.verdict) }]);
    globalThis.fetch = recovered.fetchImpl;
    assert.deepEqual(await consumer.run(), expected, `${consumer.name} backup preserves normalization`);
    check(recovered.calls.length === 2, `${consumer.name} actually uses the shared backup transport`);
    // Commerce and the bounded reply reviewer explicitly validate their JSON
    // protocol. Other consumers keep terminal malformed-200 behavior.
    const malformed = fixture(Array.from({ length: consumer.protocolFallback ? chain.length : 1 }, () => ({ text: "{broken}" })));
    globalThis.fetch = malformed.fetchImpl;
    const result = await consumer.run();
    check(!consumer.valid(result), `${consumer.name} malformed output preserves failure protection`);
    check(malformed.calls.length === (consumer.protocolFallback ? chain.length : 1), `${consumer.name} malformed HTTP 200 follows its bounded protocol opt-in only`);
  }
  const section = { id: "new-topic", title: "Payment", content: "Only card payments are supported.", keywords: [], scope: "site", siteId: "site-fixture" };
  const knowledge = fixture([{ status: 402 }, { text: JSON.stringify({ ids: [section.id] }) }, { status: 402 }, { text: JSON.stringify({ matches: [{ id: section.id, quote: section.content, answersQuestion: true, confidence: .95 }] }) }]);
  globalThis.fetch = knowledge.fetchImpl;
  const result = await selectBusinessKnowledgeReferences({ query: "How can I pay?", sections: [section], siteId: "site-fixture" });
  check(result.items[0]?.content === section.content, "knowledge directory and exact-evidence stages both recover through backup");
  check(knowledge.calls.length === 4, "knowledge fallback remains independently bounded in both existing stages");
  for (const call of knowledge.calls.slice(2)) {
    const contract = call.body.messages.filter((row) => row.role === "system").map((row) => row.content).join("\n");
    check(contract.includes("templates and placeholders") && contract.includes("THIS site") && contract.includes("general explanation"), "both providers preserve site-fact versus generic-knowledge evidence requirements");
  }
  const emptyKnowledge = fixture([{ text: '{"ids":[]}' }]);
  globalThis.fetch = emptyKnowledge.fetchImpl;
  check((await selectBusinessKnowledgeReferences({ query: "Question", sections: [section] })).items.length === 0 && emptyKnowledge.calls.length === 1, "valid empty knowledge ends selection without another verdict");
} finally {
  globalThis.fetch = originalFetch;
}
console.log(`AI provider fallback self-check passed (${checks} checks; real transport, orchestration and all consumers, mocked network only)`);
