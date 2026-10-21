import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findResolvedCheckoutProduct,
  mergeResolvedCheckoutProduct,
} from "../server/product-search-match-service.js";

const targetProduct = {
  name: "#125 AC Milan 125th Anniversary Long Sleeve Football Shirt 2024/25",
  url: "https://footballkituk.com/products/125-ac-milan-125th-anniversary-long-sleeve-soccer-jersey-2024-25",
  imageUrl: "https://cdn.shopify.com/ac-milan.png",
  sizes: [
    {
      label: "S",
      sku: "CLS001242504-S",
      variantId: "50553012617497",
      buyUrl: "https://footballkituk.com/cart/50553012617497:1",
      available: true,
    },
  ],
};

const unrelatedBuyableProduct = {
  name: "Replica Aston Villa Home Football Shirt 2024/25 Red",
  url: "https://footballkituk.com/products/replica-aston-villa-home-football-shirt-2024-25-red",
  imageUrl: "https://cdn.shopify.com/aston-villa.png",
  sizes: [
    {
      label: "S",
      sku: "QCS135242501-S",
      variantId: "49996975931673",
      buyUrl: "https://footballkituk.com/cart/49996975931673:1",
      available: false,
    },
  ],
};

assert.equal(
  findResolvedCheckoutProduct([unrelatedBuyableProduct], targetProduct),
  null,
  "checkout resolver must not accept an unrelated product just because it has variant checkout data"
);

assert.equal(
  findResolvedCheckoutProduct([{
    ...unrelatedBuyableProduct,
    name: targetProduct.name,
  }], { name: targetProduct.name }),
  null,
  "checkout resolver must not accept a same-name product without id, URL, handle, SKU, or variant identity"
);

const exactResolvedProduct = {
  ...unrelatedBuyableProduct,
  name: targetProduct.name,
  url: targetProduct.url,
  imageUrl: "https://cdn.shopify.com/ac-milan-live.png",
  sizes: [
    {
      label: "S",
      sku: "CLS001242504-S",
      variantId: "50553012617497",
      buyUrl: "https://footballkituk.com/cart/50553012617497:1",
      available: true,
      price: "£36.00",
    },
  ],
};
const resolved = findResolvedCheckoutProduct([unrelatedBuyableProduct, exactResolvedProduct], targetProduct);
assert.equal(resolved?.url, targetProduct.url, "checkout resolver should still accept exact product identity matches");

const merged = mergeResolvedCheckoutProduct(targetProduct, exactResolvedProduct);
assert.equal(merged.imageUrl, exactResolvedProduct.imageUrl, "exact product matches can update live product imagery");
assert.equal(merged.sizes[0].available, true, "exact product matches can update live size data");
assert.equal(merged.url, exactResolvedProduct.url, "checkout resolution must keep the server-trusted product URL");
const maliciousMerge = mergeResolvedCheckoutProduct(
  { ...targetProduct, url: "https://evil.example/products/ac-milan", sizes: [{ label: "S", buyUrl: "https://evil.example/cart/fake:1" }] },
  exactResolvedProduct,
);
assert.equal(maliciousMerge.url, exactResolvedProduct.url);
assert.equal(maliciousMerge.sizes[0].buyUrl, exactResolvedProduct.sizes[0].buyUrl);
const unmatchedMaliciousSize = mergeResolvedCheckoutProduct(
  { ...targetProduct, sizes: [{ label: "HACK", variantId: "evil", buyUrl: "https://evil.example/cart/evil:1" }] },
  exactResolvedProduct,
).sizes[0];
assert.equal(unmatchedMaliciousSize.variantId, "");
assert.equal(unmatchedMaliciousSize.buyUrl, "");

const liveRefreshSource = readFileSync("src/features/chat/chat-product-card-live-refresh.js", "utf8");
const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const hydrationSource = readFileSync("src/features/chat/chat-product-panel-hydration.js", "utf8");
const rendererSource = readFileSync("src/features/chat/chat-product-panel-renderer.js", "utf8");

assert.match(
  liveRefreshSource,
  /buildDynamicProductPatch/,
  "chat product live refresh should patch only dynamic product fields"
);
assert.doesNotMatch(
  liveRefreshSource,
  /\.\.\.currentProduct,\s*\.\.\.nextProduct/,
  "chat product live refresh must not merge a resolved product over the card snapshot"
);
assert.match(
  hydrationSource,
  /product:\s*\{\s*\.\.\.product,\s*siteSlug:\s*currentSiteSlug\s*\}/,
  "checkout hydration should resolve current site settings, variants, and customization for the open product"
);
assert.match(
  hydrationSource,
  /sizes:\s*resolvedSizes\.length\s*\?\s*resolvedSizes\s*:\s*currentProduct\.sizes/,
  "checkout hydration should update trusted variant metadata"
);
assert.doesNotMatch(
  hydrationSource,
  /\.\.\.currentProduct,\s*\.\.\.item/,
  "checkout hydration must not spread resolved product data over the open product detail"
);
assert.match(
  rendererSource,
  /export function updateProductPanelPaymentMethods/,
  "product panel renderer should expose a local payment-method update path"
);

console.log("product detail refresh scope self-check passed");
