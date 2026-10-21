import assert from "node:assert/strict";

const response = await fetch("http://127.0.0.1:4173/api/products/checkout-link", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    siteSlug: "footballkituk",
    characterId: "missing-character",
    messageId: "missing-message",
    discountOfferId: "missing-offer",
    product: {},
  }),
});
assert.equal(response.status, 401, "checkout-link must require a formal user session");
console.log("product checkout discount link HTTP self-check passed");
