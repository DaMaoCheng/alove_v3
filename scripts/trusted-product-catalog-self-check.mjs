import assert from "node:assert/strict";
import { getDbPool, closeDbPool } from "../server/db.js";
import { searchAdminPromotionProducts, resolveProductCheckoutProduct } from "../server/product-search-service.js";
import { SERVER_CONFIG } from "../server/config.js";
import { encryptSecret } from "../server/security.js";

const db = getDbPool();
const originalExecute = db.execute.bind(db);
const originalFetch = globalThis.fetch;
const encryptedToken = encryptSecret("trusted-catalog-self-check-token", SERVER_CONFIG.productApi.secretKey);
const adminRequests = [];

db.execute = async (sql, params = []) => {
  const text = String(sql || "");
  if (text.includes("FROM sites") && (text.includes("WHERE id = ?") || text.includes("WHERE slug = ?"))) {
    return [[{
      id: "site_trusted_catalog",
      name: "Trusted catalog",
      slug: "trusted-catalog",
      site_url: "https://store.example",
      currency: "GBP",
      site_status: "active",
      product_api_url: "shopify-admin://shop.myshopify.com?version=2026-04",
      product_access_token_encrypted: encryptedToken,
      payment_methods_json: null,
    }]];
  }
  return originalExecute(sql, params);
};

globalThis.fetch = async (url, options = {}) => {
  const requestUrl = new URL(String(url));
  assert.equal(requestUrl.hostname, "shop.myshopify.com", "trusted catalog reads should stay on the configured Shopify shop");
  assert.equal(requestUrl.pathname, "/admin/api/2026-04/graphql.json", "trusted catalog reads should use Shopify Admin GraphQL");
  assert.equal(options.method, "POST", "trusted catalog reads should not downgrade to public storefront GET requests");
  assert.equal(options.headers?.["X-Shopify-Access-Token"], "trusted-catalog-self-check-token", "trusted catalog reads should use the server-side configured token");
  const body = JSON.parse(options.body || "{}");
  if (/^query\s+AioveMarkets/m.test(body.query || "")) {
    return new Response(JSON.stringify({
      data: { markets: { nodes: [{ status: "ACTIVE", regions: { nodes: [{ code: "GB", currency: { currencyCode: "GBP" } }] } }] } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  assert.equal(body.variables?.first, 50, "trusted catalog consumers should use the shared 50-product candidate pool");
  assert.equal(body.variables?.country, "GB", "trusted catalog reads should use the country resolved from Shopify Markets");
  adminRequests.push({ query: body.variables?.query || "", first: body.variables?.first || 0 });
  return new Response(JSON.stringify({
    data: {
      products: {
        nodes: [
          { ...activeProduct(91), id: "gid://shopify/Product/91", status: "DRAFT" },
          { ...activeProduct(92), id: "gid://shopify/Product/92", onlineStoreUrl: null },
          ...Array.from({ length: 8 }, (_, index) => activeProduct(index + 1)),
        ],
      },
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

try {
  const picker = await searchAdminPromotionProducts({
    siteId: "site_trusted_catalog",
    query: "shirt",
    limit: 8,
  });
  assert.equal(picker.items.length, 8, "campaign picker should return eight matching products from the wider trusted candidate pool");
  assert.ok(
    picker.items.every((item) => !String(item.id || "").endsWith("/91") && !String(item.id || "").endsWith("/92")),
    "campaign picker should exclude draft and non-published products before limiting results"
  );

  const resolved = await resolveProductCheckoutProduct({
    siteSlug: "trusted-catalog",
    product: {
      id: "1",
      productId: "1",
      name: "Member Hidden Shirt 1",
      sku: "HIDDEN-1-M",
      url: "https://store.example/products/member-hidden-shirt-1",
      sizes: [],
    },
    strictSite: true,
  });
  assert.equal(resolved.resolvedFromSource, true, "product resolve should refresh a theme-hidden product from the trusted Admin catalog");
  assert.equal(resolved.item?.sku, "HIDDEN-1-M", "product resolve should keep the matching trusted product identity");
  assert.equal(resolved.item?.sizes?.[0]?.variantId, "1001", "product resolve should hydrate current variant checkout metadata");

  const nameOnlyResolved = await resolveProductCheckoutProduct({
    siteSlug: "trusted-catalog",
    product: {
      name: "Member Hidden Shirt 1",
      price: "£10.00",
    },
    strictSite: true,
  });
  assert.equal(nameOnlyResolved.resolvedFromSource, false, "product resolve should not accept a same-name candidate without stable identity evidence");
  assert.equal(nameOnlyResolved.item?.price, "£10.00", "identity mismatch should preserve the original product snapshot");
  assert.ok(adminRequests.length >= 2, "picker and resolve should each perform a trusted catalog read");

  console.log("trusted product catalog self-check passed");
} finally {
  db.execute = originalExecute;
  globalThis.fetch = originalFetch;
  await closeDbPool();
}

function activeProduct(index) {
  return {
      id: `gid://shopify/Product/${index}`,
      title: `Member Hidden Shirt ${index}`,
      handle: `member-hidden-shirt-${index}`,
      status: "ACTIVE",
      publishedAt: `2026-07-${String(Math.min(index, 28)).padStart(2, "0")}T00:00:00Z`,
      createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-15T00:00:00Z",
      vendor: "Self Check",
      productType: "Football Shirt",
      totalInventory: 5,
      onlineStoreUrl: `https://store.example/products/member-hidden-shirt-${index}`,
      featuredImage: { url: `https://cdn.example/member-hidden-shirt-${index}.jpg` },
      images: { edges: [{ node: { url: `https://cdn.example/member-hidden-shirt-${index}.jpg` } }] },
      variants: {
        nodes: [{
            id: `gid://shopify/ProductVariant/${1000 + index}`,
            title: "M",
            sku: `HIDDEN-${index}-M`,
            contextualPricing: {
              price: { amount: "36.00", currencyCode: "GBP" },
              compareAtPrice: { amount: "73.00", currencyCode: "GBP" },
            },
            availableForSale: true,
            inventoryQuantity: 5,
            selectedOptions: [{ name: "Size", value: "M" }],
        }],
      },
  };
}
