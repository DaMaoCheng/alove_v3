import assert from "node:assert/strict";
import { normalizeProductPanelPayload } from "../src/features/chat/chat-product-panel-payload.js";

const product = {
  id: "product-1",
  name: "Spain Away Shirt",
  price: "£46.99",
  currency: "GBP",
  description: "Lightweight match shirt",
  imageUrl: "/assets/product-main.png",
  imageUrls: ["/assets/product-main.png", "/assets/product-back.png"],
  siteIconUrl: "/assets/site-icon.png",
  discountOffers: [{ id: "offer-1", code: "SAVE10", offerDescription: "10% off" }],
  customizationOptions: [{ id: "patch", name: "Patch List", type: "dropdown", values: [] }],
  sizes: [{ label: "M", available: true }],
  livePriceFetchedAt: "2026-07-23T00:00:00.000Z",
  messageId: "product-message",
  characterId: "product-character",
  characterName: "Product Character",
  ownerUserId: "product-owner",
  productAccessToken: "must-not-reach-dom",
  product_access_token_encrypted: "must-not-reach-dom",
  providerRaw: { secret: true },
};

const searchPayload = normalizeProductPanelPayload(product);
const kitshopPayload = normalizeProductPanelPayload(product, {
  site: {
    id: "site-1",
    slug: "footballkituk",
    siteUrl: "https://footballkituk.com",
    paymentMethods: ["shop-pay"],
  },
});
const chatPayload = normalizeProductPanelPayload(product, {
  chatContext: {
    message: { id: "message-1", characterId: "message-character" },
    character: { id: "character-1", name: "Luna", ownerUserId: "creator-1" },
  },
});

for (const payload of [searchPayload, kitshopPayload, chatPayload]) {
  assert.equal(payload.id, "product-1");
  assert.equal(payload.productId, "product-1");
  assert.equal(payload.priceNow, "£46.99");
  assert.equal(payload.currency, "GBP");
  assert.equal(payload.summary, "Lightweight match shirt");
  assert.equal(payload.discountOffers[0].code, "SAVE10");
  assert.equal(payload.customizationOptions[0].id, "patch");
  assert.equal(payload.sizes[0].label, "M");
  assert.equal(payload.siteLogoUrl, "/assets/site-icon.png");
  assert.equal(payload.livePriceFetchedAt, "2026-07-23T00:00:00.000Z");
}

assert.equal(kitshopPayload.siteId, "site-1", "Kitshop should fill missing site ownership from its shelf context");
assert.equal(kitshopPayload.siteSlug, "footballkituk");
assert.equal(kitshopPayload.siteUrl, "https://footballkituk.com");
assert.deepEqual(kitshopPayload.paymentMethods, ["shop-pay"]);

for (const payload of [searchPayload, kitshopPayload]) {
  assert.equal("messageId" in payload, false, "non-chat entry points must not receive message context");
  assert.equal("characterId" in payload, false, "non-chat entry points must not receive character context");
  assert.equal("characterName" in payload, false, "non-chat entry points must not receive character identity");
  assert.equal("ownerUserId" in payload, false, "non-chat entry points must not receive creator ownership context");
}

for (const payload of [searchPayload, kitshopPayload, chatPayload]) {
  assert.equal("productAccessToken" in payload, false, "product tokens must not enter panel payloads");
  assert.equal("product_access_token_encrypted" in payload, false, "encrypted provider config must not enter panel payloads");
  assert.equal("providerRaw" in payload, false, "unknown provider internals must not enter panel payloads");
}

assert.equal(chatPayload.messageId, "product-message");
assert.equal(chatPayload.characterId, "product-character");
assert.equal(chatPayload.characterName, "Product Character");
assert.equal(chatPayload.ownerUserId, "product-owner");

const contextualChatPayload = normalizeProductPanelPayload({
  id: "product-2",
  name: "Context Product",
}, {
  chatContext: {
    message: { id: "message-2", characterId: "message-character" },
    character: { id: "character-2", name: "Mia", ownerUid: "creator-2" },
  },
});
assert.equal(contextualChatPayload.messageId, "message-2");
assert.equal(contextualChatPayload.characterId, "message-character");
assert.equal(contextualChatPayload.characterName, "Mia");
assert.equal(contextualChatPayload.ownerUserId, "creator-2");

console.log("product panel payload contract self-check passed");
