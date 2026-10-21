import assert from "node:assert/strict";
import {
  buildNoDiscountCheckoutUrl,
  calculateSelectedDiscountPrice,
  normalizeDiscountOffers,
  normalizeProductDiscountOffers,
  updateSelectedDiscountOffer,
} from "../src/features/chat/chat-product-panel-renderer.js";
import { resolveSelectedDiscountOfferIds } from "../src/features/chat/chat-product-panel-discounts.js";

const normalized = normalizeDiscountOffers([
  { id: "one", code: "SAVE10", offerDescription: "10% off" },
  { id: "duplicate", code: "save10", offerDescription: "duplicate" },
  { id: "two", code: "SAVE20", offerDescription: "20% off", displayLabel: "Site offer" },
  { id: "missing-description", code: "SAVE30" },
  { id: "missing-code", offerDescription: "30% off" },
]);

assert.deepEqual(normalized.map((offer) => offer.id), ["one", "two"], "invalid and case-insensitive duplicate offers should be removed");
assert.equal("displayLabel" in normalized[1], false, "automatic ownership labels must not enter product details");
assert.deepEqual(normalizeDiscountOffers([]), [], "empty offers should render as no offers");
assert.deepEqual(normalizeDiscountOffers(null), [], "invalid offers input should render as no offers");

const merged = normalizeProductDiscountOffers({
  code: "CAMPAIGN10",
  discountOffers: [{ id: "role-one", code: "ROLE20", offerDescription: "20% off" }],
});
assert.deepEqual(merged.map((offer) => offer.code), ["ROLE20", "CAMPAIGN10"], "legacy campaign code should be retained beside role offers");
assert.equal(normalizeProductDiscountOffers({ code: "ROLE20", discountOffers: [{ id: "role-one", code: "role20", offerDescription: "20% off" }] }).length, 1, "legacy duplicate code should be removed");
assert.equal(new URL(buildNoDiscountCheckoutUrl("https://footballkituk.com/cart/123:1?discount=OLD")).searchParams.get("discount"), "");

assert.deepEqual(
  resolveSelectedDiscountOfferIds(["role-one"], "role-one", [{ id: "role-one", code: "ROLE20", offerDescription: "20% off" }]),
  [],
  "clicking the selected offer again should clear the selection",
);
const root = {
  dataset: {
    productPanelProduct: JSON.stringify({
      discountOffers: [{ id: "role-one", code: "ROLE20", offerDescription: "20% off" }],
      selectedDiscountOfferId: "",
    }),
    productPanelLanguage: "English",
  },
  querySelector: () => null,
};
assert.equal(updateSelectedDiscountOffer(root, "role-one").selectedDiscountOfferId, "role-one");
assert.equal(updateSelectedDiscountOffer(root, "role-one").selectedDiscountOfferId, "", "a second click must cancel the selected offer");

const percentagePrice = calculateSelectedDiscountPrice({
  priceNow: "£36.00",
  selectedDiscountOfferId: "percentage",
  discountOffers: [{
    id: "percentage",
    code: "SAVE10",
    offerDescription: "10% off",
    pricingPreview: { type: "percentage", value: 10, currencyCode: "", appliesOnEachItem: false, eligible: true },
  }],
});
assert.equal(percentagePrice?.formatted, "£32.40", "percentage discount should calculate an estimated product price");

const fixedPrice = calculateSelectedDiscountPrice({
  priceNow: "£36.00",
  selectedDiscountOfferId: "fixed",
  discountOffers: [{
    id: "fixed",
    code: "SAVE5",
    offerDescription: "£5 off",
    pricingPreview: { type: "fixed_amount", value: 5, currencyCode: "GBP", appliesOnEachItem: true, eligible: true },
  }],
});
assert.equal(fixedPrice?.formatted, "£31.00", "per-item fixed discount should calculate in a matching currency");
const wholeOrderFixedPrice = calculateSelectedDiscountPrice({
  priceNow: "$46.99",
  currency: "USD",
  selectedDiscountOfferId: "whole-order-fixed",
  discountOffers: [{
    id: "whole-order-fixed",
    code: "TEST",
    offerDescription: "$0.01 off entire order",
    pricingPreview: { type: "fixed_amount", value: 0.01, currencyCode: "USD", appliesOnEachItem: false, eligible: true },
  }],
});
assert.equal(
  wholeOrderFixedPrice?.formatted,
  "$46.98",
  "a no-minimum whole-order fixed discount should update the single-item Buy now price",
);
assert.equal(calculateSelectedDiscountPrice({
  priceNow: "A$36.00",
  currency: "AUD",
  selectedDiscountOfferId: "fixed",
  discountOffers: [{
    id: "fixed",
    code: "SAVE5",
    offerDescription: "A$5 off",
    pricingPreview: { type: "fixed_amount", value: 5, currencyCode: "AUD", appliesOnEachItem: true, eligible: true },
  }],
})?.formatted, "A$31.00", "fixed discounts should support every explicit project currency, not only GBP/USD/EUR");
assert.equal(calculateSelectedDiscountPrice({
  priceNow: "$36.00",
  selectedDiscountOfferId: "fixed",
  discountOffers: [{
    id: "fixed",
    code: "SAVE5",
    offerDescription: "£5 off",
    pricingPreview: { type: "fixed_amount", value: 5, currencyCode: "GBP", appliesOnEachItem: true, eligible: true },
  }],
}), null, "fixed discounts must not calculate across mismatched currencies");

const sizePrice = calculateSelectedDiscountPrice({
  priceNow: "£36.00",
  sizes: [{ label: "S", price: "£36.00" }, { label: "L", price: "£40.00" }],
  selectedSizeIndex: 1,
  selectedDiscountOfferId: "percentage",
  discountOffers: [{
    id: "percentage",
    code: "SAVE10",
    offerDescription: "10% off",
    pricingPreview: { type: "percentage", value: 10, eligible: true },
  }],
});
assert.equal(sizePrice?.formatted, "£36.00", "switching to a differently priced size must recalculate from that size");

const priceNode = { innerHTML: "" };
const footPriceNode = { innerHTML: "" };
const noteNode = { textContent: "" };
const offerListNode = { innerHTML: "" };
const offerContainerNode = { hidden: false };
const domRoot = {
  dataset: {
    productPanelProduct: JSON.stringify({
      priceNow: "£36.00",
      discountOffers: [{
        id: "percentage",
        code: "SAVE10",
        offerDescription: "10% off",
        pricingPreview: { type: "percentage", value: 10, eligible: true },
      }],
      selectedDiscountOfferId: "",
    }),
    productPanelLanguage: "English",
  },
  querySelector(selector) {
    return {
      "[data-product-panel-price]": priceNode,
      "[data-product-panel-foot-price]": footPriceNode,
      "[data-product-panel-price-note]": noteNode,
      "[data-product-panel-offers]": offerContainerNode,
      "[data-product-panel-offers-list]": offerListNode,
    }[selector] || null;
  },
};
updateSelectedDiscountOffer(domRoot, "percentage");
assert.match(priceNode.innerHTML, /£32\.40/, "selecting an eligible offer must update the visible price");
updateSelectedDiscountOffer(domRoot, "percentage");
assert.match(priceNode.innerHTML, /£36\.00/, "cancelling the selected offer must restore the original visible price");
assert.doesNotMatch(priceNode.innerHTML, /estimate/, "cancelled price must not retain the estimate label");

console.log("chat product panel discount offers self-check passed");
