import assert from "node:assert/strict";
import { resolveProductSizingGuidanceReply } from "../server/product-sizing-guidance-service.js";

const currentProductReply = resolveProductSizingGuidanceReply({
  sourceRef: "current-product-sizing-context",
  sizingProduct: {
    name: "Manchester United Away Soccer Jersey 2026/27",
    sizes: ["S", { label: "M" }, { label: "4XL" }],
  },
}, {
  languageCode: "en",
  userText: "I am 5ft 8 and 180kg, would a 4XL fit?",
});
assert.match(currentProductReply, /S, M, 4XL/, "current-product sizing guidance should expose only the product's listed sizes");
assert.match(currentProductReply, /can’t confirm fit from height or weight alone/i, "current-product sizing guidance must reject body-measurement inference");
assert.doesNotMatch(currentProductReply, /chest|recommend(?:ed)?\s+(?:a\s+)?4xl/i, "current-product sizing guidance must not invent a body measurement or size recommendation");

const matchedProductReply = resolveProductSizingGuidanceReply({
  sourceRef: "site-product-sizing-match",
  sizingProduct: {
    name: "Real Madrid Away Soccer Jersey 2026/27",
    sizes: [{ label: "S", available: true }, { label: "M", available: true }, { label: "L", available: false }],
  },
  requestedSizes: ["M"],
}, {
  languageCode: "en",
  userText: "Real Madrid away jersey size M",
});
assert.match(matchedProductReply, /M currently listed as available/i, "a size-verified product context should confirm only the source-listed available option");
assert.doesNotMatch(matchedProductReply, /L/, "unavailable variant labels must not be represented as available in sizing copy");

const partialMatchedSizesReply = resolveProductSizingGuidanceReply({
  sourceRef: "site-product-sizing-match",
  sizingProduct: {
    name: "Real Madrid Away Soccer Jersey 2026/27",
    sizes: [{ label: "M", available: true }],
  },
  requestedSizes: ["XS", "M", "L"],
}, {
  languageCode: "en",
  userText: "Real Madrid away jersey XSML",
});
assert.match(partialMatchedSizesReply, /with M currently listed as available/i, "a partial multi-size match must name only the sellable requested size");
assert.doesNotMatch(partialMatchedSizesReply, /XS, M, L/, "a partial multi-size match must not claim every requested size is sellable");

const unavailableProductReply = resolveProductSizingGuidanceReply({
  sourceRef: "guest-site-product-sizing-unavailable",
  requestedSizes: ["M"],
}, {
  languageCode: "en",
  userText: "Real Madrid away jersey size M",
});
assert.match(unavailableProductReply, /M is not currently listed as an available option/i, "an unavailable requested size should get a deterministic no-card explanation");

const unanchoredTurkishReply = resolveProductSizingGuidanceReply({
  sourceRef: "guest-site-product-sizing-guidance",
}, {
  languageCode: "tr",
  userText: "4XL bana olur mu?",
});
assert.equal(unanchoredTurkishReply, "Hangi takım, forma veya belirli ürün için beden konusunda yardım istersin?", "unanchored sizing guidance should request a concrete product in the site's language");

assert.equal(resolveProductSizingGuidanceReply({ sourceRef: "product_api" }, { languageCode: "en" }), "", "ordinary product contexts must keep their existing reply path");

console.log("product sizing guidance self-check passed");
