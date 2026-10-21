import assert from "node:assert/strict";
import dns from "node:dns/promises";
import {
  buildProductApiUrl,
  buildShopifyAdminStorefrontUrl,
  buildShopifySearchUrl,
  fetchProductSummary,
  isBlockedProductAdminUrl,
  isShopifyAdminProductSource,
  isShopifyPublicProductSource,
  resolvePublicProductSourceUrl,
} from "../server/product-source-service.js";
import { encryptSecret } from "../server/security.js";
import { SERVER_CONFIG } from "../server/config.js";
import { parseShopifyAdminSource, resolveShopifyAdminToken, shopifyAdminSearchQuery } from "../server/product-source-shopify-admin-service.js";

assert.equal(isBlockedProductAdminUrl("https://shop.myshopify.com/admin/api/2025-10/products.json"), true, "Shopify admin API should be blocked");
assert.equal(isBlockedProductAdminUrl("https://shop.example.com/search/suggest.json"), false, "public search API should not be blocked");
assert.equal(isShopifyAdminProductSource("shopify-admin://shop.myshopify.com"), true, "Shopify admin read-only product source should be accepted");
assert.equal(isShopifyAdminProductSource("shopify-admin://shop.example.com"), false, "Shopify admin source should require a myshopify.com domain");
assert.equal(parseShopifyAdminSource("shopify-admin://shop.myshopify.com?tokenEnv=ARBITRARY_SECRET")?.tokenEnv, "UNSUPPORTED_TOKEN_ENV", "custom Shopify token env names should be rejected during parsing");
assert.equal(resolveShopifyAdminToken("ARBITRARY_SECRET", ""), "", "site data must not select arbitrary server environment variables");
assert.equal(resolveShopifyAdminToken("SHOPIFY_ADMIN_ACCESS_TOKEN", "v1:invalid"), "", "an invalid stored site token must not silently fall back to the global Shopify token");
assert.equal(buildShopifyAdminStorefrontUrl("shopify-admin://shop.myshopify.com?version=2026-04"), "https://shop.myshopify.com", "Shopify admin source should map to a public storefront URL");
assert.equal(resolvePublicProductSourceUrl("shopify-admin://shop.myshopify.com?version=2026-04"), "https://shop.myshopify.com", "public source resolver should strip admin-only access");
assert.equal(shopifyAdminSearchQuery("Manchester United"), "status:active AND title:manchester* AND title:united*", "Shopify Admin searches should require active products and match multi-word titles term by term");
assert.equal(shopifyAdminSearchQuery("Chelsea"), "status:active AND (title:chelsea* OR sku:chelsea*)", "single-word Shopify Admin searches should constrain active title and SKU matches");
assert.equal(isShopifyPublicProductSource("https://footballkituk.com"), true, "bare storefront URL should be accepted as Shopify public source");
assert.equal(isShopifyPublicProductSource("https://footballkituk.com/search/suggest.json"), true, "Shopify public search URL should be accepted");
assert.equal(isShopifyPublicProductSource("https://footballkituk.com/products.json"), false, "non-search Shopify URL should not be treated as public source");

const genericUrl = buildProductApiUrl("https://api.example.test/products?existing=1", {
  query: "AC Milan shirt",
  intent: "recommendation",
});
assert.equal(genericUrl, "https://api.example.test/products?existing=1&q=AC+Milan+shirt&intent=recommendation&limit=5", "generic product API URL should append query, intent, and limit");

const shopifyUrl = buildShopifySearchUrl("https://footballkituk.com", { query: "Spain away shirt" });
assert.equal(shopifyUrl, "https://footballkituk.com/search/suggest.json?q=Spain+away+shirt&resources%5Btype%5D=product&resources%5Blimit%5D=5", "Shopify storefront URL should build public search URL");

const seenRequests = [];
const originalFetch = globalThis.fetch;
const originalLookup = dns.lookup;
try {
  dns.lookup = async (hostname, options = {}) => {
    if (hostname === "example.com") {
      return options?.all ? [{ address: "93.184.216.34", family: 4 }] : { address: "93.184.216.34", family: 4 };
    }
    return originalLookup(hostname, options);
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    seenRequests.push(requestUrl);
    if (requestUrl.pathname === "/products") {
      return new Response(JSON.stringify({ products: [{ title: "AC Milan Home Shirt", price: "33" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (requestUrl.pathname === "/search/suggest.json") {
      return new Response(JSON.stringify({
        resources: {
          results: {
            products: [
              {
                title: "Stale Spain Away Football Shirt",
                handle: "stale-spain-away",
                url: "/products/stale-spain-away",
                image: "//cdn.example.test/stale.png",
              },
              {
                title: "Spain Away Football Shirt",
                handle: "spain-away",
                url: "/products/spain-away",
                image: "//cdn.example.test/search.png",
              },
            ],
          },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (requestUrl.pathname === "/products/stale-spain-away.js") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (requestUrl.pathname === "/products/spain-away.js") {
      return new Response(JSON.stringify({
        title: "Spain Away Football Shirt",
        url: "/products/spain-away",
        featured_image: "//cdn.example.test/front.png",
        price: 2300,
        available: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${requestUrl}`);
  };

  const genericProducts = await fetchProductSummary("https://example.com/products", { query: "AC Milan shirt", intent: "recommendation" }, { currency: "GBP", timeoutMs: 2000 });
  assert.equal(genericProducts[0].name, "AC Milan Home Shirt", "generic product source should normalize product rows");
  assert.equal(genericProducts[0].price, "£33.00", "generic product source should pass currency to normalizer");
  assert.equal(seenRequests.at(-1).searchParams.get("q"), "AC Milan shirt", "generic product source should send search query");

  const shopifyProducts = await fetchProductSummary("https://example.com", { query: "Spain away shirt", intent: "recommendation" }, { currency: "GBP", timeoutMs: 2000 });
  assert.equal(shopifyProducts.length, 1, "Shopify source should drop search results whose product detail endpoint is 404");
  assert.equal(shopifyProducts[0].name, "Spain Away Football Shirt", "Shopify product source should normalize public product details");
  assert.equal(shopifyProducts[0].imageUrl, "https://cdn.example.test/front.png", "Shopify source should normalize detail image");
  assert.deepEqual(
    seenRequests.slice(-4).map((url) => url.pathname),
    ["/search/suggest.json", "/products/stale-spain-away.js", "/products/spain-away.js", "/search"],
    "Shopify source should verify public product detail and customization endpoints and drop 404 rows"
  );

  const blocked = await fetchProductSummary("https://example.com/admin/api/2025-10/products.json", { query: "Spain" }, { currency: "GBP", timeoutMs: 2000 });
  assert.deepEqual(blocked, [], "blocked admin source should return no products");
  assert.notEqual(seenRequests.at(-1).pathname, "/admin/api/2025-10/products.json", "blocked admin source should not call admin endpoint");

  const unsafe = await fetchProductSummary("http://127.0.0.1:4173/products", { query: "Spain" }, { currency: "GBP", timeoutMs: 2000 });
  assert.deepEqual(unsafe, [], "private or loopback product sources should be blocked");

  const adminRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    adminRequests.push({ url: String(url), options });
    assert.equal(options.method, "POST", "Shopify Admin source should use POST GraphQL reads");
    assert.equal(options.headers["X-Shopify-Access-Token"], "self-check-token", "Shopify Admin source should use the configured token env");
    const body = JSON.parse(options.body);
    if (/^query\s+AioveMarkets/m.test(body.query)) {
      return new Response(JSON.stringify({
        data: { markets: { nodes: [{ status: "ACTIVE", regions: { nodes: [{ code: "GB", currency: { currencyCode: "GBP" } }] } }] } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.match(body.query, /^query\s+AioveProductSearch/m, "Shopify Admin source should only send a query operation");
    assert.doesNotMatch(body.query, /\bmutation\b/i, "Shopify Admin source must not send mutation operations");
    assert.match(body.query, /contextualPricing\(context:\s*\{\s*country:\s*\$country\s*\}\)/, "Shopify Admin source should request a resolved market price");
    assert.doesNotMatch(body.query, /\bshop\s*\{\s*currencyCode\s*\}/, "Shopify Admin source must not request the base shop currency for product display");
    assert.match(body.query, /sortKey:\s*PUBLISHED_AT/, "Shopify Admin source should ask Shopify for newest published products first");
    assert.match(body.query, /reverse:\s*true/, "Shopify Admin source should reverse publish sorting so newest products are first");
    return new Response(JSON.stringify({
      data: {
        products: {
          nodes: [{
              id: "gid://shopify/Product/hidden",
              title: "Hidden AC Milan Football Shirt",
              handle: "hidden-ac-milan-football-shirt",
              status: "ACTIVE",
              vendor: "Football Kit UK",
              productType: "AC Milan",
              onlineStoreUrl: null,
              featuredImage: { url: "https://cdn.example.test/hidden.png" },
              variants: { nodes: [] },
            },
          {
              id: "gid://shopify/Product/draft",
              title: "Draft AC Milan Football Shirt",
              handle: "draft-ac-milan-football-shirt",
              status: "DRAFT",
              vendor: "Football Kit UK",
              productType: "AC Milan",
              onlineStoreUrl: "https://footballkituk.com/products/draft-ac-milan-football-shirt",
              featuredImage: { url: "https://cdn.example.test/draft.png" },
              variants: { nodes: [] },
          },
          {
              id: "gid://shopify/Product/1",
              title: "AC Milan Home Football Shirt",
              handle: "ac-milan-home-football-shirt",
              status: "ACTIVE",
              publishedAt: "2026-07-01T12:00:00Z",
              createdAt: "2026-06-30T12:00:00Z",
              updatedAt: "2026-07-02T12:00:00Z",
              vendor: "Football Kit UK",
              productType: "AC Milan",
              totalInventory: 10,
              onlineStoreUrl: "https://footballkituk.com/products/ac-milan-home-football-shirt",
              featuredImage: { url: "https://cdn.example.test/admin-front.png" },
              images: { edges: [{ node: { url: "https://cdn.example.test/admin-front.png" } }, { node: { url: "https://cdn.example.test/admin-back.png" } }] },
              variants: {
                nodes: [{
                    id: "gid://shopify/ProductVariant/1",
                    title: "M",
                    sku: "ACM-M",
                    contextualPricing: {
                      price: { amount: "36.00", currencyCode: "GBP" },
                      compareAtPrice: { amount: "73.00", currencyCode: "GBP" },
                    },
                    availableForSale: true,
                    inventoryQuantity: 5,
                    selectedOptions: [{ name: "Size", value: "M" }],
                }],
              },
          },
          ],
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  {
    const encryptedAccessToken = encryptSecret("self-check-token", SERVER_CONFIG.productApi.secretKey);
    const adminProducts = await fetchProductSummary("shopify-admin://shop.myshopify.com", { query: "AC Milan" }, {
      currency: "GBP",
      timeoutMs: 2000,
      encryptedAccessToken,
    });
    assert.equal(adminRequests.length, 2, "Shopify Admin source should resolve the market before reading products");
    assert.match(JSON.parse(adminRequests[0].options.body).query, /^query\s+AioveMarkets/m, "Shopify Admin source should read configured markets");
    assert.equal(JSON.parse(adminRequests[1].options.body).variables.first, 5, "default Shopify Admin source reads should keep the compact product limit");
    assert.equal(JSON.parse(adminRequests[1].options.body).variables.country, "GB", "Shopify Admin source should pass the country resolved from the configured GBP market");
    assert.equal(adminProducts.length, 1, "Shopify Admin source should keep only active products with onlineStoreUrl");
    assert.match(adminRequests[1].url, /\/admin\/api\/2026-04\/graphql\.json$/, "Shopify Admin source should call GraphQL endpoint");
    assert.equal(adminProducts[0].name, "AC Milan Home Football Shirt", "Shopify Admin source should normalize product title");
    assert.equal(adminProducts[0].publishedAt, "2026-07-01T12:00:00.000Z", "Shopify Admin source should normalize product publishedAt");
    assert.equal(adminProducts[0].price, "£36.00", "Shopify Admin source should normalize product price using UK contextual pricing");
    assert.equal(adminProducts[0].priceWas, "£73.00", "Shopify Admin source should normalize UK contextual compare-at price");
    assert.equal(adminProducts[0].sku, "ACM-M", "Shopify Admin source should expose variant SKU");
    assert.deepEqual(adminProducts[0].imageUrls, ["https://cdn.example.test/admin-front.png", "https://cdn.example.test/admin-back.png"], "Shopify Admin source should expose product images");
    assert.deepEqual(adminProducts[0].sizes, [{
      label: "M",
      available: true,
      sku: "ACM-M",
      price: "£36.00",
      priceWas: "£73.00",
      currency: "GBP",
      inventoryQuantity: 5,
      variantId: "1",
      buyUrl: "https://footballkituk.com/cart/1:1",
    }], "Shopify Admin source should expose size variants");
  }
} finally {
  globalThis.fetch = originalFetch;
  dns.lookup = originalLookup;
}

console.log("product source service self-check passed");
