import assert from "node:assert/strict";
import { closeDbPool } from "../server/db.js";
import { resolveProductCheckoutProduct } from "../server/product-search-service.js";

const LEGACY_PRODUCT = {
  url: "https://footballkituk.com/products/authentic-england-away-soccer-jersey-2026-688080",
  name: "Player Version England Away Football Shirt 2026",
  siteSlug: "footballkituk",
  sizes: [
    { sku: "NPV003202602-S", label: "S", price: "£28.00", available: true },
    { sku: "NPV003202602-M", label: "M", price: "£28.00", available: true },
    { sku: "NPV003202602-L", label: "L", price: "£28.00", available: true },
  ],
};

async function main() {
  const result = await resolveProductCheckoutProduct({
    siteSlug: "footballkituk",
    product: LEGACY_PRODUCT,
  });

  assert.equal(result.ok, true, "resolve should succeed");
  assert.equal(result.item?.url, LEGACY_PRODUCT.url, "resolved product should keep same product url");
  assert.ok(Array.isArray(result.item?.sizes) && result.item.sizes.length >= 3, "resolved product should keep sizes");
  assert.ok(result.item.sizes.every((size) => size.variantId && size.buyUrl), "every size should get variant checkout metadata");
  assert.match(result.item.sizes[0].buyUrl, /^https:\/\/footballkituk\.com\/cart\/\d+:1$/, "buyUrl should point to Shopify cart permalink");

  console.log("[chat-product-legacy-checkout-hydration-self-check] ok");
}

main()
  .catch((error) => {
    console.error("[chat-product-legacy-checkout-hydration-self-check] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool().catch(() => {});
  });
