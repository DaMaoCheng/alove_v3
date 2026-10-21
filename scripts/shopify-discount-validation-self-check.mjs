import assert from "node:assert/strict";
import { validateShopifyDiscountCode } from "../server/shopify-discount-validation-service.js";

const site = {
  product_api_url: "shopify-admin://example-shop.myshopify.com?version=2025-01",
};

const fetchForStatus = (status) => async (_url, request) => {
  const body = JSON.parse(request.body);
  assert.equal(body.variables.code, "TEST123");
  return new Response(JSON.stringify({
    data: status == null ? { codeDiscountNodeByCode: null } : {
      codeDiscountNodeByCode: { codeDiscount: { __typename: "DiscountCodeBasic", status } },
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

const options = (fetchImpl) => ({ fetchImpl, accessToken: "test-token" });
assert.equal((await validateShopifyDiscountCode(site, "TEST123", options(fetchForStatus("ACTIVE")))).valid, true);
assert.equal((await validateShopifyDiscountCode(site, "TEST123", options(fetchForStatus("EXPIRED")))).valid, false);
assert.equal((await validateShopifyDiscountCode(site, "TEST123", options(fetchForStatus(null)))).reason, "not_found");
const denied = await validateShopifyDiscountCode(site, "TEST123", {
  fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: "Access denied" }] }), { status: 200 }),
  accessToken: "test-token",
});
assert.equal(denied.valid, false);
assert.equal(denied.reason, "unavailable");

console.log("Shopify discount validation self-check passed");
