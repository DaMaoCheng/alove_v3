import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareProductForGuest } from "../src/features/chat/chat-product-panel-hydration.js";

const panelTemplateSource = readFileSync("src/features/chat/chat-product-panel-template.js", "utf8");
const panelRendererSource = readFileSync("src/features/chat/chat-product-panel-renderer.js", "utf8");
const panelDiscountSource = readFileSync("src/features/chat/chat-product-panel-discounts.js", "utf8");
const chatCss = readFileSync("src/features/app-shell/styles/chat.css", "utf8");

assert.match(
  panelTemplateSource,
  /data-product-panel-code hidden/,
  "product detail code area should be hidden by default"
);
assert.match(
  panelRendererSource,
  /const codeText = normalizedProduct\.code \|\| normalizedProduct\.discountCode \|\| ""/,
  "product detail code area should accept product discountCode fallback"
);
assert.match(
  panelRendererSource,
  /code\.hidden = !codeText \|\| normalizeDiscountOffers\(normalizedProduct\.discountOffers\)\.length > 0/,
  "product detail code area should only show when the product has a code text"
);
assert.match(panelDiscountSource, /function normalizeDiscountOffers\(value = \[\]\)/, "product detail should normalize multiple offers");
assert.match(panelDiscountSource, /data-product-discount-copy=/, "each offer should expose a copy action");
assert.match(panelDiscountSource, /data-product-discount-use=/, "each offer should expose an explicit selection action");
assert.match(panelDiscountSource, /offer\.code\.toLowerCase\(\)/, "duplicate offer codes should be removed case-insensitively");
assert.match(
  chatCss,
  /\.pp-code\[hidden\]\s*\{\s*display:\s*none\s*;/,
  "product detail code CSS should not override the hidden attribute"
);
assert.match(chatCss, /\.pp-offers\s*\{/, "product detail multi-offer section should have scoped styles");
assert.match(chatCss, /\.pp-offer\.is-selected\s*\{/, "selected offer should have a visible state");

const productWithOffers = {
  code: "LEGACY",
  discountCode: "SAVE20",
  discountOffers: [{ id: "offer-1", code: "SAVE20" }],
  selectedDiscountOfferId: "offer-1",
  name: "Test product",
};
assert.deepEqual(
  prepareProductForGuest(productWithOffers, true),
  {
    ...productWithOffers,
    code: "",
    discountCode: "",
    discountOffers: [],
    selectedDiscountOfferId: "",
  },
  "guest product details should remove legacy codes, offer lists, and selection state",
);
assert.equal(
  prepareProductForGuest(productWithOffers, false),
  productWithOffers,
  "authenticated product details should retain the original offer payload",
);

console.log("chat product panel code visibility self-check passed");
