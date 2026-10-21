import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSourceBundle } from "./source-bundle.mjs";
import { buildGuestProductRecommendationContext } from "../server/guest-chat-product-service.js";
import {
  applyGuestProductClarificationPromptPolicy,
  normalizeGuestReplyText,
} from "../server/guest-chat-output-policy.js";
import { parseStructuredReply } from "../server/ai-reply-contract-service.js";
import { markServerProductOrigins } from "../server/product-source-provenance.js";

// The producer requires an explicit, isolated commerce/scope contract.
globalThis.fetch = async () => { throw new Error("External providers disabled in guest product check"); };
const singleRequest = { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" };
const classifyShopping = async () => ({ route: "product_search", confident: true, confidence: .99, productRequest: singleRequest, replyBoundary: { salesAllowed: true, contactAllowed: true } });
const classifyChat = async () => ({ route: "chat", confident: true, confidence: .99, productRequest: { ...singleRequest, relation: "none" } });
const classifyAuthenticity = async () => ({ route: "store_policy", topic: "authenticity", confident: true, confidence: .99, needsLiveProductData: false, productRequest: { ...singleRequest, relation: "none" } });
const classifySizing = async () => ({ route: "product_question", topic: "sizing", confident: true, confidence: .99, needsLiveProductData: true, productRequest: singleRequest });

const guestServiceSource = readSourceBundle([
  "server/guest-chat-service.js",
  "server/guest-reply-service.js",
]);
const guestProductSource = readFileSync("server/guest-chat-product-service.js", "utf8");

assert.doesNotMatch(guestProductSource, /promotion_campaign|resolvePromotionCampaign/, "guest product selection must not load campaign context");
assert.match(guestProductSource, /WHERE id = \?/, "guest product lookup should use the frozen site id");
assert.match(guestProductSource, /guest_chat_enabled = 1/, "guest product lookup should stop when the site switch is disabled");
assert.match(guestProductSource, /strictSite: true/, "guest product lookup should never use default-site fallback");
assert.match(guestServiceSource, /contentType: "product"/, "guest replies should persist a product message when a trusted product is selected");
assert.match(guestServiceSource, /guest-product:\$\{prepared\.message\.id\}/, "guest product messages should be addressable by the triggering user message");
assert.doesNotMatch(guestServiceSource, /recordProductBubbleTriggered/, "guest product messages must not write formal product analytics");

let searched = null;
const db = {
  async execute(sql, values) {
    assert.match(sql, /FROM sites/, "guest product context should only query the frozen site configuration");
    assert.deepEqual(values, ["site_fkk"]);
    return [[{
      id: "site_fkk",
      name: "Football Kit UK",
      slug: "footballkituk",
      currency: "GBP",
      product_api_url: "https://footballkituk.com/products.json",
    }]];
  },
};
const context = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async (options) => {
    searched = options;
    return {
      ok: true,
      query: options.query,
      site: {
        id: "site_fkk",
        name: "Football Kit UK",
        slug: "footballkituk",
        storefrontUrl: "https://footballkituk.com",
      },
      items: [{
        id: "arsenal-shirt",
        name: "Arsenal Home Shirt",
        price: "£59.99",
        priceWas: "£99.99",
        url: "https://footballkituk.com/products/arsenal-home-shirt",
        imageUrl: "https://footballkituk.com/images/arsenal-home-shirt.jpg",
        campaignId: "campaign-secret",
        discountCode: "SAVE20",
        code: "SAVE20",
        tag: "20% off",
        features: ["Use SAVE20"],
        analytics: { userId: "must-not-leak" },
      }],
    };
  },
});

assert.equal(searched.siteSlug, "footballkituk");
assert.equal(searched.strictSite, true);
assert.equal(searched.allowNearestAgeFallback, true, "guest chat should explicitly allow a closest real age size only after exact age matching fails");
assert.equal(searched.searchIntent.requestedTeam, "Arsenal", "guest product search should receive the already-parsed intent instead of parsing the query a second time");
assert.equal(context.products.length, 1);
const serialized = JSON.stringify(context);
assert.doesNotMatch(serialized, /SAVE20|campaign-secret|priceWas|discountCode|must-not-leak|20% off/, "guest product context should strip promotions and analytics before prompt/storage use");
assert.equal(context.products[0].url, "https://footballkituk.com/products/arsenal-home-shirt");

const crossOriginContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async () => ({
    ok: true,
    site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
    items: [{
      id: "cross-origin-shirt",
      name: "Arsenal Home Shirt",
      price: "£59.99",
      url: "https://evil.example/products/arsenal-shirt",
      imageUrl: "https://evil.example/arsenal.jpg",
      sizes: [{ label: "M", buyUrl: "https://evil.example/cart/1" }],
    }],
  }),
});
assert.equal(crossOriginContext.products.length, 0, "a product with a cross-origin detail URL should be rejected instead of rendered");
assert.equal(crossOriginContext.sourceRef, "guest-site-product-no-match", "a rejected product must remain an explicit no-match instead of falling back to another product");

const mixedAssetContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async () => ({
    ok: true,
    site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
    items: [{
      id: "safe-link-shirt",
      name: "Arsenal Home Shirt",
      price: "£59.99",
      url: "https://footballkituk.com/products/arsenal-shirt",
      imageUrl: "https://evil.example/arsenal.jpg",
      imageUrls: ["https://cdn.shopify.com/s/files/arsenal.jpg", "https://evil.example/arsenal-2.jpg"],
      sizes: [{ label: "M", buyUrl: "https://evil.example/cart/1" }],
    }],
  }),
});
assert.equal(mixedAssetContext.products[0].imageUrl, "", "an unapproved image origin should be cleared");
assert.deepEqual(mixedAssetContext.products[0].imageUrls, ["https://cdn.shopify.com/s/files/arsenal.jpg"], "the approved Shopify CDN should remain available");
assert.equal(mixedAssetContext.products[0].sizes[0].buyUrl, "", "a cross-origin size checkout URL should be cleared");

const sourceOwnedCustomDomainResult = {
  ok: true,
  site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://fbed87-94.myshopify.com" },
  items: [{
    id: "custom-domain-shirt",
    name: "Arsenal Custom Domain Shirt",
    price: "£59.99",
    url: "https://footballkituk.com/products/arsenal-custom-domain-shirt",
    imageUrl: "https://cdn.shopify.com/s/files/arsenal-custom-domain-shirt.jpg",
  }],
};
markServerProductOrigins(sourceOwnedCustomDomainResult, sourceOwnedCustomDomainResult.items);
const sourceOwnedCustomDomainContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async () => sourceOwnedCustomDomainResult,
});
assert.equal(sourceOwnedCustomDomainContext.products[0].url, "https://footballkituk.com/products/arsenal-custom-domain-shirt", "a custom storefront URL should only pass when marked by the server product source");

const promotionalTitleContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async () => ({
    ok: true,
    site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
    items: [{
      id: "promo-shirt",
      name: "Arsenal Shirt 20% Off SAVE20",
      price: "£59.99",
      url: "https://footballkituk.com/products/arsenal-shirt?discount=SAVE20",
    }],
  }),
});
assert.equal(promotionalTitleContext.products.length, 0, "a product with promotion data embedded in allowed string fields should be skipped entirely");
assert.equal(promotionalTitleContext.sourceRef, "guest-site-product-no-match", "a rejected promotional product must not be replaced by an unrelated fallback");

let nonIntentSearches = 0;
const noContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "How was your morning?",
  classifyCommerce: classifyChat,
  searchProducts: async () => {
    nonIntentSearches += 1;
    return { items: [] };
  },
});
assert.equal(noContext, null, "normal guest chat should not query products");
assert.equal(nonIntentSearches, 0, "normal guest chat should avoid product source cost");

let customerServiceSearches = 0;
const customerServiceContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "the jersey is authentic or fake?",
  classifyCommerce: classifyAuthenticity,
  searchProducts: async () => {
    customerServiceSearches += 1;
    return { items: [] };
  },
});
assert.equal(customerServiceContext, null, "customer-service authenticity questions should not request product context");
assert.equal(customerServiceSearches, 0, "customer-service authenticity questions must not spend a guest product-source request");

const emptyContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async () => ({
    ok: true,
    site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
    items: [],
  }),
});
assert.equal(emptyContext.products.length, 0, "an empty trusted product source must remain an explicit no-match");
assert.equal(emptyContext.sourceRef, "guest-site-product-no-match");

let guestSizingSearches = 0;
const guestSizingGuidanceContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "I am 5ft 8, but 180kg would a 4XL fit ok?",
  classifyCommerce: classifySizing,
  searchProducts: async () => {
    guestSizingSearches += 1;
    return { items: [] };
  },
});
assert.equal(guestSizingGuidanceContext.sourceRef, "guest-site-product-sizing-guidance", "guest fit questions without a product should ask which kit they mean before searching");
assert.deepEqual(guestSizingGuidanceContext.products, [], "guest fit guidance must not emit an arbitrary product card");
assert.equal(guestSizingSearches, 0, "guest fit guidance must not call the product source without a product anchor");

const guestSizingProduct = {
  id: "guest-mu-away-2026",
  name: "Manchester United Away Soccer Jersey 2026/27 Blue",
  siteId: "site_fkk",
  siteSlug: "footballkituk",
  sizes: [{ label: "L" }, { label: "XL" }, { label: "2XL" }, { label: "3XL" }, { label: "4XL" }],
};
const guestCurrentProductSizingContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "I am 5ft 8, but 180kg would a 4XL fit ok?",
  classifyCommerce: classifySizing,
  recentMessages: [{ senderType: "character", contentType: "product", product: guestSizingProduct }],
  resolveSizingProduct: async ({ product }) => ({ ...product, sizeChart: null, sizeChartResolved: false }),
  searchProducts: async () => {
    throw new Error("guest sizing follow-up for a current product must not re-search");
  },
});
assert.equal(guestCurrentProductSizingContext.sourceRef, "guest-current-product-sizing-context", "guest fit follow-ups should prioritize the current confirmed product");
assert.deepEqual(guestCurrentProductSizingContext.products, [], "guest sizing follow-ups should not duplicate product cards");
assert.equal(guestCurrentProductSizingContext.sizingProduct?.name, guestSizingProduct.name, "guest sizing follow-ups should retain verified product facts");

let guestExplicitSizingSearches = 0;
const guestExplicitSizingContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Real Madrid away jersey XSML",
  classifyCommerce: classifyShopping,
  searchProducts: async () => {
    guestExplicitSizingSearches += 1;
    return {
      ok: true,
      site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
      items: [
        { name: "Real Madrid Away Soccer Jersey 2026/27", url: "https://footballkituk.com/products/real-madrid-away", available: true, sizes: [{ label: "XS", available: true }, { label: "M", available: true }, { label: "L", available: true }] },
        { name: "Real Madrid Away Soccer Jersey 2026/27 Youth", url: "https://footballkituk.com/products/real-madrid-away-youth", available: true, sizes: [{ label: "2XL", available: true }] },
      ],
    };
  },
});
assert.equal(guestExplicitSizingSearches, 1, "a guest request with a product anchor and standard sizes must search the trusted source");
assert.equal(guestExplicitSizingContext.sourceRef, "guest-site-product-sizing-match", "a guest must receive a product context only after the requested size is verified as available");
assert.equal(guestExplicitSizingContext.products.length, 1, "guest product cards must exclude products missing every requested sellable size");

const guestUnavailableSizingContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Real Madrid away jersey size M",
  classifyCommerce: classifyShopping,
  searchProducts: async () => ({
    ok: true,
    site: { id: "site_fkk", slug: "footballkituk", storefrontUrl: "https://footballkituk.com" },
    items: [{ name: "Real Madrid Away Soccer Jersey 2026/27", url: "https://footballkituk.com/products/real-madrid-away", available: true, sizes: [{ label: "M", available: false }] }],
  }),
});
assert.equal(guestUnavailableSizingContext.sourceRef, "guest-site-product-sizing-unavailable", "an unavailable guest size must have a deterministic no-card outcome");
assert.deepEqual(guestUnavailableSizingContext.products, [], "an unavailable guest size must never create a product bubble");

const originalWarn = console.warn;
let sourceWarnings = 0;
console.warn = () => {
  sourceWarnings += 1;
};
const failedContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async () => {
    throw new Error("synthetic product source failure");
  },
});
console.warn = originalWarn;
assert.equal(failedContext.searchIntent.searchState, "source_error", "a failed guest product source must preserve the source-error state");
assert.equal(failedContext.searchOutcome, "source_error", "a failed guest product source must not be disguised as a confirmed no-match");
assert.deepEqual(failedContext.products, [], "a failed guest product source must never emit a product card");
assert.equal(sourceWarnings, 1, "a failed product source should be recorded instead of silently swallowed");

const structuredSourceErrorContext = await buildGuestProductRecommendationContext(db, {
  guest: { site_id: "site_fkk" },
  userText: "Show me an Arsenal shirt",
  classifyCommerce: classifyShopping,
  searchProducts: async () => ({
    ok: true,
    site: { id: "site_fkk", slug: "footballkituk" },
    items: [],
    searchState: "source_error",
    searchOutcome: "source_error",
  }),
});
assert.equal(structuredSourceErrorContext.searchIntent.searchState, "source_error");
assert.equal(structuredSourceErrorContext.searchOutcome, "source_error");
assert.equal(structuredSourceErrorContext.sourceRef, "guest-site-product-source-error");

const clarificationPrompt = applyGuestProductClarificationPromptPolicy({
  systemPrompt: "Base persona",
  layers: [],
}, {
  productRequested: true,
  product: null,
  searchIntent: { requestedProductType: "shirt", searchState: "needs_clarification" },
});
assert.match(clarificationPrompt.systemPrompt, /No live product was confirmed/i, "the model should know that trusted product search returned no result");
assert.match(clarificationPrompt.systemPrompt, /warm, playful, direct, or encouraging/i, "the model should select a bounded tone from the active character");
assert.match(clarificationPrompt.systemPrompt, /both displayText and speechText to exactly this internal token/i, "the bounded token must fit the global structured reply contract");
assert.deepEqual(
  applyGuestProductClarificationPromptPolicy({ systemPrompt: "Base persona", layers: [] }, {
    productRequested: true,
    product: { name: "Trusted shirt" },
  }),
  { systemPrompt: "Base persona", layers: [] },
  "a trusted product result should not receive the no-result clarification policy"
);
assert.deepEqual(
  applyGuestProductClarificationPromptPolicy({ systemPrompt: "Base persona", layers: [] }, {
    productRequested: true,
    product: null,
    searchIntent: {
      requestedTeam: "Liverpool",
      requestedProductType: "shirt",
      searchState: "ready_to_search",
    },
  }),
  { systemPrompt: "Base persona", layers: [] },
  "a complete trusted no-match should use the terminal no-match path instead of clarification"
);
assert.deepEqual(
  applyGuestProductClarificationPromptPolicy({ systemPrompt: "Base persona", layers: [] }, {
    productRequested: true,
    product: null,
    searchIntent: { customerServiceKnowledgeRequest: true },
  }),
  { systemPrompt: "Base persona", layers: [] },
  "customer-service knowledge questions must not receive a no-product clarification prompt"
);
const structuredToneReply = parseStructuredReply(JSON.stringify({
  displayText: "[guest_product_clarification:playful]",
  speechText: "[guest_product_clarification:playful]",
  voiceMeta: {},
}), {}).normalizedText;
assert.equal(
  normalizeGuestReplyText({
    text: structuredToneReply,
    product: null,
    productRequested: true,
    productSearchIntent: { requestedProductType: "shirt", searchState: "needs_clarification" },
    userText: "Show me a shirt",
  }),
  "Not quite a clean match this time — give me one more clue and I’ll take another shot. Which team or player should I focus on?",
  "the global structured reply parser should preserve the bounded tone selection through final normalization"
);

const sampleProduct = context.products[0];
assert.equal(
  normalizeGuestReplyText({
    text: "Someone around 180 cm and 180 kg would usually need 4XL.",
    product: null,
    productRequested: true,
    productSearchIntent: { intent: "sizing", searchState: "needs_clarification" },
    productContextSourceRef: "guest-site-product-sizing-guidance",
    languageCode: "tr",
    userText: "180 kilo için 4XL olur mu?",
  }),
  "Hangi takım, forma veya belirli ürün için beden konusunda yardım istersin?",
  "unanchored sizing requests must ask for one concrete product in the active site language instead of inferring a size"
);
assert.equal(
  normalizeGuestReplyText({
    text: "Someone around 180 cm and 180 kg would usually need 4XL.",
    product: null,
    productRequested: true,
    productSearchIntent: { intent: "sizing", searchState: "ready_to_search" },
    productContextSourceRef: "guest-current-product-sizing-context",
    sizingProduct: { name: "Manchester United Away Soccer Jersey", sizes: ["S", { label: "M" }, { label: "L" }, { label: "XL" }, { label: "2XL" }, { label: "3XL" }, { label: "4XL" }] },
    languageCode: "en",
    userText: "Would 4XL fit me at 5ft 8 and 180kg?",
  }),
  "The listed sizes for this jersey are S, M, L, XL, 2XL, 3XL, 4XL. I can’t confirm fit from height or weight alone — what size do you usually wear?",
  "current-product sizing requests must use only the confirmed listed sizes and decline unsupported body-based fit claims"
);
assert.equal(
  normalizeGuestReplyText({ text: "Use SAVE20 for this one.", product: sampleProduct, userText: "Show me a shirt" }),
  "Discounts are available after you create an account.",
  "the final product follow-up pipeline should strip a generated code before persistence"
);
assert.equal(
  normalizeGuestReplyText({ text: "优惠码是 ABC10", product: null, userText: "有优惠吗" }),
  "Discounts are available after you create an account.",
  "the final ordinary-text pipeline should strip a Chinese code reply before persistence"
);
assert.equal(
  normalizeGuestReplyText({
    text: "[guest_product_clarification: playful]",
    product: null,
    productRequested: true,
    productSearchIntent: { requestedProductType: "shirt", searchState: "needs_clarification" },
    userText: "Show me a shirt",
  }),
  "Not quite a clean match this time — give me one more clue and I’ll take another shot. Which team or player should I focus on?",
  "a valid internal tone token should render a controlled role-flavored clarification"
);
assert.equal(
  normalizeGuestReplyText({
    text: "I can answer the authenticity question from the available service guidance.",
    product: null,
    productRequested: true,
    productSearchIntent: { customerServiceKnowledgeRequest: true },
    skipProductClarification: true,
    userText: "the jersey is authentic or fake?",
  }),
  "I can answer the authenticity question from the available service guidance.",
  "customer-service knowledge replies must survive guest product clarification normalization"
);
assert.equal(
  normalizeGuestReplyText({
    text: "I found the Liverpool Home Shirt for £59.99 and it’s in stock. Want the link?",
    productSearchOutcome: "no_match",
    product: null,
    productRequested: true,
    productSearchIntent: {
      requestedTeam: "Liverpool",
      requestedProductType: "shirt",
      searchState: "ready_to_search",
    },
    userText: "Show me a Liverpool shirt",
  }),
  "Sorry, I couldn’t find a confirmed match for those details. You can also try the search page.",
  "arbitrary product, price, stock, or link prose should fall back to a terminal no-match reply"
);
assert.equal(
  normalizeGuestReplyText({
    text: "API failed, but footballkituk.com has a Barcelona away jersey ready.",
    productSearchOutcome: "no_match",
    product: null,
    productRequested: true,
    productSearchIntent: {
      requestedTeam: "Spain",
      requestedProductType: "shirt",
      searchState: "ready_to_search",
    },
    userText: "我想看看西班牙球衣",
  }),
  "抱歉，我按这些条件暂时没有找到可以确认的商品。你也可以到搜索页面再试一次。",
  "internal failures, bare domains, cross-team products, and availability claims should never reach the user"
);
assert.equal(
  normalizeGuestReplyText({
    text: "I couldn’t confirm one yet. Which size do you need? Home or away?",
    productSearchOutcome: "no_match",
    product: null,
    productRequested: true,
    productSearchIntent: {
      requestedTeam: "Liverpool",
      requestedProductType: "shirt",
      searchState: "ready_to_search",
    },
    userText: "Show me a Liverpool shirt",
  }),
  "Sorry, I couldn’t find a confirmed match for those details. You can also try the search page.",
  "arbitrary multi-question prose should fall back to one terminal no-match reply"
);
assert.equal(
  normalizeGuestReplyText({
    text: "Someone around 180 cm and 180 kg would usually need 4XL, with a 110 cm chest.",
    productSearchOutcome: "no_match",
    product: null,
    productRequested: true,
    productSearchIntent: {
      requestedProductType: "shirt",
      searchState: "ready_to_search",
    },
    userText: "I need an adult shirt around 180 cm",
  }),
  "Sorry, I couldn’t find a confirmed match for those details. You can also try the search page.",
  "terminal no-match replies must reject unsupported body-measurement and size advice"
);
assert.equal(
  normalizeGuestReplyText({
    text: "[guest_product_clarification:warm]",
    product: null,
    productRequested: true,
    productSearchIntent: {
      requestedProductType: "shirt",
      searchState: "needs_clarification",
    },
    userText: "我想看看西班牙球衣",
  }),
  "我暂时还没确认到合适的商品，我们一起再缩小一点范围吧。你想先看哪个球队或球员的款式？",
  "a Chinese request should render the bounded tone in the user language"
);
assert.equal(
  normalizeGuestReplyText({
    text: "[guest_product_clarification:direct]",
    product: null,
    productRequested: true,
    productSearchIntent: {
      requestedProductType: "shirt",
      searchState: "needs_clarification",
      correctionSuggestion: { original: "golie", corrected: "goalie", correctedText: "goalie kits" },
    },
    userText: "Do you have golie kits?",
  }),
  "Did you mean “goalie kits”?",
  "a pending high-confidence typo must use one deterministic confirmation question"
);
assert.equal(
  normalizeGuestReplyText({
    text: "No products were found.",
    product: null,
    productRequested: true,
    productSearchIntent: {
      requestedTeam: "England",
      requestedProductType: "shirt",
      searchState: "source_error",
    },
    userText: "Show me an England shirt",
  }),
  "Product search is temporarily unavailable. Please try again later.",
  "a product-source failure must not be presented as a confirmed catalogue no-match"
);
assert.equal(
  normalizeGuestReplyText({
    text: "That sounds like a brilliant match.",
    product: null,
    productRequested: false,
    userText: "Did you watch the match?",
  }),
  "That sounds like a brilliant match.",
  "ordinary guest chat should stay outside the product clarification policy"
);

console.log("guest product message self-check passed");
