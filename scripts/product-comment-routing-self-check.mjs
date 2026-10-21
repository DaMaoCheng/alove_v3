import assert from "node:assert/strict";

process.env.TYPESAFE_API_KEY = "self-check-typesafe-key";
process.env.TYPESAFE_BASE_URL = "https://typesafe.self-check.invalid/v1";

const { classifyProductIntent } = await import("../server/product-intent-classifier-service.js");
const { buildProductSearchIntent } = await import("../server/product-intent-service.js");
const { normalizeGuestReplyText } = await import("../server/guest-chat-output-policy.js");

function jevResponse({ route, routeConfidence = 0.93, productRequest, productAction }) {
  return new Response(JSON.stringify({
    model: "jev-self-check",
    answers: {
      route: { choice: route, confidence: routeConfidence },
      product_request: { noul: productRequest },
      product_action: { noul: productAction },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

const comment = await classifyProductIntent("Bonito bikini", {
  fetchImpl: async () => jevResponse({ route: "daily_chat", productRequest: 0.19, productAction: 0.08 }),
});
assert.equal(comment.isProductRequest, false, "a product mention used as a comment must stay ordinary chat");
assert.equal(comment.productAction, 0.08);

const spanishRequest = await classifyProductIntent("¿Tienen bikinis?", {
  fetchImpl: async () => jevResponse({ route: "product_request", productRequest: 0.95, productAction: 0.91 }),
});
assert.equal(spanishRequest.isProductRequest, true, "an explicit Spanish product request must search");

const deterministicComment = buildProductSearchIntent("Bonito bikini");
assert.equal(deterministicComment.shouldLoadProductContext, false);
assert.equal(deterministicComment.searchState, "not_product");

const deterministicMadrid = buildProductSearchIntent("Una camisetas del Madrid talla 4xxl");
assert.equal(deterministicMadrid.shouldLoadProductContext, true);
assert.equal(deterministicMadrid.intent, "sizing");

const localizedNoMatch = normalizeGuestReplyText({
  text: "I am checking the catalogue now.",
  productRequested: true,
  product: null,
  productSearchIntent: { searchState: "ready_to_search" },
  productSearchOutcome: "no_match",
  languageCode: "es",
  userText: "¿Tienen bikinis?",
});
assert.match(localizedNoMatch, /Lo siento/);
assert.doesNotMatch(localizedNoMatch, /Sorry/);

console.log("product comment routing self-check passed");
process.exit(0);
