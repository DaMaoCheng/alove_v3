import assert from "node:assert/strict";

// Keep the deployment gate deterministic: all provider calls below are mocked,
// so the script must not depend on a real local or production Jev key.
if (!process.argv.includes("--real")) {
  process.env.TYPESAFE_API_KEY = "self-check-typesafe-key";
  process.env.TYPESAFE_BASE_URL = "https://typesafe.self-check.invalid/v1";
}

const { classifyJevIntent, mapJevImageIntent, normalizeJevResponse, buildQuestions } = await import("../server/jev-intent-service.js");
const { SERVER_CONFIG } = await import("../server/config.js");
const { classifyChatImageIntent } = await import("../server/chat-image-intent-classifier-service.js");
const { classifyProductIntent } = await import("../server/product-intent-classifier-service.js");
const { classifyOrderLookup } = await import("../server/chat-order-intent-service.js");
const { resolveRecentImageConversationContext } = await import("../server/chat-image-conversation-context-service.js");

const mockPayload = {
  model: "jev-1.13.0",
  answers: {
    route: { type: "choice", choice: "try_on", confidence: 0.94, probabilities: { try_on: 0.94, daily_chat: 0.06 } },
    wants_character_image: { type: "noul", noul: 0.99 },
    explicit_generation: { type: "noul", noul: 0.96 },
    image_inspection: { type: "noul", noul: 0.01 },
    product_request: { type: "noul", noul: 0.91 },
    product_action: { type: "noul", noul: 0.91 },
    order_lookup: { type: "noul", noul: 0.01 },
    web_search: { type: "noul", noul: 0.01 },
  },
};

const mockFetch = async () => new Response(JSON.stringify(mockPayload), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

const mocked = await classifyJevIntent({
  userText: "找一件球衣，然后穿上给我看看",
  capabilities: { canRecommendProducts: true, canLookupOrder: false },
  forceRefresh: true,
  fetchImpl: mockFetch,
});
assert.equal(mocked.ok, true);
assert.equal(mocked.primaryIntent, "try_on");
assert.equal(mocked.imageIntent, "try_on");
assert.equal(mocked.productIntent, "search");
assert.equal(mapJevImageIntent(mocked).explicitGeneration, true);

const productComment = normalizeJevResponse({
  answers: {
    route: { choice: "daily_chat", confidence: 0.93, probabilities: { daily_chat: 0.93, product_request: 0.07 } },
    product_request: { noul: 0.18 },
    product_action: { noul: 0.08 },
  },
});
assert.equal(productComment.primaryIntent, "daily_chat");
assert.equal(productComment.productIntent, "none");
assert.equal(productComment.productAction, 0.08);

const productRequest = normalizeJevResponse({
  answers: {
    route: { choice: "product_request", confidence: 0.94 },
    product_request: { noul: 0.96 },
    product_action: { noul: 0.91 },
  },
});
assert.equal(productRequest.productIntent, "search");
const mixedPublicAndProduct = normalizeJevResponse({ answers: {
  route: { choice: "product_request", confidence: .95 },
  product_request: { noul: .95 }, product_action: { noul: .92 }, web_search: { noul: .93 },
} });
assert.equal(mixedPublicAndProduct.productIntent, "search", "an independent public question does not erase the primary product action");
assert.equal(mixedPublicAndProduct.webSearchIntent, true, "an explicit public fact can coexist with a product request");
assert.equal(mixedPublicAndProduct.webSearchScore, .93, "preserve finite web-purpose diagnostic score without changing thresholds");
assert.match(buildQuestions().web_search.instructions, /catalogue/i, "web purpose must distinguish catalogue requirements from public-world research");


const dailyRouteWins = normalizeJevResponse({
  answers: {
    route: { choice: "daily_chat", confidence: 0.91 },
    product_request: { noul: 0.94 },
    product_action: { noul: 0.94 },
  },
});
assert.equal(dailyRouteWins.productIntent, "none", "daily_chat must not be upgraded by secondary product scores");

const unsupported = normalizeJevResponse({
  answers: {
    route: { choice: "product_request", confidence: 0.9 },
    product_request: { noul: 0.95 },
    product_action: { noul: 0.95 },
  },
}, { canRecommendProducts: false });
assert.equal(unsupported.unsupported, true);
assert.equal(unsupported.unsupportedIntent, "product_request");

const genericPhoto = normalizeJevResponse({
  answers: {
    route: { choice: "character_photo", confidence: 0.9 },
    wants_character_image: { noul: 0.96 },
    explicit_generation: { noul: 0.08 },
  },
});
assert.equal(genericPhoto.imageIntent, "library_photo");
assert.equal(genericPhoto.confident, true);
assert.equal(mapJevImageIntent(genericPhoto).explicitGeneration, false);

const priorImageTryOn = normalizeJevResponse({
  answers: {
    route: { choice: "try_on", confidence: 0.9 },
    image_inspection: { noul: 0.95 },
    explicit_generation: { noul: 0.85 },
  },
});
assert.equal(priorImageTryOn.imageIntent, "try_on");

const failed = await classifyJevIntent({
  userText: "show me a photo",
  capabilities: { canRecommendProducts: false },
  forceRefresh: true,
  fetchImpl: async () => new Response("provider unavailable", { status: 503 }),
});
assert.equal(failed.ok, false);
assert.equal(failed.source, "jev_unavailable");
assert.equal(failed.fallbackReason, "provider_error");

const lowConfidence = normalizeJevResponse({ answers: {
  route: { choice: "character_photo", confidence: 0.59 },
  wants_character_image: { noul: 0.9 },
} });
assert.equal(lowConfidence.confident, false);
assert.equal(mapJevImageIntent(lowConfidence), null);

const invalid = await classifyJevIntent({
  userText: "Could you show me a picture?",
  forceRefresh: true,
  fetchImpl: async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }),
});
assert.equal(invalid.fallbackReason, "invalid_response");

const timedOut = await classifyJevIntent({
  userText: "Can I see another picture?",
  forceRefresh: true,
  configOverride: { ...SERVER_CONFIG.typeSafe, timeoutMs: 25 },
  fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  }),
});
assert.equal(timedOut.fallbackReason, "timeout");

const context = await resolveRecentImageConversationContext({
  async execute() {
    return [[
      { sender_type: "character", content_type: "mascot_library_image", product_payload_json: JSON.stringify({ imageUrl: "/uploads/library.webp" }) },
      { sender_type: "user", content_type: "attachment", product_payload_json: JSON.stringify({ imageUrl: "/uploads/user.jpg" }) },
      { sender_type: "character", content_type: "product", product_payload_json: JSON.stringify({ imageUrl: "https://store.example/item.jpg" }) },
    ]];
  },
}, { sessionId: "session_self_check", beforeDisplayOrder: 100 });
assert.equal(context.hasRecentImage, true);
assert.equal(context.hasRecentUserImage, true);
assert.equal(context.hasRecentProductImage, true);

if (process.argv.includes("--real")) {
  assert.ok(SERVER_CONFIG.typeSafe.apiKey, "TYPESAFE_API_KEY is required for --real");
  const cases = [
    ["daily", "How was your day?"],
    ["product_comment", "Bonito bikini"],
    ["photo", "Can you send me a photo?"],
    ["library_photo_cn", "发照片看看"],
    ["library_photos", "发一些角色相关的图片"],
    ["single_image", "发一张图片"],
    ["try_on", "¿Puedes ponerte esta camiseta y enseñarme cómo queda?"],
    ["context_try_on", "你能穿上看看吗？", { hasRecentImage: true, hasRecentProductImage: true, recentImageCount: 1 }],
    ["product", "有没有皇马的球衣？"],
    ["order", "Where is my order?"],
    ["ambiguous", "这个怎么样？"],
  ];
  const expectedPrimaryIntent = {
    library_photos: "character_photo",
    library_photo_cn: "character_photo",
    single_image: "new_image",
    context_try_on: "try_on",
    product_comment: "daily_chat",
  };
  for (const [label, text, conversationContext] of cases) {
    const result = await classifyJevIntent({
      userText: text,
      conversationContext,
      capabilities: { canRecommendProducts: true, canLookupOrder: true, canSearchWeb: true },
      forceRefresh: true,
    });
    assert.equal(result.ok, true, `${label}: Jev request failed`);
    if (expectedPrimaryIntent[label]) {
      assert.equal(result.primaryIntent, expectedPrimaryIntent[label], `${label}: unexpected Jev route`);
    }
    console.log(JSON.stringify({
      label,
      primaryIntent: result.primaryIntent,
      imageIntent: result.imageIntent,
      productIntent: result.productIntent,
      orderIntent: result.orderIntent,
      webSearchIntent: result.webSearchIntent,
      confidence: result.confidence,
      confident: result.confident,
      source: result.source,
    }));
    if (label === "context_try_on") assert.equal(result.imageIntent, "try_on", `${label}: should generate a try-on image`);
  }
  const imageAdapter = await classifyChatImageIntent("Can you send me a photo?", { character: { category_id: "mascot" } });
  const productAdapter = await classifyProductIntent("有没有皇马的球衣？");
  const orderAdapter = await classifyOrderLookup("Where is my order?");
  assert.equal(typeof imageAdapter.hasIntent, "boolean");
  assert.equal(typeof productAdapter.isProductRequest, "boolean");
  assert.equal(typeof orderAdapter, "boolean");
  console.log(JSON.stringify({
    label: "existing_adapters",
    image: { hasIntent: imageAdapter.hasIntent, source: imageAdapter.detectionSource || "existing" },
    product: { isProductRequest: productAdapter.isProductRequest, source: productAdapter.detectionSource || "existing" },
    order: { isOrderLookup: orderAdapter },
  }));
}

if (!process.argv.includes("--real")) {
  const { evaluateChatImageRequest } = await import("../server/chat-image-generation-service.js");
  const { resolveChatImageRequestConstraints, createChatImageVariation } = await import("../server/chat-image-variation-service.js");
  const originalFetch = globalThis.fetch;
  let conditionRequests = 0;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), `${SERVER_CONFIG.typeSafe.baseUrl}/systemone`);
    conditionRequests += 1;
    const body = JSON.parse(options.body);
    assert.ok(body.questions.image_wants_no_clothing, "real adapter request must ask for clothing conditions");
    const noClothing = body.state.message.includes("不穿衣服");
    return new Response(JSON.stringify({ answers: {
      route: { choice: "new_image", confidence: 0.95 },
      wants_character_image: { noul: 0.99 },
      explicit_generation: { noul: 0.99 },
      image_wants_no_clothing: { noul: noClothing ? 0.99 : 0.01 },
      image_wants_clothing: { noul: 0.01 },
    } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const userText = "给我拍一张你不穿衣服的照片";
    const options = { userText, cacheKey: "image-conditions-entry-negation" };
    const decision = await evaluateChatImageRequest(null, options);
    assert.equal(decision.trigger.detectionSource, "deterministic", "semantic conditions must not replace the deterministic intent");
    assert.equal(decision.trigger.intentType, "try_on", "semantic route must not override existing trigger behavior");
    assert.deepEqual(decision.trigger.conditions, { wants_no_clothing: true, wants_clothing: false });
    const constraints = resolveChatImageRequestConstraints({ userText, semanticConditions: decision.trigger.conditions });
    assert.equal(constraints.wantsWear, false);
    assert.equal(createChatImageVariation({ userText, constraints }).wardrobe, "");
    await evaluateChatImageRequest(null, options);
    assert.equal(conditionRequests, 1, "same-message semantic decisions must reuse the JEV cache");
    const neutral = await evaluateChatImageRequest(null, {
      userText: "不要穿红色衣服给我拍一张照片", cacheKey: "image-conditions-entry-neutral",
    });
    assert.deepEqual(neutral.trigger.conditions, { wants_no_clothing: false, wants_clothing: false });
    assert.equal(resolveChatImageRequestConstraints({ userText: "不要穿红色衣服给我拍一张照片", semanticConditions: neutral.trigger.conditions }).wantsWear, false);
    await evaluateChatImageRequest(null, { userText: "create a product image of you" });
    await evaluateChatImageRequest(null, { userText: "take a photo #mock-image" });
    assert.equal(conditionRequests, 2, "hard blockers and mock requests must skip semantic calls");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log(`jev intent routing self-check passed${process.argv.includes("--real") ? " (real)" : ""}`);
process.exit(0);
