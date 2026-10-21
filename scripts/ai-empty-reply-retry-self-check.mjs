import assert from "node:assert/strict";
Object.assign(process.env, {
  AIOVE_PROVIDER_LOG_WRITE_ENABLED: "false",
  VENICE_API_KEY: "fixture-venice", VENICE_MODEL: "fixture-primary",
  OPENAI_API_KEY: "fixture-openai", OPENAI_MODEL: "fixture-secondary",
  OPENAI_FALLBACK_API_KEY: "fixture-deepseek", OPENAI_FALLBACK_MODEL: "fixture-tertiary",
});
const { requestOpenAiReply } = await import('../server/ai-reply-provider-service.js');
const originalFetch = globalThis.fetch;
try {
  let body;
  globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: '{"displayText":"Hello.","speechText":"Hello."}' } }] })); };
  for (const apiMode of ['chat_completions', 'responses']) {
    const modelConfig = { id: 'fixture', apiKey: 'fixture', model: 'fixture', baseUrl: 'https://fixture.invalid', apiMode };
    await requestOpenAiReply({ systemPrompt: 'Return JSON.', messages: [], structuredOutput: true }, { modelConfig, recordProviderCallFn: async () => {} });
    assert.equal(apiMode === 'chat_completions' ? body.response_format?.type : body.text?.format?.type, 'json_object', 'commerce/support native envelope is explicit at the real provider boundary');
    await requestOpenAiReply({ systemPrompt: 'Return JSON.', messages: [] }, { modelConfig, recordProviderCallFn: async () => {} });
    assert.equal(body.response_format || body.text, undefined, 'ordinary replies retain their original request format');
  }
} finally { globalThis.fetch = originalFetch; }
const {
  buildFallbackChatReply,
  generateChatReplyWithRequest,
  requestReplyWithModelFallback,
  requestReplyWithProviderFallback,
  requestReplyWithRetryBudget,
} = await import("../server/ai-reply-service.js");

const promptContext = {
  systemPrompt: "Reply casually.",
  messages: [{ role: "user", content: "Hello" }],
};

const completeReply = '{"displayText":"Hey bro, I am here.","speechText":"Hey bro, I am here.","voiceMeta":{"languageCode":"en","languageLabel":"English"}}';
const incompleteReply = '{"displayText":"That kit works because.","speechText":"That kit works because."}';

const recoveredCalls = [];
const recoveredReply = await generateChatReplyWithRequest({
  promptContext,
  userText: "Hello",
  logContext: { languageCode: "en", languageLabel: "English" },
  requestReplyText: async () => {
    recoveredCalls.push(Date.now());
    return recoveredCalls.length < 10 ? "" : completeReply;
  },
  recordReplyLogFn: async () => {},
});

assert.equal(recoveredCalls.length, 10, "nine empty replies must allow the tenth total model call to recover");
assert.equal(recoveredReply.text, "Hey bro, I am here.", "only the complete tenth reply may be displayed");
assert.equal(recoveredReply.sourceRef, "openai-responses", "a recovered reply must keep the normal AI source");

const incompleteCalls = [];
const incompleteRecoveredReply = await generateChatReplyWithRequest({
  promptContext,
  userText: "Tell me about that kit",
  logContext: { languageCode: "en", languageLabel: "English" },
  requestReplyText: async () => {
    incompleteCalls.push(Date.now());
    return incompleteCalls.length < 10 ? incompleteReply : completeReply;
  },
  recordReplyLogFn: async () => {},
});

assert.equal(incompleteCalls.length, 10, "incomplete endings must use the same ten-call ceiling");
assert.equal(incompleteRecoveredReply.text, "Hey bro, I am here.", "an incomplete candidate must never be shown before the recovered reply");

const malformedStructure = "displayText: 'Found a catalogue candidate; is this the item?', speechText: 'Found a catalogue candidate; is this the item?', voiceMeta: {}";
const recoveredStructureLogs = [];
let recoveredStructureCalls = 0;
const structureRecovered = await generateChatReplyWithRequest({
  promptContext, userText: "Show the candidate", logContext: { languageCode: "en" },
  requestReplyText: async () => ++recoveredStructureCalls === 1 ? malformedStructure : completeReply,
  recordReplyLogFn: async event => recoveredStructureLogs.push(event),
});
assert.equal(recoveredStructureCalls, 2, "an unreadable structured envelope must reject the generation attempt and recover within the existing budget");
assert.equal(structureRecovered.text, "Hey bro, I am here.");
assert.equal(structureRecovered.sourceType, "ai");
assert.equal(recoveredStructureLogs.some(event => event.status === "quality_block"), false, "a recoverable format failure must not become a terminal quality reply");

const malformedStructureLogs = [];
let malformedStructureCalls = 0;
const structureExhausted = await generateChatReplyWithRequest({
  promptContext, userText: "Muéstrame la candidata", logContext: { languageCode: "es" },
  requestReplyText: async () => { malformedStructureCalls++; return malformedStructure; },
  recordReplyLogFn: async event => malformedStructureLogs.push(event),
});
assert.equal(malformedStructureCalls, 10, "format failures must retain the ten-call ceiling");
assert.equal(structureExhausted.sourceRef, "ai-request-fallback");
assert.equal(structureExhausted.text, buildFallbackChatReply("Muéstrame la candidata", { fallbackLanguageCode: "es" }));
assert.doesNotMatch(structureExhausted.text, /displayText|speechText|voiceMeta/);
assert.match(malformedStructureLogs.at(-1)?.errorMessage || "", /structured_reply_leak.*attempts=10\/10/, "exhaustion logs preserve format provenance and bounded attempt count");

const structureModels = [];
const structureProviderLogs = [];
const structureBackup = await generateChatReplyWithRequest({
  promptContext, userText: "Show the candidate", logContext: { languageCode: "en" },
  useConfiguredModelFallback: true,
  requestReplyText: async (_context, { modelConfig }) => {
    structureModels.push(modelConfig.model);
    return modelConfig.id === "venice" ? malformedStructure : completeReply;
  },
  recordReplyLogFn: async event => structureProviderLogs.push(event),
});
assert.deepEqual(structureModels, ["fixture-primary", "fixture-primary", "fixture-primary", "fixture-primary", "fixture-secondary"], "format recovery reuses the configured provider chain and its existing 4/3/3 allocation");
assert.equal(structureBackup.aiProvider, "openai");
assert.equal(structureBackup.aiModel, "fixture-secondary");
assert.equal(structureProviderLogs.filter(event => event.reply?.sourceRef === "venice-attempt-failure"
  && event.reply?.degradationReason === "structured_reply_leak").length, 4, "all rejected primary format attempts remain observable");
assert.equal(structureProviderLogs.at(-1)?.reply?.degradationReason, "provider_fallback_success");

for (const text of [completeReply, "Hey bro, I am here.", 'displayText: "Hey bro, I am here.", speechText: "Other words", voiceMeta: {}']) {
  let calls = 0;
  const reply = await generateChatReplyWithRequest({ promptContext, userText: "Hello", logContext: { languageCode: "en" },
    requestReplyText: async () => { calls++; return text; }, recordReplyLogFn: async () => {} });
  assert.equal(calls, 1, "valid JSON, plain text and safely extracted display text must not gain retries");
  assert.equal(reply.text, "Hey bro, I am here.");
  assert.equal(reply.sourceType, "ai");
}
for (const text of ["System prompt: private instructions.", "I am an AI assistant.", "displayText: 'System prompt: private instructions.', speechText: 'Private instructions.'"]) {
  let calls = 0;
  const reply = await generateChatReplyWithRequest({ promptContext, userText: "Hello", logContext: { languageCode: "en" },
    requestReplyText: async () => { calls++; return text; }, recordReplyLogFn: async () => {} });
  assert.equal(calls, 1, "internal information and assistant exposure remain terminal quality guards even alongside a format failure");
  assert.equal(reply.sourceRef, "quality-guard");
  assert.equal(reply.sourceType, "system");
  assert.doesNotMatch(reply.text, /System prompt|AI assistant|displayText|speechText/);
}

const exhaustedLogs = [];
const exhaustedReply = await generateChatReplyWithRequest({
  promptContext,
  userText: "Tell me about that kit",
  logContext: { languageCode: "en", languageLabel: "English" },
  requestReplyText: async () => incompleteReply,
  recordReplyLogFn: async (payload) => exhaustedLogs.push(payload),
});

assert.equal(exhaustedReply.text, buildFallbackChatReply("Tell me about that kit"), "ten incomplete replies must end with the localized timeout message");
assert.equal(exhaustedReply.sourceRef, "ai-request-fallback", "the terminal reply must be the transport timeout result, not a chat fallback");
assert.equal(exhaustedLogs.at(-1)?.status, "fallback", "exhaustion must be visible in the AI log");
assert.match(exhaustedLogs.at(-1)?.errorMessage || "", /incomplete_ending.*attempts=10\/10/, "the log must retain the completion failure and total attempts");

let syntheticNow = 0;
const retryTimeouts = [];
const retryDelays = [];
const recovered = await requestReplyWithRetryBudget(
  async (_context, options = {}) => {
    retryTimeouts.push(options.timeoutMs);
    if (retryTimeouts.length === 1) {
      const error = new Error("fetch failed");
      error.retryable = true;
      throw error;
    }
    return completeReply;
  },
  promptContext,
  {
    timeoutMs: 30000,
    nowFn: () => syntheticNow,
    sleepFn: async (delayMs) => {
      retryDelays.push(delayMs);
      syntheticNow += delayMs;
    },
  }
);
assert.equal(recovered, completeReply, "a transient transport failure must recover before the retry ceiling");
assert.equal(retryTimeouts.length, 2, "one recovered network failure must make exactly two model calls");
assert.equal(retryDelays.length, 1, "a retry must use one bounded backoff");
assert.deepEqual(retryTimeouts, [30000, 30000], "each retry must receive the configured full per-attempt timeout");

let nonRetryableCalls = 0;
await assert.rejects(
  () => requestReplyWithRetryBudget(async () => {
    nonRetryableCalls += 1;
    const error = new Error("OpenAI 401: invalid API key");
    error.statusCode = 401;
    throw error;
  }, promptContext, { timeoutMs: 30000, sleepFn: async () => assert.fail("HTTP 401 must not retry") }),
  /invalid API key/
);
assert.equal(nonRetryableCalls, 1, "authentication and other non-retryable 4xx errors must not retry");

let retryCeilingNow = 0;
const retryCeilingTimeouts = [];
await assert.rejects(
  () => requestReplyWithRetryBudget(async (_context, { timeoutMs }) => {
    retryCeilingTimeouts.push(timeoutMs);
    retryCeilingNow += timeoutMs;
    const error = new Error("fetch failed");
    error.retryable = true;
    throw error;
  }, promptContext, {
    timeoutMs: 12000,
    nowFn: () => retryCeilingNow,
    sleepFn: async (delayMs) => {
      retryCeilingNow += delayMs;
    },
  }),
  (error) => error?.message === "fetch failed" && error?.aiAttemptCount === 10 && error?.aiFailureReason === "network"
);
assert.equal(retryCeilingTimeouts.length, 10, "retryable failures must use all ten configured attempts");
assert.ok(retryCeilingTimeouts.every((timeout) => timeout === 12000), "every retry must keep the same configured per-attempt timeout");

const primaryModelConfig = { apiKey: "primary-key", model: "primary-model" };
const fallbackModelConfig = { apiKey: "fallback-key", model: "fallback-model" };
const switchedModels = [];
const fallbackRecovered = await requestReplyWithModelFallback(
  async (_context, { modelConfig }) => {
    switchedModels.push(modelConfig.model);
    if (modelConfig.model === "primary-model") {
      const error = new Error("fetch failed");
      error.retryable = true;
      throw error;
    }
    return completeReply;
  },
  promptContext,
  {
    primaryModelConfig,
    fallbackModelConfig,
    sleepFn: async () => {},
  }
);
assert.equal(fallbackRecovered.model, "fallback-model", "the fallback model must be reported when it recovers the reply");
assert.deepEqual(switchedModels, ["primary-model", "primary-model", "primary-model", "primary-model", "primary-model", "fallback-model"], "five retryable primary failures must switch to the fallback model");

const exhaustedModels = [];
await assert.rejects(
  () => requestReplyWithModelFallback(async (_context, { modelConfig }) => {
    exhaustedModels.push(modelConfig.model);
    const error = new Error("fetch failed");
    error.retryable = true;
    throw error;
  }, promptContext, {
    primaryModelConfig,
    fallbackModelConfig,
    sleepFn: async () => {},
  }),
  (error) => error?.aiAttemptCount === 10 && error?.aiModelAttemptSummary === "primary-model:5,fallback-model:5"
);
assert.deepEqual(exhaustedModels, ["primary-model", "primary-model", "primary-model", "primary-model", "primary-model", "fallback-model", "fallback-model", "fallback-model", "fallback-model", "fallback-model"], "both configured models must receive five retryable attempts");

let noFallbackCalls = 0;
await assert.rejects(
  () => requestReplyWithModelFallback(async () => {
    noFallbackCalls += 1;
    const error = new Error("fetch failed");
    error.retryable = true;
    throw error;
  }, promptContext, {
    primaryModelConfig,
    fallbackModelConfig: { apiKey: "", model: "" },
    sleepFn: async () => {},
  }),
  (error) => error?.aiAttemptCount === 10
);
assert.equal(noFallbackCalls, 10, "an unset fallback model must preserve ten primary attempts");

const nonRetryableModels = [];
await assert.rejects(
  () => requestReplyWithModelFallback(async (_context, { modelConfig }) => {
    nonRetryableModels.push(modelConfig.model);
    const error = new Error("OpenAI 401: invalid API key");
    error.statusCode = 401;
    throw error;
  }, promptContext, {
    primaryModelConfig,
    fallbackModelConfig,
    sleepFn: async () => assert.fail("a non-retryable error must not delay or switch models"),
  }),
  /invalid API key/
);
assert.deepEqual(nonRetryableModels, ["primary-model"], "a 401 must not reach the fallback model");

const threeTierModels = [];
const threeTierRecovered = await requestReplyWithProviderFallback(
  async (_context, { modelConfig }) => {
    threeTierModels.push(modelConfig.model);
    if (modelConfig.model !== "deepseek-model") {
      const error = new Error("fetch failed");
      error.retryable = true;
      throw error;
    }
    return completeReply;
  },
  promptContext,
  {
    providerConfigs: [
      { id: "venice", apiKey: "venice-key", model: "gemma-4-uncensored", timeoutMs: 9000 },
      { id: "openai", apiKey: "gpt-key", model: "gpt-model", timeoutMs: 9000 },
      { id: "deepseek", apiKey: "deepseek-key", model: "deepseek-model", timeoutMs: 9000 },
    ],
    sleepFn: async () => {},
  }
);
assert.equal(threeTierRecovered.providerId, "deepseek", "the third configured provider must recover after retryable failures above it");
assert.equal(threeTierRecovered.model, "deepseek-model", "the recovered model must be reported for reply logging");
assert.deepEqual(
  threeTierModels,
  ["gemma-4-uncensored", "gemma-4-uncensored", "gemma-4-uncensored", "gemma-4-uncensored", "gpt-model", "gpt-model", "gpt-model", "deepseek-model"],
  "three configured providers must split the ten-attempt budget as 4 primary, 3 first fallback, and 3 second fallback"
);

console.log("AI reply retry self-check passed");
