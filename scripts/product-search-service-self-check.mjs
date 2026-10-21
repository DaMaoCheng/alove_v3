import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { searchAdminPromotionProducts, searchSiteProducts } from "../server/product-search-service.js";
import { filterProductsByTitle } from "../server/product-search-match-service.js";
import { getDbPool, closeDbPool } from "../server/db.js";
import { SERVER_CONFIG } from "../server/config.js";
import { encryptSecret } from "../server/security.js";

const db = getDbPool();
assert.equal(SERVER_CONFIG.productApi.timeoutMs, 3000, "the shared product timeout baseline should remain unchanged");
assert.ok(SERVER_CONFIG.productApi.ttmallTimeoutMs >= 10000, "TTMall should have an isolated latency budget");
const originalExecute = db.execute.bind(db);
const originalFetch = globalThis.fetch;
const originalLookup = dns.lookup;
const encryptedShopifyToken = encryptSecret("self-check-shopify-admin-token", SERVER_CONFIG.productApi.secretKey);
const shopifyAdminQueries = [];

db.execute = async (sql, params = []) => {
  const text = String(sql || "");
  if (text.includes("FROM sites") && text.includes("WHERE slug = ?")) {
    const slug = params[0] || "gogoalshop";
    const apiUrl = slug === "demo-site"
      ? "/api/demo/products"
      : slug === "admin-shop-site"
        ? "shopify-admin://shop.myshopify.com?version=2026-04"
        : "https://example.com/products";
    return [[{
      id: `site_${slug}`,
      name: slug,
      slug,
      currency: "GBP",
      product_api_url: apiUrl,
      product_access_token_encrypted: slug === "admin-shop-site" ? encryptedShopifyToken : "",
    }]];
  }
  if (text.includes("FROM sites") && text.includes("WHERE is_default = 1")) {
    return [[{ id: "site_default", name: "Default", slug: "gogoalshop", currency: "GBP", product_api_url: "https://example.com/products" }]];
  }
  if (text.includes("FROM sites") && text.includes("WHERE id = ?") && text.includes("site_status = 'active'")) {
    const siteId = params[0] || "site_fkk";
    const apiUrl = siteId === "site_demo"
      ? "/api/demo/products"
      : siteId === "site_admin_shopify"
        ? "shopify-admin://shop.myshopify.com?version=2026-04"
      : siteId === "site_shopify" || siteId === "site_shopify_wide"
        ? "https://example.com/search/suggest.json"
        : "https://example.com/products";
    return [[{
      id: siteId,
      name: "FKK",
      slug: "footballkituk",
      currency: "GBP",
      product_api_url: apiUrl,
      product_access_token_encrypted: siteId === "site_admin_shopify" ? encryptedShopifyToken : "",
    }]];
  }
  return originalExecute(sql, params);
};

try {
  dns.lookup = async (hostname, options = {}) => {
    if (hostname === "example.com" || hostname === "shop.myshopify.com") {
      return options?.all ? [{ address: "93.184.216.34", family: 4 }] : { address: "93.184.216.34", family: 4 };
    }
    return originalLookup(hostname, options);
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.hostname === "shop.myshopify.com" && requestUrl.pathname === "/admin/api/2026-04/graphql.json") {
      const body = JSON.parse(options.body || "{}");
      if (/^query\s+AioveMarkets/m.test(body.query || "")) {
        return new Response(JSON.stringify({
          data: { markets: { nodes: [{ status: "ACTIVE", regions: { nodes: [{ code: "GB", currency: { currencyCode: "GBP" } }] } }] } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      shopifyAdminQueries.push(String(body.variables.query || ""));
      assert.match(body.query, /sortKey:\s*PUBLISHED_AT/, "Shopify Admin search should request publish-time sorting");
      assert.match(body.query, /reverse:\s*true/, "Shopify Admin search should request newest products first");
      assert.equal(body.variables.first, 50, "public search should ask Shopify Admin for the wider candidate pool");
      assert.equal(body.variables.country, "GB", "public search should use the country resolved from Shopify Markets");
      assert.doesNotMatch(body.variables.query || "", /(?:title|sku):\*/, "Shopify Admin search must use supported prefix wildcards instead of unsupported leading wildcards");
      if (String(body.variables.query || "").toLowerCase().includes("manchester")) {
        return new Response(JSON.stringify({
          data: {
            products: {
              nodes: [buildShopifyAdminProductNode({
                id: "man-united-away-soccer",
                title: "Manchester United Away Soccer Jersey 2026/27 Blue",
                handle: "manchester-united-away-soccer-jersey-2026-27-blue",
                publishedAt: "2026-07-20T09:00:00Z",
                price: "54.99",
              })],
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(body.variables.query || "").toLowerCase().includes("england")) {
        return new Response(JSON.stringify({
          data: {
            products: {
              nodes: [
                buildShopifyAdminProductNode({
                  id: "old-england-away",
                  title: "Men's England Away Football Shirt 2025 Black - Women's Euro",
                  handle: "mens-england-away-football-shirt-2025-black-womens-euro",
                  publishedAt: "2025-07-30T07:23:44Z",
                  price: "42.00",
                }),
                buildShopifyAdminProductNode({
                  id: "new-england-home",
                  title: "England Home Shirt 2026 World Cup — Player Version",
                  handle: "england-home-shirt-2026-world-cup-player-version",
                  publishedAt: "2026-05-22T09:01:07Z",
                  price: "54.99",
                }),
                buildShopifyAdminProductNode({
                  id: "new-england-away",
                  title: "Player Version England Away Football Shirt 2026",
                  handle: "player-version-england-away-football-shirt-2026",
                  publishedAt: "2026-05-22T07:39:15Z",
                  price: "54.99",
                }),
                buildShopifyAdminProductNode({
                  id: "england-home-world-cup-white",
                  title: "England Home Soccer Jersey World Cup 2026 White",
                  handle: "england-home-soccer-jersey-world-cup-2026-white-703037",
                  publishedAt: "2026-05-21T09:01:07Z",
                  price: "49.99",
                }),
              ],
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (String(body.variables.query || "") === "status:active AND (title:messi* OR sku:messi*)") {
        return new Response(JSON.stringify({
          data: {
            products: {
              nodes: [buildShopifyAdminProductNode({
                id: "messi-retro",
                title: "MESSI #10 Retro 2016/17 Barcelona Home Football Shirt Red&Blue",
                handle: "messi-10-retro-2016-17-barcelona-home-soccer-jersey-red-blue-695672",
                publishedAt: "2026-05-20T09:00:00Z",
                price: "64.59",
              })],
            },
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        data: {
          products: {
            nodes: [{
                id: "gid://shopify/Product/657839",
                title: "AC Milan Away Jersey 26/27 White",
                handle: "ac-milan-away-jersey-26-27-white-657839",
                status: "ACTIVE",
                publishedAt: "2026-07-03T09:00:00Z",
                createdAt: "2026-07-02T09:00:00Z",
                updatedAt: "2026-07-04T09:00:00Z",
                vendor: "Self Check",
                productType: "Football Shirt",
                onlineStoreUrl: "https://shop.myshopify.com/products/ac-milan-away-jersey-26-27-white-657839",
                featuredImage: { url: "https://cdn.example/ac-milan-away.jpg" },
                images: { edges: [{ node: { url: "https://cdn.example/ac-milan-away.jpg" } }] },
                variants: {
                  nodes: [{
                      id: "gid://shopify/ProductVariant/1",
                      title: "M",
                      sku: "CS001262702",
                      contextualPricing: {
                        price: { amount: "36.00", currencyCode: "GBP" },
                        compareAtPrice: { amount: "73.00", currencyCode: "GBP" },
                      },
                      availableForSale: true,
                      inventoryQuantity: 5,
                      selectedOptions: [{ name: "Size", value: "M" }],
                  }],
                },
            }],
          },
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (requestUrl.pathname === "/search/suggest.json") {
      return new Response(JSON.stringify({ resources: { results: { products: [] } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (requestUrl.pathname === "/search") {
      if (String(requestUrl.searchParams.get("q") || "").toLowerCase().includes("widefallback")) {
        return new Response(`<!doctype html><html><body>${Array.from({ length: 8 }, (_, index) => `<a href="/products/widefallback-${index + 1}">Wide Fallback Shirt ${index + 1}</a>`).join("")}</body></html>`, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(`<!doctype html><html><body><a href="/products/ac-milan-away-jersey-26-27-white-657839">AC Milan Away Jersey 26/27 White</a></body></html>`, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    if (requestUrl.pathname === "/products/ac-milan-away-jersey-26-27-white-657839.js") {
      return new Response(JSON.stringify({
        id: 657839,
        handle: "ac-milan-away-jersey-26-27-white-657839",
        title: "AC Milan Away Jersey 26/27 White",
        url: "/products/ac-milan-away-jersey-26-27-white-657839",
        price: 4999,
        featured_image: "//cdn.example/ac-milan-away.jpg",
        available: true,
        variants: [{ id: 1, title: "M", sku: "CS001262702", available: true, price: 4999 }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (/^\/products\/widefallback-\d+\.js$/.test(requestUrl.pathname)) {
      const index = Number(requestUrl.pathname.match(/widefallback-(\d+)\.js$/)?.[1] || 0);
      return new Response(JSON.stringify({
        id: `widefallback-${index}`,
        handle: `widefallback-${index}`,
        title: `Wide Fallback Shirt ${index}`,
        url: `/products/widefallback-${index}`,
        price: 4900 + index,
        featured_image: `//cdn.example/widefallback-${index}.jpg`,
        available: true,
        variants: [{ id: 2000 + index, title: "M", sku: `WIDE-${index}-M`, available: true, price: 4900 + index }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (requestUrl.pathname === "/products") {
      const query = String(requestUrl.searchParams.get("q") || "").trim().toLowerCase();
      if (query === "acmilan") {
        return new Response(JSON.stringify({ products: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (query.includes("125 ac milan 125th anniversary long sleeve football shirt")) {
        return new Response(JSON.stringify({ products: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (query === "ac milan 125th anniversary") {
        return new Response(JSON.stringify({
          products: [
            {
              id: "acm-125",
              sku: "ACM-125-LS",
              title: "#125 AC Milan 125th Anniversary Long Sleeve Football Shirt 2024/25",
              subtitle: "AC Milan",
              price: "46.99",
              url: "https://store.example/ac-milan-125th-anniversary-long-sleeve-football-shirt-2024-25",
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (query === "chelsea") {
        return new Response(JSON.stringify({
          products: [
            {
              id: "chelsea-retro-away",
              sku: "CHE-9294-AWAY",
              title: "Men Retro Fan Version 1992/94 Chelsea Away Football Shirt White",
              subtitle: "Chelsea",
              price: "51.99",
              publishedAt: "2026-06-01T00:00:00Z",
              url: "https://store.example/chelsea-retro-away-1992-94",
            },
            {
              id: "chelsea-2026-home",
              sku: "CHE-2627-HOME",
              title: "2026/27 Chelsea Home Soccer Jersey Blue",
              subtitle: "Chelsea",
              price: "46.99",
              publishedAt: "2026-07-01T00:00:00Z",
              url: "https://store.example/2026-27-chelsea-home-soccer-jersey-blue",
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        products: [
          {
            id: "matchday-001",
            sku: "MIL-000",
            title: "Matchday Home Kit",
            subtitle: "AC Milan",
            price: "59.99",
            publishedAt: "2026-07-05T00:00:00Z",
            url: "https://store.example/matchday",
          },
          {
            id: "acm-old-home",
            sku: "ACM-OLD-HOME",
            title: "AC Milan Home Shirt 2025",
            subtitle: "Supporter edition",
            price: "39.99",
            publishedAt: "2025-01-01T00:00:00Z",
            url: "https://store.example/ac-milan-home-shirt-2025",
          },
          {
            id: "acm-away",
            sku: "ACM-AWAY",
            title: "AC Milan Away Shirt",
            subtitle: "Supporter edition",
            price: "49.99",
            publishedAt: "2026-06-01T00:00:00Z",
            url: "https://store.example/ac-milan-away-shirt",
          },
          {
            id: "acm-001",
            sku: "ACM-HOME",
            title: "AC Milan Home Shirt",
            subtitle: "Supporter edition",
            summary: "UCL edition",
            price: "49.99",
            publishedAt: "2026-07-01T00:00:00Z",
            url: "https://store.example/ac-milan-home-shirt",
          },
          {
            id: "pro-001",
            sku: "PRO-ACM",
            title: "AC Milan Pro Shirt",
            subtitle: "Player edition",
            price: "79.99",
            publishedAt: "2026-05-01T00:00:00Z",
            url: "https://store.example/ac-milan-pro-shirt",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${requestUrl}`);
  };

  const result = await searchSiteProducts({ siteSlug: "footballkituk", query: "milan", limit: 2 });
  assert.equal(result.items.length, 2, "public search should still return at most two title-matched products");
  assert.equal(result.items[0].name, "AC Milan Home Shirt", "public search should prefer the newest matching home/away product");
  assert.equal(result.items[1].name, "AC Milan Away Shirt", "public search should pair the newest home result with the matching away result when possible");

  const workingFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("synthetic public source failure");
  };
  const publicSourceError = await searchSiteProducts({ siteSlug: "footballkituk", query: "source failure shirt", limit: 2 });
  globalThis.fetch = workingFetch;
  assert.equal(publicSourceError.searchState, "source_error", "public search should return a structured source-error state");
  assert.equal(publicSourceError.searchOutcome, "source_error", "public source failures must not be disguised as a confirmed no-match");
  assert.deepEqual(publicSourceError.items, [], "public source failures must never emit a product result");

  const expandedResult = await searchSiteProducts({ siteSlug: "footballkituk", query: "milan", limit: 10 });
  assert.equal(expandedResult.items.length, 4, "public product search should honor the ten-item result limit when the page has no character results");

  const compactResult = await searchSiteProducts({ siteSlug: "footballkituk", query: "acmilan", limit: 2 });
  assert.equal(compactResult.items.length, 2, "search should match compact user input against spaced product titles");
  assert.equal(compactResult.items[0].name, "AC Milan Home Shirt", "compact search should still prefer the latest matching product");
  assert.equal(compactResult.items[1].name, "AC Milan Away Shirt", "compact search should keep home and away paired when the query is generic");

  const awayResult = await searchSiteProducts({ siteSlug: "footballkituk", query: "AC Milan away", limit: 2 });
  assert.equal(awayResult.items.length, 1, "explicit away searches should not force a home pairing");
  assert.equal(awayResult.items[0].name, "AC Milan Away Shirt", "explicit away searches should respect the requested variant");

  const compactSeasonResult = await searchSiteProducts({ siteSlug: "footballkituk", query: "Chelsea 26", limit: 2 });
  assert.equal(compactSeasonResult.items.length, 1, "a team plus compact season search should retain the matched current-season product");
  assert.equal(compactSeasonResult.items[0].name, "2026/27 Chelsea Home Soccer Jersey Blue", "a compact season search should not be removed by raw-title filtering");

  const naturalSeasonResult = await searchSiteProducts({ siteSlug: "footballkituk", query: "Show Chelsea 26 shirt", limit: 2 });
  assert.equal(naturalSeasonResult.items.length, 1, "natural-language product search should ignore generic request words after season parsing");
  assert.equal(naturalSeasonResult.items[0].name, "2026/27 Chelsea Home Soccer Jersey Blue", "natural-language compact season search should retain the current-season product");

  const longTitleResult = await searchSiteProducts({ siteSlug: "footballkituk", query: "AC Milan Home Football Shirt - UCL", limit: 2 });
  assert.ok(longTitleResult.items.length >= 1, "search should tolerate long product-title queries with extra variant words");
  assert.equal(longTitleResult.items[0].name, "AC Milan Home Shirt", "long product-title query should still rank the closest title match first");

  const exactCopiedTitleResult = await searchSiteProducts({
    siteSlug: "footballkituk",
    query: "#125 AC Milan 125th Anniversary Long Sleeve Football Shirt 2024/25",
    limit: 2,
  });
  assert.equal(exactCopiedTitleResult.items.length, 1, "search should retry copied full product titles with a core title query");
  assert.equal(
    exactCopiedTitleResult.items[0].name,
    "#125 AC Milan 125th Anniversary Long Sleeve Football Shirt 2024/25",
    "copied full product titles should return the exact product"
  );

  const demoResult = await searchSiteProducts({ siteSlug: "demo-site", query: "matchday", limit: 2 });
  assert.deepEqual(demoResult.items, [], "search endpoint should not return internal demo API products");

  const adminShopResult = await searchSiteProducts({ siteSlug: "admin-shop-site", query: "acmilan", limit: 2 });
  assert.equal(adminShopResult.items.length, 1, "public search should still work when the stored source is Shopify admin");
  assert.equal(adminShopResult.items[0].name, "AC Milan Away Jersey 26/27 White", "public search should use the bound Shopify admin product source");
  assert.equal(adminShopResult.items[0].price, "£36.00", "public search should use the bound UK market price currency");
  assert.equal(adminShopResult.items[0].publishedAt, "2026-07-03T09:00:00.000Z", "public search should expose Shopify Admin publishedAt");

  const adminEnglandResult = await searchSiteProducts({ siteSlug: "admin-shop-site", query: "england", limit: 2 });
  assert.equal(adminEnglandResult.items.length, 2, "broad Shopify Admin team searches should still return two products");
  assert.equal(adminEnglandResult.items[0].name, "England Home Shirt 2026 World Cup — Player Version", "broad Shopify Admin team searches should prefer newer World Cup products over older Euro products");
  assert.equal(adminEnglandResult.items[1].name, "Player Version England Away Football Shirt 2026", "broad Shopify Admin team searches should keep the latest home/away pair when available");

  const terminalPartialResult = await searchSiteProducts({
    siteSlug: "admin-shop-site",
    query: "Manchester United Away Soc",
    limit: 2,
  });
  assert.equal(terminalPartialResult.items.length, 1, "a terminal partial word should retain a trusted product title");
  assert.equal(
    terminalPartialResult.items[0].name,
    "Manchester United Away Soccer Jersey 2026/27 Blue",
    "a terminal partial word should match the beginning of the product title word"
  );
  assert.ok(
    shopifyAdminQueries.some((query) => query.includes("title:soc*")),
    "terminal partial words should remain prefix queries for Shopify Admin recall"
  );

  const genericTerminalPartialResult = filterProductsByTitle([
    { name: "Manchester United Away Soccer Jersey 2026/27 Blue" },
    { name: "Manchester United Away Training Top 2026/27 Blue" },
  ], "Manchester United Away Soc");
  assert.deepEqual(
    genericTerminalPartialResult.map((item) => item.name),
    ["Manchester United Away Soccer Jersey 2026/27 Blue"],
    "generic title filtering should only treat the last partial word as a word-prefix"
  );

  const punctuationQueryStart = shopifyAdminQueries.length;
  const punctuationHeavyTitleResult = await searchSiteProducts({
    siteSlug: "admin-shop-site",
    query: "MESSI #10 Retro 2016/17 Barcelona Home Football Shirt Red&Blue",
    limit: 2,
  });
  assert.equal(punctuationHeavyTitleResult.items.length, 1, "exact titles with #, slash, and ampersand should fall back to a stable anchor search");
  assert.equal(
    punctuationHeavyTitleResult.items[0].name,
    "MESSI #10 Retro 2016/17 Barcelona Home Football Shirt Red&Blue",
    "punctuation-heavy copied titles should return the exact trusted catalog product"
  );
  const punctuationQueries = shopifyAdminQueries.slice(punctuationQueryStart);
  assert.equal(
    punctuationQueries.at(-1),
    "status:active AND (title:messi* OR sku:messi*)",
    "punctuation-heavy title search should reach the stable anchor fallback"
  );
  assert.ok(punctuationQueries.length <= 5, "punctuation-heavy title fallback should stay within the bounded query plan");

  const adminResult = await searchAdminPromotionProducts({ siteId: "site_fkk", query: "ACM-HOME", limit: 8 });
  assert.equal(adminResult.items.length, 1, "admin campaign product search should match SKU as well as title");
  assert.equal(adminResult.items[0].id, "acm-001", "admin search should expose selected product id");
  assert.equal(adminResult.items[0].sku, "ACM-HOME", "admin search should expose selected product sku");
  assert.equal(adminResult.items[0].url, "https://store.example/ac-milan-home-shirt", "admin search should expose selected product URL");

  const shopifySkuResult = await searchAdminPromotionProducts({ siteId: "site_shopify", query: "cs001262702", limit: 8 });
  assert.equal(shopifySkuResult.items.length, 1, "admin Shopify product search should fallback to storefront search when suggest has no SKU hit");
  assert.equal(shopifySkuResult.items[0].sku, "CS001262702", "admin Shopify fallback should expose the variant SKU");
  assert.equal(shopifySkuResult.items[0].name, "AC Milan Away Jersey 26/27 White", "admin Shopify fallback should expose the product title");
  assert.equal(shopifySkuResult.items[0].url, "https://example.com/products/ac-milan-away-jersey-26-27-white-657839", "admin Shopify fallback should expose the product URL");

  const trustedAdminResult = await searchAdminPromotionProducts({ siteId: "site_admin_shopify", query: "ac milan", limit: 8 });
  assert.equal(trustedAdminResult.items.length, 1, "admin campaign picker should read the bound Shopify Admin catalog");
  assert.equal(trustedAdminResult.items[0].sku, "CS001262702", "admin campaign picker should expose Shopify Admin variant data");

  const trustedAdminSkuResult = await searchAdminPromotionProducts({
    siteId: "site_admin_shopify",
    query: "CS001262702",
    limit: 8,
  });
  assert.equal(trustedAdminSkuResult.items.length, 1, "admin campaign picker should search the Shopify Admin catalog by SKU");
  assert.equal(trustedAdminSkuResult.items[0].sku, "CS001262702", "Shopify Admin SKU lookup should return the matching variant");
  assert.ok(
    shopifyAdminQueries.some((query) => query.includes("sku:cs001262702*")),
    "Shopify Admin SKU lookup should use a supported prefix wildcard"
  );

  const copiedAdminTitleResult = await searchAdminPromotionProducts({
    siteId: "site_admin_shopify",
    query: "England Home Soccer Jersey World Cup 2026 White",
    limit: 8,
  });
  assert.equal(copiedAdminTitleResult.items.length, 1, "admin campaign picker should find a product by its copied full Kitshop title");
  assert.equal(
    copiedAdminTitleResult.items[0].name,
    "England Home Soccer Jersey World Cup 2026 White",
    "copied full Kitshop titles should return the exact trusted catalog product"
  );
  assert.ok(
    shopifyAdminQueries.some((query) => query === "status:active AND title:england* AND title:home* AND title:soccer* AND title:jersey* AND title:world* AND title:cup* AND title:2026* AND title:white*"),
    "admin campaign picker should preserve all meaningful copied-title words without relying on Shopify's unstable phrase search"
  );

  const wideFallbackResult = await searchAdminPromotionProducts({ siteId: "site_shopify_wide", query: "widefallback", limit: 8 });
  assert.equal(wideFallbackResult.items.length, 8, "admin campaign picker public fallback should keep the shared wider candidate pool");

  const adminDemoResult = await searchAdminPromotionProducts({ siteId: "site_demo", query: "ACM", limit: 8 });
  assert.deepEqual(adminDemoResult.items, [], "admin campaign product search should not return internal demo products");
} finally {
  db.execute = originalExecute;
  globalThis.fetch = originalFetch;
  dns.lookup = originalLookup;
  await closeDbPool();
}

console.log("product search service self-check passed");

function buildShopifyAdminProductNode({
  id = "product",
  title = "Product",
  handle = "product",
  publishedAt = "2026-01-01T00:00:00Z",
  price = "49.99",
} = {}) {
  return {
      id: `gid://shopify/Product/${id}`,
      title,
      handle,
      status: "ACTIVE",
      publishedAt,
      createdAt: publishedAt,
      updatedAt: publishedAt,
      vendor: "Self Check",
      productType: "Football Shirt",
      onlineStoreUrl: `https://shop.myshopify.com/products/${handle}`,
      featuredImage: { url: `https://cdn.example/${handle}.jpg` },
      images: { edges: [{ node: { url: `https://cdn.example/${handle}.jpg` } }] },
      variants: {
        nodes: [{
            id: `gid://shopify/ProductVariant/${id}-m`,
            title: "M",
            sku: `${id}-M`,
            contextualPricing: {
              price: { amount: price, currencyCode: "GBP" },
              compareAtPrice: { amount: "109.99", currencyCode: "GBP" },
            },
            availableForSale: true,
            inventoryQuantity: 5,
            selectedOptions: [{ name: "Size", value: "M" }],
        }],
      },
  };
}
