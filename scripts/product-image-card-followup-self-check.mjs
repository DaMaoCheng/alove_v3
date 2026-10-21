import assert from "node:assert/strict";
import { buildChatProductRecommendationContext, resolveCurrentProductImageCardContext } from "../server/chat-product-recommendation-service.js";
import { resolveGuestCurrentProductImageCardContext, resolveGuestProductRecommendation } from "../server/guest-chat-product-service.js";
import { maybeCreateChatImagePlaceholder, maybeCreateGuestChatImagePlaceholder } from "../server/chat-image-generation-service.js";

globalThis.fetch = async () => { throw new Error("External providers disabled in isolated product check"); };
const singleProductRequest = { relation: "single", action: "new", items: [], selectedIndex: null, selectionEvidence: "" };
const classifyProductImage = async () => ({ route: "product_question", topic: "other", confident: true, confidence: .99, needsLiveProductData: false, productRequest: singleProductRequest });
const product = {
  id: "p_england_white",
  name: "England Home Soccer Jersey World Cup 2026 White",
  url: "https://footballkituk.example/products/england-white",
  imageUrl: "https://footballkituk.example/images/england-white.jpg",
  siteId: "site_fkk",
  siteSlug: "footballkituk",
  searchIntent: { query: "England white shirt", requestedTeam: "England", requestedProductType: "shirt", requestedColor: "white" },
};
const recentMessages = [{ senderType: "character", contentType: "product", product, text: product.name }];
const site = { id: "site_fkk", name: "FKK", slug: "footballkituk", currency: "USD", product_api_url: "https://example.test/products" };
const db = {
  async execute(sql) {
    if (/FROM sites/.test(sql)) return [[site]];
    throw new Error(`unexpected SQL: ${sql}`);
  },
};

const accountContext = await buildChatProductRecommendationContext(db, {
  classifyCommerce: classifyProductImage,
  character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
  userText: "Send me a picture",
  recentMessages,
  fetchProducts: async () => { throw new Error("product image follow-up must not run a fresh catalog search"); },
});
assert.equal(accountContext?.sourceRef, "current-product-image-card");
assert.equal(accountContext?.products?.[0]?.name, product.name);

const guestResult = await resolveGuestProductRecommendation(db, {
  classifyCommerce: classifyProductImage,
  guest: { site_id: "site_fkk" },
  userText: "Send me a picture",
  recentMessages,
  searchProducts: async () => { throw new Error("guest product image follow-up must not run a fresh catalog search"); },
});
assert.equal(guestResult.context?.sourceRef, "guest-current-product-image-card");
assert.equal(guestResult.context?.products?.[0]?.imageUrl, product.imageUrl);

for (const invalidProduct of [
  { ...product, siteId: "site_gg", siteSlug: "gogoalshop" },
  { ...product, siteId: "", siteSlug: "footballkituk" },
  { ...product, siteId: "site_fkk", siteSlug: "" },
  { ...product, siteId: "site_fkk", siteSlug: "gogoalshop" },
]) {
  const invalidMessages = [{ senderType: "character", contentType: "product", product: invalidProduct, text: invalidProduct.name }];
  const accountInvalid = await resolveCurrentProductImageCardContext(db, {
    character: { id: "mascot_fkk", category_id: "mascot", site_id: "site_fkk" },
    userText: "Send me a picture",
    recentMessages: invalidMessages,
  });
  const guestInvalid = await resolveGuestCurrentProductImageCardContext(db, {
    guest: { site_id: "site_fkk" },
    userText: "Send me a picture",
    recentMessages: invalidMessages,
  });
  assert.equal(accountInvalid, null, "account product-card reuse must fail closed without exact site provenance");
  assert.equal(guestInvalid, null, "guest product-card reuse must fail closed without exact site provenance");
}

const noWriteDb = { async execute() { throw new Error("product image request must not create an image task or quota write"); } };
assert.equal(await maybeCreateChatImagePlaceholder(noWriteDb, { skipImageGeneration: true }), null);
assert.equal((await maybeCreateGuestChatImagePlaceholder(noWriteDb, { skipImageGeneration: true })).taskCreated, false);
console.log("product image card follow-up self-check passed");
