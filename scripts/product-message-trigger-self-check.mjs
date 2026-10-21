import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { buildChatProductRecommendationContext } from "../server/chat-product-recommendation-service.js";
import { buildMascotProductContext } from "../server/mascot-product-context-service.js";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const target = new URL(String(url));
  if (target.hostname !== "127.0.0.1") throw new Error("External providers disabled in local product HTTP check");
  return nativeFetch(url, options);
};
const singleProductRequest = { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" };
const classifyShopping = async () => ({ route: "product_search", confident: true, confidence: .99, productRequest: singleProductRequest, replyBoundary: { salesAllowed: true, contactAllowed: true } });
const classifySizing = async () => ({ route: "product_question", topic: "sizing", confident: true, confidence: .99, needsLiveProductData: true, productRequest: singleProductRequest });

process.env.NODE_ENV = "test";
process.env.AIOVE_ALLOW_LOCAL_PRODUCT_SOURCE_SELF_CHECK = "true";

const seenRequests = [];
const productServer = createServer((req, res) => {
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  seenRequests.push(requestUrl);
  res.setHeader("Content-Type", "application/json");
  if (requestUrl.pathname === "/creator-products") {
    if (requestUrl.searchParams.get("intent") === "quick_product") {
      assert.equal(requestUrl.searchParams.get("q"), "recommended", "quick product action should send generic recommendation query");
    }
    const products = requestUrl.searchParams.get("q") === "messi"
      ? [
        {
          title: "MESSI New Away Kit",
          price: "GBP 59.99",
          publishedAt: "2026-06-01T00:00:00Z",
          url: `${baseProductUrl(requestUrl)}/messi-new-away-kit`,
        },
        {
          title: "MESSI New Home Kit",
          price: "GBP 59.99",
          publishedAt: "2026-07-01T00:00:00Z",
          url: `${baseProductUrl(requestUrl)}/messi-new-home-kit`,
        },
      ]
      : [
        {
          title: "FKK Old Home Kit",
          price: "GBP 49.99",
          publishedAt: "2025-01-01T00:00:00Z",
          url: `${baseProductUrl(requestUrl)}/fkk-old-home-kit`,
        },
        {
          title: "FKK New Away Kit",
          price: "GBP 59.99",
          publishedAt: "2026-06-01T00:00:00Z",
          url: `${baseProductUrl(requestUrl)}/fkk-new-away-kit`,
        },
        {
          title: "FKK New Home Kit",
          price: "GBP 59.99",
          publishedAt: "2026-07-01T00:00:00Z",
          url: `${baseProductUrl(requestUrl)}/fkk-new-home-kit`,
        },
      ];
    res.end(JSON.stringify({ products }));
    return;
  }
  if (requestUrl.pathname === "/user-products") {
    res.end(JSON.stringify({ products: [{ title: "GG Fallback Kit", price: "USD 49.99" }] }));
    return;
  }
  res.end(JSON.stringify({ products: [{ title: "FKK Picked Kit", price: "GBP 59.99" }] }));
});

await new Promise((resolve) => productServer.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${productServer.address().port}`;

try {
  const db = createFakeDb(baseUrl);

  const explicitContext = await buildMascotProductContext(db, {
    character: { id: "creator_dani", category_id: "creator", site_id: "site_fkk" },
    userId: "user_gg",
    userText: "Tell me about the kit",
    productTrigger: "quick_product",
  });

  assert.equal(explicitContext.searchIntent.explicitProductTrigger, true, "quick product action should preserve the explicit product trigger marker");
  assert.equal(explicitContext.searchIntent.shouldLoadProductContext, true, "quick product action should force product context");
  assert.equal(explicitContext.searchIntent.query, "shirt", "quick product action should keep meaningful product filter terms");
  assert.equal(explicitContext.products[0].name, "FKK New Home Kit", "quick product action should choose the newest matching product");
  assert.equal(explicitContext.products[1].name, "FKK New Away Kit", "quick product action should keep matching home and away products paired");
  assert.equal(explicitContext.siteSlug, "footballkituk", "creator product action should prefer the creator character bound site");
  assert.equal(seenRequests.at(-1).pathname, "/creator-products", "creator product action should call the creator site's product API");

  const genericChelseaChatContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "creator_dani", category_id: "creator", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_generic_chelsea",
    userText: "Show Chelsea 26 shirt",
    fetchProducts: async () => [
      { name: "PALMER #10 2026/27 Chelsea Home Soccer Jersey Blue", publishedAt: "2026-07-02T00:00:00Z" },
      { name: "2026/27 Chelsea Home Soccer Jersey Blue", publishedAt: "2026-07-01T00:00:00Z" },
    ],
  });
  assert.equal(genericChelseaChatContext.products[0].name, "2026/27 Chelsea Home Soccer Jersey Blue", "AI product messages should offer the unprinted base shirt before player-print variants for a generic request");

  const palmerChelseaChatContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "creator_dani", category_id: "creator", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_palmer_chelsea",
    userText: "Show Palmer Chelsea 26 shirt",
    fetchProducts: async () => [
      { name: "2026/27 Chelsea Home Soccer Jersey Blue", publishedAt: "2026-07-01T00:00:00Z" },
      { name: "PALMER #10 2026/27 Chelsea Home Soccer Jersey Blue", publishedAt: "2026-07-02T00:00:00Z" },
    ],
  });
  assert.equal(palmerChelseaChatContext.products[0].name, "PALMER #10 2026/27 Chelsea Home Soccer Jersey Blue", "AI product messages should still prioritize a specifically requested player-print shirt");

  const customizationGuidanceContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_customization_guidance",
    userText: "I mean customize the jersey I buy",
    fetchProducts: async () => { throw new Error("generic jersey-customization guidance must not search an arbitrary product"); },
  });
  assert.equal(customizationGuidanceContext?.sourceRef, "product-customization-guidance", "a generic jersey-customization question should use the product guidance context");
  assert.deepEqual(customizationGuidanceContext?.products, [], "generic jersey-customization guidance must not send an arbitrary product card");

  let sizingSearches = 0;
  const sizingGuidanceContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifySizing,
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_sizing_guidance",
    userText: "I am 5ft 8, but 180kg would a 4XL fit ok?",
    fetchProducts: async () => {
      sizingSearches += 1;
      return [];
    },
  });
  assert.equal(sizingGuidanceContext?.sourceRef, "site-product-sizing-guidance", "a fit question without a confirmed product must ask for the product instead of searching for a generic style");
  assert.deepEqual(sizingGuidanceContext?.products, [], "unanchored sizing guidance must not emit an arbitrary product card");
  assert.equal(sizingSearches, 0, "unanchored sizing guidance must not spend a product-source search");

  const sizingProduct = {
    id: "fkk-mu-away-2026",
    name: "Manchester United Away Soccer Jersey 2026/27 Blue",
    siteId: "site_fkk",
    siteSlug: "footballkituk",
    sizes: [{ label: "L" }, { label: "XL" }, { label: "2XL" }, { label: "3XL" }, { label: "4XL" }],
  };
  const currentProductSizingContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifySizing,
    resolveSizingProduct: async ({ product }) => ({ ...product, sizeChartResolved: true, sizeChart: null }),
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_current_product_sizing",
    userText: "I am 5ft 8, but 180kg would a 4XL fit ok?",
    recentMessages: [{ senderType: "character", contentType: "product", product: sizingProduct }],
    fetchProducts: async () => {
      throw new Error("a sizing follow-up for a confirmed product must not run a second product search");
    },
  });
  assert.equal(currentProductSizingContext?.sourceRef, "current-product-sizing-context", "a sizing follow-up should use the current confirmed product");
  assert.deepEqual(currentProductSizingContext?.products, [], "sizing follow-up should not duplicate the existing product card");
  assert.equal(currentProductSizingContext?.sizingProduct?.name, sizingProduct.name, "sizing follow-up should retain only the verified current product facts");

  let explicitSizingSearches = 0;
  const explicitSizingContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_explicit_product_sizing",
    userText: "Real Madrid away jersey size M",
    fetchProducts: async () => {
      explicitSizingSearches += 1;
      return [
        { name: "Real Madrid Away Soccer Jersey 2026/27", available: true, sizes: [{ label: "S", available: true }, { label: "M", available: true }] },
        { name: "Real Madrid Away Soccer Jersey 2026/27 Youth", available: true, sizes: [{ label: "L", available: true }] },
      ];
    },
  });
  assert.ok(explicitSizingSearches >= 1, "an explicit jersey plus size request must reach the trusted product source");
  assert.equal(explicitSizingContext?.sourceRef, "site-product-sizing-match", "an available requested size should retain a sizing-specific matched product context");
  assert.equal(explicitSizingContext?.products.length, 1, "only products with the requested available size may produce a product card");
  assert.equal(explicitSizingContext?.products[0]?.name, "Real Madrid Away Soccer Jersey 2026/27", "the product card must come from the size-verified product");

  const bodyMeasureProductContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_product_body_measurements",
    userText: "I am 180cm and need a Real Madrid away jersey",
    fetchProducts: async () => [
      { name: "Real Madrid Away Soccer Jersey 2026/27", available: true, sizes: [{ label: "S", available: true }, { label: "M", available: true }] },
    ],
  });
  assert.equal(bodyMeasureProductContext?.sourceRef, "site-product-sizing-match", "a concrete product request plus body measurements must still return the verified product card");
  assert.equal(bodyMeasureProductContext?.products.length, 1, "body measurements alone must not suppress a matched product card");
  assert.equal(bodyMeasureProductContext?.searchIntent?.hasBodyMeasurements, true, "the product context should retain the body-measurement safety marker");

  const unavailableSizingContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_unavailable_product_sizing",
    userText: "Real Madrid away jersey size M",
    fetchProducts: async () => [
      { name: "Real Madrid Away Soccer Jersey 2026/27", available: true, sizes: [{ label: "M", available: false }, { label: "L", available: true }] },
    ],
  });
  assert.equal(unavailableSizingContext?.sourceRef, "site-product-sizing-unavailable", "a matched jersey without the requested sellable size must not emit a product card");
  assert.deepEqual(unavailableSizingContext?.products, [], "an unavailable requested size must not be presented as purchasable");
  const sizingPrompt = buildChatReplyPrompt({
    character: { id: "mascot_fkk", name: "Millie", category_id: "mascot" },
    recentMessages: [],
    userText: "I am 5ft 8, but 180kg would a 4XL fit ok?",
    productContext: currentProductSizingContext,
  });
  assert.match(sizingPrompt.systemPrompt, /Do not infer measurements or guarantee fit/i, "current-product sizing prompts must prohibit unsupported measurements and fit advice");
  assert.match(sizingPrompt.systemPrompt, /do not infer a chart, body conversion or guaranteed fit/i, "the product-question prompt must prohibit invented charts and body conversions");
  assert.match(sizingPrompt.systemPrompt, /or guarantee fit/i, "current-product sizing prompts must prohibit fit guarantees");

  const exactKidsSizeContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_kids_age_size",
    userText: "Man united name and number 10 for 18 to 24 months",
    recentMessages: [{ senderType: "user", text: "Do u do kids size 18 to 24 months" }],
    fetchProducts: async () => [
      { name: "Authentic Manchester United Home Soccer Jersey 2026/27", sizes: [{ label: "S" }] },
      { name: "Kid's Manchester United Home Soccer Jersey 2026/27", sizes: [{ label: "#22 (8 Years)" }] },
    ],
  });
  assert.equal(exactKidsSizeContext?.sourceRef, "site-product-no-match", "an exact infant-size miss must remain a no-match context");
  assert.deepEqual(exactKidsSizeContext?.products, [], "an exact infant-size miss must never emit an adult or older-kids product card");

  const nearestKidsSizeContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_nearest_kids_age_size",
    userText: "I need a Manchester United kit for a 1 year old with number 14 printed on the back.",
    fetchProducts: async () => [
      { name: "Kids Manchester United Home Soccer Jersey", subtitle: "Manchester United", sku: "DCTZ,CTW001-16", sizes: [{ label: "#16 (2-3 Years)", available: true }] },
    ],
  });
  assert.equal(nearestKidsSizeContext?.products.length, 1, "chat should offer a closest real kids size when the exact age has no available variant");
  assert.deepEqual(nearestKidsSizeContext?.products?.[0]?.ageSizeFallback, {
    chartId: "order_fan_kids",
    sizeLabel: "#16",
    ageReference: "2–3",
    requestedAgeRange: "1 year",
  }, "nearest kids fallback must preserve the actual chart evidence for the follow-up wording");

  const mascotGiftContext = await buildMascotProductContext(db, {
    character: { id: "mascot_millie", category_id: "mascot", site_id: "site_fkk" },
    userId: "user_gg",
    userText: "Find a gift shirt",
    productTrigger: "quick_product",
  });
  assert.equal(mascotGiftContext.searchIntent.query, "shirt", "gift quick reply should use a broad shirt query");
  assert.equal(mascotGiftContext.products[0].name, "FKK New Home Kit", "mascot gift quick reply should return newest matching site product");
  assert.equal(mascotGiftContext.siteSlug, "footballkituk", "mascot product action should prefer the bound front-desk site");
  assert.equal(seenRequests.at(-1).pathname, "/creator-products", "mascot product action should call the bound site's product API");

  const naturalContext = await buildMascotProductContext(db, {
    character: { id: "creator_dani", category_id: "creator", site_id: "site_fkk" },
    userId: "user_gg",
    userText: "Do you have a Messi jersey?",
  });
  assert.equal(naturalContext.searchIntent.query, "messi", "natural Messi jersey request should reduce to the product keyword");
  assert.equal(naturalContext.searchIntent.intent, "recommendation", "natural product request should use recommendation intent");
  assert.equal(naturalContext.products[0].name, "MESSI New Home Kit", "natural product request should choose the newest matching product");
  assert.equal(naturalContext.products[1].name, "MESSI New Away Kit", "natural product request should keep matching home and away products paired");
  assert.equal(seenRequests.at(-1).searchParams.get("q"), "messi", "natural product request should send extracted product query");

  const normalContext = await buildMascotProductContext(db, {
    character: { id: "char_normal", category_id: "babe" },
    userId: "user_fkk",
    userText: "Tell me about the kit",
    productTrigger: "quick_product",
  });
  assert.equal(normalContext, null, "quick product action should still not work for normal characters");

  const prompt = buildChatReplyPrompt({
    character: { id: "creator_dani", name: "Dani", category_id: "creator" },
    recentMessages: [],
    userText: "Tell me about the kit",
    productContext: explicitContext,
  });
  assert.match(prompt.systemPrompt, /one short natural follow-up sentence matching the actual productCardDelivery cards/i, "product prompt should constrain its short natural follow-up to actually delivered cards");
  assert.match(prompt.systemPrompt, /Do not describe multiple kit evaluation criteria/i, "product prompt should prevent long generic kit explanation");
  assert.match(prompt.systemPrompt, /never cut the sentence short/i, "product prompt should prevent clipped or unfinished follow-up sentences");

  const hotContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "creator_dani", category_id: "creator", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_hot",
    userText: "Show me best sellers",
    productTrigger: "quick_product",
    fetchProducts: async () => [
      {
        id: "new-low-heat",
        name: "FKK New Low Heat Shirt",
        price: "GBP 59.99",
        publishedAt: "2026-07-05T00:00:00Z",
        url: "https://store.example/products/fkk-new-low-heat-shirt",
      },
      {
        id: "old-high-heat",
        name: "FKK Old High Heat Shirt",
        price: "GBP 49.99",
        publishedAt: "2025-01-01T00:00:00Z",
        url: "https://store.example/products/fkk-old-high-heat-shirt",
      },
    ],
  });
  assert.equal(hotContext.searchIntent.intent, "popular", "best-seller quick text should route to popular intent");
  assert.equal(hotContext.products[0].name, "FKK Old High Heat Shirt", "popular chat recommendations should prefer analytics heat before recency");

  const sourceErrorContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "creator_dani", category_id: "creator", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_source_error",
    userText: "Show me an England home shirt",
    fetchProducts: async () => {
      throw new Error("catalogue timeout");
    },
    searchCache: async () => ({ products: [], source: "cache", ageMs: null }),
  });
  assert.equal(sourceErrorContext.searchIntent.searchState, "source_error", "product source failures must not be disguised as a confirmed no-match");
  assert.equal(sourceErrorContext.searchOutcome, "source_error", "formal chat should preserve the source-error outcome");
  assert.deepEqual(sourceErrorContext.products, [], "source failures must never emit a product card");

  const missingSourceDb = {
    async execute(sql, values = []) {
      if (sql.includes("FROM sites") && sql.includes("WHERE s.id = ?")) {
        return [[{ id: values[0] || "site_missing", name: "Missing source", slug: "missing-source", product_api_url: "" }]];
      }
      return [[]];
    },
  };
  const missingSourceContext = await buildChatProductRecommendationContext(missingSourceDb, {
    classifyCommerce: classifyShopping,
    character: { id: "creator_missing", category_id: "creator", site_id: "site_missing" },
    userId: "user_missing",
    sessionId: "session_missing_source",
    userText: "Show me an England home shirt",
  });
  assert.equal(missingSourceContext.searchIntent.searchState, "source_error", "a missing formal product source must preserve the source-error state");
  assert.equal(missingSourceContext.searchOutcome, "source_error", "a missing formal product source must not be treated as no-match");

  const anotherContext = await buildChatProductRecommendationContext(db, {
    classifyCommerce: classifyShopping,
    character: { id: "creator_dani", category_id: "creator", site_id: "site_fkk" },
    userId: "user_gg",
    sessionId: "session_another",
    userText: "another one",
    fetchProducts: async () => [
      {
        id: "old-high-heat",
        name: "FKK Old High Heat Shirt",
        price: "GBP 49.99",
        publishedAt: "2025-01-01T00:00:00Z",
        url: "https://store.example/products/fkk-old-high-heat-shirt",
      },
      {
        id: "second-high-heat",
        name: "FKK Second High Heat Shirt",
        price: "GBP 54.99",
        publishedAt: "2026-01-01T00:00:00Z",
        url: "https://store.example/products/fkk-second-high-heat-shirt",
      },
    ],
  });
  assert.equal(anotherContext.searchIntent.intent, "popular", "alternative requests should reuse the previous product search pool");
  assert.equal(anotherContext.products[0].name, "FKK Second High Heat Shirt", "alternative requests should not repeat the product already shown in the session");

  const quickRepliesSource = readFileSync("src/features/chat/chat-quick-replies.js", "utf8");
  const quickReplySource = readFileSync("server/chat-quick-reply-service.js", "utf8");
  assert.match(quickReplySource, /productTrigger: PRODUCT_TRIGGER_QUICK/, "product quick replies should carry an explicit product trigger marker");
  assert.match(quickRepliesSource, /data-product-trigger="\$\{escapeAttribute\(productTrigger\)\}"/, "quick chip should render product trigger markers from API data");
  assert.match(readFileSync("src/features/chat/chat-page.js", "utf8"), /productTrigger:\s*button\.dataset\.productTrigger/, "quick chip submit should pass product trigger to the chat action");

  const chatServiceSource = readFileSync("src/services/chat-service.js", "utf8");
  assert.match(chatServiceSource, /productTrigger/, "chat service should forward product trigger to the backend");
  assert.match(readFileSync("src/app/chat-reply-scheduler.js", "utf8"), /const delayMs = productTrigger \? PRODUCT_FOLLOWUP_DELAY_MS : REPLY_DELAY_MS/, "product quick replies should use the shorter product follow-up delay");

  console.log("product message trigger self-check passed");
} finally {
  productServer.closeAllConnections?.();
  await new Promise((resolve) => productServer.close(resolve));
}

function createFakeDb(baseUrl) {
  return {
    async execute(sql, values = []) {
      if (sql.includes("FROM sites") && sql.includes("WHERE s.id = ?")) {
        const siteId = values[0];
        if (siteId === "site_fkk") {
          return [[{ id: "site_fkk", name: "FKK", slug: "footballkituk", product_api_url: `${baseUrl}/creator-products` }]];
        }
        if (siteId === "site_gg") {
          return [[{ id: "site_gg", name: "GG", slug: "gogoalshop", product_api_url: `${baseUrl}/user-products` }]];
        }
        return [[]];
      }
      if (sql.includes("FROM users u")) {
        const userId = values[0];
        if (userId === "user_gg") {
          return [[{ id: "site_gg", name: "GG", slug: "gogoalshop", product_api_url: `${baseUrl}/user-products` }]];
        }
        return [[]];
      }
      if (sql.includes("FROM sites") && sql.includes("is_default = 1")) {
        return [[{ id: "site_gg", name: "GG", slug: "gogoalshop", product_api_url: `${baseUrl}/gg-products` }]];
      }
      if (sql.includes("FROM user_memory_records")) {
        return [[]];
      }
      if (sql.includes("FROM product_analytics_events")) {
        return [[
          {
            product_id: "old-high-heat",
            product_url: "https://store.example/products/fkk-old-high-heat-shirt",
            product_title: "FKK Old High Heat Shirt",
            score: 12,
          },
          {
            product_id: "second-high-heat",
            product_url: "https://store.example/products/fkk-second-high-heat-shirt",
            product_title: "FKK Second High Heat Shirt",
            score: 9,
          },
          {
            product_id: "new-low-heat",
            product_url: "https://store.example/products/fkk-new-low-heat-shirt",
            product_title: "FKK New Low Heat Shirt",
            score: 1,
          },
        ]];
      }
      if (sql.includes("FROM chat_messages") && sql.includes("campaign_id")) {
        return [[]];
      }
      if (sql.includes("FROM chat_messages") && values[0] === "session_another") {
        return [[{
          product_payload_json: JSON.stringify({
            id: "old-high-heat",
            name: "FKK Old High Heat Shirt",
            siteId: "site_fkk",
            siteSlug: "footballkituk",
            url: "https://store.example/products/fkk-old-high-heat-shirt",
            searchIntent: {
              query: "recommended",
              intent: "popular",
              requestedProductType: "shirt",
            },
          }),
        }]];
      }
      if (sql.includes("FROM chat_messages")) {
        return [[]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

function baseProductUrl(requestUrl) {
  return `https://store.example${requestUrl.pathname}`;
}
