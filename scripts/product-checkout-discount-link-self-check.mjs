import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildShopifyDiscountLink, buildShopifyNoDiscountLink, normalizeDiscountCode, resolveSameOriginTarget, resolveTrustedCheckoutStorefrontUrl } from "../server/shopify-discount-link-service.js";
import { shopifyAdminSearchQuery } from "../server/product-source-shopify-admin-service.js";
import { buildCheckoutResolveQueries, extractProductHandle } from "../server/product-search-match-service.js";

const storefront = "https://footballkituk.com";
const cart = "https://footballkituk.com/cart/123:1?note=home";

assert.equal(normalizeDiscountCode("TEST123"), "TEST123");
assert.equal(normalizeDiscountCode("bad code"), "");
assert.equal(normalizeDiscountCode("".padEnd(65, "A")), "");
assert.equal(
  shopifyAdminSearchQuery("ignored title", { productHandle: "spain-away-soccer-jersey-world-cup-2026-white-658866" }),
  "handle:spain-away-soccer-jersey-world-cup-2026-white-658866",
);
const exactHandle = "spain-away-soccer-jersey-world-cup-2026-white-658866";
assert.equal(buildCheckoutResolveQueries({
  url: `${storefront}/products/${exactHandle}`,
  sizes: Array.from({ length: 8 }, (_, index) => ({ sku: `SKU-${index}` })),
})[0], exactHandle);
assert.equal(extractProductHandle(`${storefront}/products/${"a".repeat(256)}`), "");
assert.equal(resolveSameOriginTarget(cart, storefront).pathname, "/cart/123:1");
assert.equal(
  resolveTrustedCheckoutStorefrontUrl({ siteUrl: "", storefrontUrl: "https://example.myshopify.com" }, { url: `${storefront}/products/example` }),
  storefront,
);

const link = buildShopifyDiscountLink({ code: "TEST123", targetUrl: cart, storefrontUrl: storefront });
const parsed = new URL(link);
assert.equal(parsed.origin, storefront);
assert.equal(parsed.pathname, "/cart/123:1");
assert.equal(parsed.searchParams.get("note"), "home");
assert.equal(parsed.searchParams.get("discount"), "TEST123");
const noDiscount = new URL(buildShopifyNoDiscountLink({ targetUrl: cart, storefrontUrl: storefront }));
assert.equal(noDiscount.pathname, "/cart/123:1");
assert.equal(noDiscount.searchParams.get("discount"), "");

assert.throws(
  () => buildShopifyDiscountLink({ code: "TEST123", targetUrl: "https://evil.example/cart/1:1", storefrontUrl: storefront }),
  (error) => error?.publicCode === "PRODUCT_CHECKOUT_ORIGIN_INVALID",
);
assert.throws(
  () => buildShopifyDiscountLink({ code: "TEST123", targetUrl: cart, storefrontUrl: "https://evil.example" }),
  (error) => error?.publicCode === "PRODUCT_CHECKOUT_ORIGIN_INVALID",
);
assert.throws(
  () => buildShopifyDiscountLink({ code: "bad code", targetUrl: cart, storefrontUrl: storefront }),
  (error) => error?.publicCode === "DISCOUNT_CODE_INVALID",
);

const routeSource = await readFile("server/product-checkout-routes.js", "utf8");
assert.match(routeSource, /isShopifyAdminProductSource/, "checkout route should restrict automatic links to Shopify Admin sources");
assert.match(routeSource, /isShopifyPublicProductSource/, "checkout route should restrict automatic links to Shopify public sources");
assert.match(routeSource, /DISCOUNT_LINK_UNSUPPORTED/, "unsupported providers should fail closed for automatic discount links");
assert.match(routeSource, /PRODUCT_VARIANT_UNAVAILABLE/, "Shopify discount checkout must fail closed when no trusted variant is resolved");
assert.match(routeSource, /resolved\?\.resolvedFromSource !== true[\s\S]*PRODUCT_VARIANT_UNAVAILABLE/);
assert.match(routeSource, /validateShopifyDiscountCode/);
assert.match(routeSource, /validation\.valid[\s\S]*buildShopifyDiscountLink[\s\S]*buildShopifyNoDiscountLink/);
assert.doesNotMatch(routeSource, /resolveSameOriginTarget\(product\?\.url/, "Shopify Buy now must not redirect to a product detail page");

console.log("product checkout discount link self-check passed");
