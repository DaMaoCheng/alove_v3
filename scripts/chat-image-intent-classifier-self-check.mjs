import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
process.env.VENICE_API_KEY = "test-chat-image-classifier-key";
process.env.TYPESAFE_API_KEY = "";
process.env.VENICE_BASE_URL = "https://classifier.example.test/v1";
process.env.VENICE_MODEL = "test-model";

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), body: JSON.parse(String(options.body || "{}")) });
  const message = String(JSON.parse(String(options.body || "{}")).messages?.[1]?.content || "");
  const isNormalPhotoRequest = /发照片看看|show me a photo|send me a photo/i.test(message);
  const isOrdinaryChat = /what did you think of the match|what size should I buy/i.test(message);
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              hasIntent: !isOrdinaryChat,
              allowed: !isOrdinaryChat,
              confidence: 0.91,
              intentType: isOrdinaryChat ? "none" : (isNormalPhotoRequest ? "library_photo" : "try_on"),
            }),
          },
        }],
      };
    },
  };
};

try {
  const {
    classifyChatImageIntent,
    normalizeChatImageConditions,
    shouldRunIntentClassifier,
  } = await import("../server/chat-image-intent-classifier-service.js");

  assert.equal(shouldRunIntentClassifier("that would look good on you, let me see the vibe"), true, "short messages should use language-agnostic semantic classification");
  assert.equal(shouldRunIntentClassifier("show me a Bayern Munich green home shirt"), true, "product intent should be classified semantically before image delivery");
  assert.equal(shouldRunIntentClassifier("that kit would look great, could you send a selfie?"), true, "explicit selfie intent should enter the image classifier");
  assert.equal(shouldRunIntentClassifier("what did you think of the match?"), true, "ordinary short chat should be safely classified as no image intent");
  assert.equal(shouldRunIntentClassifier("look this pic"), true, "inspection-like wording requires semantic confirmation before discarding mixed resend requests");
  assert.equal(shouldRunIntentClassifier("what is this picture?"), true, "semantic classification must distinguish inspection from mixed visual output");
  assert.equal(shouldRunIntentClassifier("Mándame una foto de ti"), true, "Spanish photo requests should enter the classifier");
  assert.equal(shouldRunIntentClassifier("Envie uma imagem sua"), true, "Portuguese photo requests should enter the classifier");
  assert.equal(shouldRunIntentClassifier("あなたの写真を見せて"), true, "Japanese photo requests should enter the classifier");
  assert.equal(shouldRunIntentClassifier("发照片看看"), true, "ambiguous Chinese photo requests should enter the classifier");

  const result = await classifyChatImageIntent("that kit would look great, could you send a selfie?");
  assert.deepEqual(result, {
    hasIntent: true,
    classificationIntent: "try_on",
    classificationOutcome: "accepted",
    requestScope: "unknown",
    allowed: true,
    confidence: 0.91,
    intentType: "try_on",
    explicitGeneration: true,
    conditions: null,
    detectionSource: "classifier",
  });
  assert.equal(requests.length, 1, "classifier should make one request for ambiguous visual intent");
  assert.equal(requests[0].url, "https://classifier.example.test/v1/chat/completions");
  assert.equal(requests[0].body.response_format.type, "json_object");

  const neutralConditions = { wants_no_clothing: false, wants_clothing: false };
  assert.deepEqual(normalizeChatImageConditions(neutralConditions), neutralConditions, "a valid negative semantic decision must not fall back to wear keywords");
  assert.equal(normalizeChatImageConditions({}), null, "missing semantic fields must retain fallback");
  assert.equal(normalizeChatImageConditions({ wants_clothing: "false", wants_no_clothing: false }), null, "malformed semantic fields must retain fallback");

  const { evaluateChatImageRequest } = await import("../server/chat-image-generation-service.js");
  const { resolveChatImageRequestConstraints, createChatImageVariation } = await import("../server/chat-image-variation-service.js");
  const noClothing = { wants_no_clothing: true, wants_clothing: false };
  const trustedJev = { ok: true, confident: true, imageConditions: noClothing };
  const requestCount = requests.length;
  const text = "给我拍一张你不穿衣服的照片";
  const decision = await evaluateChatImageRequest(null, { userText: text, jevDecision: trustedJev });
  assert.deepEqual(decision.trigger.conditions, noClothing, "deterministic photo intent must preserve upstream JEV conditions");
  const constraints = resolveChatImageRequestConstraints({ userText: text, semanticConditions: decision.trigger.conditions });
  assert.equal(constraints.wantsWear, false, "negated Chinese wear must not introduce an outfit");
  assert.equal(createChatImageVariation({ userText: text, constraints }).wardrobe, "", "negated photo must skip wardrobe");

  const neutral = await evaluateChatImageRequest(null, { userText: text, jevDecision: { ...trustedJev, imageConditions: neutralConditions } });
  assert.deepEqual(neutral.trigger.conditions, neutralConditions, "both false must survive the deterministic branch");
  assert.equal(resolveChatImageRequestConstraints({ userText: text, semanticConditions: neutral.trigger.conditions }).wantsWear, false);
  assert.equal(requests.length, requestCount, "trusted supplied semantic handling must not make extra provider calls");
  for (const jevDecision of [null, { ...trustedJev, ok: false }, { ...trustedJev, confident: false }, { ...trustedJev, imageConditions: {} }]) {
    const fallback = await evaluateChatImageRequest(null, { userText: "take a photo of yourself without clothing", jevDecision });
    assert.equal(fallback.trigger.conditions, null, "unavailable or invalid semantic result must retain fallback");
    assert.equal(resolveChatImageRequestConstraints({ userText: "take a photo of yourself without clothing", semanticConditions: fallback.trigger.conditions }).wants_no_clothing, true);
  }
  const countBeforeBlocker = requests.length;
  const blocked = await evaluateChatImageRequest(null, { userText: "create a product image of you", jevDecision: trustedJev });
  assert.equal(blocked.trigger.allowed, false, "deterministic disallowed intent must retain priority");
  assert.equal(blocked.trigger.conditions, undefined, "disallowed intent must bypass semantic handling");
  assert.equal(requests.length, countBeforeBlocker, "deterministic blocker must not make extra provider calls");

  const libraryResult = await classifyChatImageIntent("发照片看看");
  assert.deepEqual(libraryResult, {
    hasIntent: true,
    classificationIntent: "library_photo",
    classificationOutcome: "accepted",
    requestScope: "unknown",
    allowed: true,
    confidence: 0.91,
    intentType: "library_photo",
    explicitGeneration: false,
    conditions: null,
    detectionSource: "classifier",
  });

  const ordinaryResult = await classifyChatImageIntent("what did you think of the match?");
  assert.deepEqual(ordinaryResult, {
    hasIntent: false,
    classificationIntent: "none",
    classificationOutcome: "model_no_intent",
    requestScope: "unknown",
    allowed: false,
    confidence: 0.91,
    intentType: "none",
    explicitGeneration: false,
    conditions: null,
    detectionSource: "classifier",
  });

  // Scale only the classifier's provider timers; use real abort/body paths
  // without making this regression wait thirty seconds per attempt.
  const nativeSetTimeout = globalThis.setTimeout;
  const originalClassifierFetch = globalThis.fetch;
  const budgets = [];
  let delayedCalls = 0;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay >= 4000 && delay <= 30000) {
      budgets.push(delay);
      return nativeSetTimeout(callback, delay / 100, ...args);
    }
    return nativeSetTimeout(callback, delay, ...args);
  };
  globalThis.fetch = async (_url, { signal }) => ({
    ok: true,
    status: 200,
    json: () => new Promise((resolve, reject) => {
      delayedCalls++;
      const timer = nativeSetTimeout(() => resolve({ choices: [{ message: { content: JSON.stringify({
        hasIntent: true, allowed: true, confidence: .98, intentType: "library_photo",
      }) } }] }), 240);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(Error("fixture abort")); }, { once: true });
    }),
  });
  try {
    const slow = await classifyChatImageIntent("show me a photo", { jevDecision: { ok: true, confident: false } });
    assert.equal(slow.allowed, true, "a body slower than the former 15s budget and the provider default must still be classified");
    assert.equal(budgets[0], 30000, "image classification receives the enlarged finite provider budget");
    assert(budgets.every(ms => ms > 29000 && ms <= 30000), "body read retains the enlarged attempt deadline");
    assert.equal(delayedCalls, 1, "a successful response must not start another provider");
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.fetch = originalClassifierFetch;
  }

  const generationSource = readFileSync("server/chat-image-generation-service.js", "utf8");
  assert.match(generationSource, /classifyChatImageIntent/, "chat image generation should use the intent classifier after deterministic rules");

  console.log("chat image intent classifier self-check passed");
} finally {
  globalThis.fetch = originalFetch;
}
