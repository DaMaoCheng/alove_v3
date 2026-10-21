import assert from "node:assert/strict";
import {
  assertShopifyDiscountSearchAllowed,
  mapShopifyDiscountRule,
  resolveShopifyDiscountCode,
  searchShopifyDiscountCodes,
} from "../server/shopify-discount-catalog-service.js";

const site = {
  product_api_url: "shopify-admin://discount-check.myshopify.com?version=2026-07",
};

const searchResult = await searchShopifyDiscountCodes(site, "wel", {
  accessToken: "test-token",
  fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.match(request.variables.query, /wel/i, "search should pass the normalized input to Shopify");
    return jsonResponse({
      data: {
        discountNodes: {
          nodes: [{
            id: "gid://shopify/DiscountNode/1",
            discount: {
              __typename: "DiscountCodeBasic",
              title: "WELCOME10",
              status: "ACTIVE",
              startsAt: "2026-07-01T00:00:00Z",
              endsAt: null,
              shortSummary: "10% off all products",
              summary: "10% off all products",
              codes: { nodes: [{ code: "WELCOME10" }, { code: "OTHER10" }] },
              context: { __typename: "DiscountBuyerSelectionAll" },
              customerGets: {
                items: { __typename: "AllDiscountItems" },
                value: { __typename: "DiscountPercentage", percentage: 0.1 },
              },
              minimumRequirement: null,
            },
          }],
        },
      },
    });
  },
});
assert.equal(searchResult.length, 1, "search should keep only codes matching the typed text");
assert.equal(searchResult[0].code, "WELCOME10");
assert.equal(searchResult[0].shopifyStatus, "ACTIVE");
const cachedSearch = await searchShopifyDiscountCodes(site, "wel", {
  accessToken: "test-token",
  fetchImpl: async () => {
    throw new Error("cached search should not call Shopify twice");
  },
});
assert.deepEqual(cachedSearch, searchResult, "identical short-interval searches should use the provider-protection cache");

const resolved = await resolveShopifyDiscountCode(site, "welcome10", {
  accessToken: "test-token",
  fetchImpl: async () => jsonResponse({
    data: {
      codeDiscountNodeByCode: {
        id: "gid://shopify/DiscountCodeNode/1",
        codeDiscount: basicDiscount({
          value: { __typename: "DiscountPercentage", percentage: 0.1 },
        }),
      },
    },
  }),
});
assert.equal(resolved.code, "WELCOME10");
assert.equal(resolved.shopifyDiscountType, "percentage");
assert.equal(resolved.rule.value, 10);
assert.equal(resolved.rule.pricePreviewEligible, true);

const fixedPerItem = mapShopifyDiscountRule({
  id: "gid://shopify/DiscountCodeNode/2",
  codeDiscount: basicDiscount({
    shortSummary: "£5 off each item",
    value: {
      __typename: "DiscountAmount",
      amount: { amount: "5.00", currencyCode: "GBP" },
      appliesOnEachItem: true,
    },
  }),
}, "SAVE5");
assert.equal(fixedPerItem.shopifyDiscountType, "fixed_amount");
assert.equal(fixedPerItem.rule.value, 5);
assert.equal(fixedPerItem.rule.currencyCode, "GBP");
assert.equal(fixedPerItem.rule.pricePreviewEligible, true);

const fixedWholeOrder = mapShopifyDiscountRule({
  id: "gid://shopify/DiscountCodeNode/2b",
  codeDiscount: basicDiscount({
    shortSummary: "$0.01 off entire order",
    value: {
      __typename: "DiscountAmount",
      amount: { amount: "0.01", currencyCode: "USD" },
      appliesOnEachItem: false,
    },
  }),
}, "TEST");
assert.equal(
  fixedWholeOrder.rule.pricePreviewEligible,
  true,
  "a no-minimum whole-order fixed discount is deterministic for the single-item Buy now cart",
);

const thresholdRule = mapShopifyDiscountRule({
  id: "gid://shopify/DiscountCodeNode/3",
  codeDiscount: basicDiscount({
    shortSummary: "£10 off orders over £50",
    value: {
      __typename: "DiscountAmount",
      amount: { amount: "10.00", currencyCode: "GBP" },
      appliesOnEachItem: false,
    },
    minimumRequirement: {
      __typename: "DiscountMinimumSubtotal",
      greaterThanOrEqualToSubtotal: { amount: "50.00", currencyCode: "GBP" },
    },
  }),
}, "SPEND50");
assert.equal(thresholdRule.rule.minimumRequirement.type, "subtotal");
assert.equal(thresholdRule.rule.minimumRequirement.value, 50);
assert.equal(thresholdRule.rule.pricePreviewEligible, false, "order-level threshold discounts must not fake a product price");

await assert.rejects(
  () => resolveShopifyDiscountCode(site, "missing", {
    accessToken: "test-token",
    fetchImpl: async () => jsonResponse({ data: { codeDiscountNodeByCode: null } }),
  }),
  (error) => error?.publicCode === "SHOPIFY_DISCOUNT_NOT_FOUND",
);

for (let index = 0; index < 30; index += 1) {
  assertShopifyDiscountSearchAllowed("discount-search-admin", 1_000);
}
assert.throws(
  () => assertShopifyDiscountSearchAllowed("discount-search-admin", 1_000),
  (error) => error?.statusCode === 429 && error?.publicCode === "SHOPIFY_DISCOUNT_SEARCH_RATE_LIMITED",
  "admin discount search must have a server-side rate limit",
);

console.log("shopify discount catalog self-check passed");

function basicDiscount({
  shortSummary = "10% off all products",
  value,
  minimumRequirement = null,
} = {}) {
  return {
    __typename: "DiscountCodeBasic",
    title: "WELCOME10",
    status: "ACTIVE",
    startsAt: "2026-07-01T00:00:00Z",
    endsAt: null,
    shortSummary,
    summary: shortSummary,
    context: { __typename: "DiscountBuyerSelectionAll" },
    customerGets: {
      items: { __typename: "AllDiscountItems", allItems: true },
      value,
    },
    minimumRequirement,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}
