import assert from "node:assert/strict";
import { buildChatProductRecommendationContext } from "../server/chat-product-recommendation-service.js";

globalThis.fetch = async () => { throw new Error("External providers disabled in isolated product check"); };
const singleProductRequest = { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" };
const classifyShopping = async () => ({ route: "product_search", confident: true, confidence: .99, productRequest: singleProductRequest, replyBoundary: { salesAllowed: true, contactAllowed: true } });
const site = {
  id: "site_bs",
  name: "BS",
  slug: "bestsoccerstore",
  currency: "USD",
  product_api_url: "ttmall://api.example.test?websiteId=6",
  product_access_token_encrypted: "",
  payment_methods_json: "[]",
};

const db = {
  async execute(sql) {
    if (String(sql).includes("FROM sites") && String(sql).includes("WHERE s.id = ?")) return [[site]];
    throw new Error(`Unexpected self-check query: ${sql}`);
  },
};

const context = await buildChatProductRecommendationContext(db, {
  classifyCommerce: classifyShopping,
  searchCache: async () => ({ products: [], ageMs: null }),
  character: { id: "mascot_bs", category_id: "mascot", site_id: "site_bs" },
  userId: "",
  sessionId: "self-check",
  userText: "Do you have Sporting Clube de Portugal plus size replica jerseys?",
  recentMessages: [],
  fetchProducts: async () => [{
    id: "sporting-plus",
    name: "Sporting CP Home Replica Jersey Plus Size",
    url: "https://products.example.test/sporting-plus",
    sizes: [{ label: "2XL" }, { label: "3XL" }],
  }],
});

assert.equal(context?.siteSlug, "bestsoccerstore", "search should use the active BS site");
assert.equal(context?.searchIntent?.requestedSizeProfile, "plus_size", "plus-size profile should survive chat recommendation parsing");
assert.equal(context?.searchOutcome, "matched", "plus-size sizing intent without numeric size should search the catalogue");
assert.equal(context?.products?.[0]?.name, "Sporting CP Home Replica Jersey Plus Size", "verified extended-size product should be returned");

const alNassrContext = await buildChatProductRecommendationContext(db, {
  classifyCommerce: classifyShopping,
  searchCache: async () => ({ products: [], ageMs: null }),
  character: { id: "mascot_bs", category_id: "mascot", site_id: "site_bs" },
  userId: "",
  sessionId: "self-check-al-nassr",
  userText: "Cristiano Ronaldo Trikot Al Nassr",
  recentMessages: [],
  fetchProducts: async () => [{
    id: "al-nassr-ronaldo",
    name: "Al Nassr Cristiano Ronaldo Home Soccer Jersey 2026/27",
    url: "https://products.example.test/al-nassr-ronaldo",
    publishedAt: "2026-08-01T00:00:00.000Z",
  }],
});
assert.equal(alNassrContext?.searchIntent?.requestedTeam, "Al Nassr", "Al Nassr should be a deterministic catalogue team");
assert.equal(alNassrContext?.searchOutcome, "matched", "an anchored player/team request should return a verified product");
assert.equal(alNassrContext?.products?.[0]?.name, "Al Nassr Cristiano Ronaldo Home Soccer Jersey 2026/27", "player/team product should be shown as a card");

const typoContext = await buildChatProductRecommendationContext(db, {
  classifyCommerce: classifyShopping,
  searchCache: async () => ({ products: [], ageMs: null }),
  character: { id: "mascot_bs", category_id: "mascot", site_id: "site_bs" },
  userId: "",
  sessionId: "self-check-barcelona",
  userText: "ja",
  recentMessages: [{ senderType: "user", text: "I'm what's the bacelona shirt" }],
  fetchProducts: async () => [{
    id: "barcelona-home",
    name: "Barcelona Home Soccer Jersey 2026/27",
    url: "https://products.example.test/barcelona-home",
  }],
});
assert.equal(typoContext?.searchIntent?.query, "barcelona", "confirmed typo should use the corrected search query");
assert.equal(typoContext?.searchOutcome, "matched", "confirmed typo should complete the product search");
console.log("chat-product-recommendation-self-check: ok");
