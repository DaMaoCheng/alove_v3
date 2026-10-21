import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildMascotProductContext } from "../server/mascot-product-context-service.js";

process.env.NODE_ENV = "test";
process.env.AIOVE_ALLOW_LOCAL_PRODUCT_SOURCE_SELF_CHECK = "true";

const seenRequests = [];

const productServer = createServer((req, res) => {
  seenRequests.push(new URL(req.url, "http://127.0.0.1"));
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  res.setHeader("Content-Type", "application/json");
  if (requestUrl.pathname === "/search/suggest.json") {
    res.end(JSON.stringify({
      resources: {
        results: {
          products: [{
            title: "Spain Away Football Shirt World Cup 2026 White",
            handle: "spain-away-soccer-jersey-world-cup-2026-white",
            url: "/products/spain-away-soccer-jersey-world-cup-2026-white",
            image: "https://cdn.example.test/spain-away.png",
            price: "23.00",
            available: true,
          }],
        },
      },
    }));
    return;
  }
  if (requestUrl.pathname === "/products/spain-away-soccer-jersey-world-cup-2026-white.js") {
    res.end(JSON.stringify({
      title: "Spain Away Football Shirt World Cup 2026 White",
      url: "/products/spain-away-soccer-jersey-world-cup-2026-white",
      featured_image: "//cdn.example.test/spain-away-detail.png",
      images: [
        "//cdn.example.test/spain-away-detail.png",
        "//cdn.example.test/spain-away-back.png",
      ],
      price: 2300,
      compare_at_price: 7300,
      variants: [
        { id: 5012345678901, title: "S", public_title: "S", available: true, price: 2300, compare_at_price: 7300, sku: "SPAIN-S" },
        { id: 5012345678902, title: "XL", public_title: "XL", available: false, price: 2300, compare_at_price: 7300, sku: "SPAIN-XL" },
      ],
    }));
    return;
  }
  if (requestUrl.pathname === "/fkk-products") {
    const query = requestUrl.searchParams.get("q") || "";
    const title = /manchester/i.test(query) ? "Manchester United Home Shirt" : "FKK England Away Shirt";
    res.end(JSON.stringify({ products: [{ title, price: "GBP 64.99", availability: "in stock" }] }));
    return;
  }
  if (requestUrl.pathname === "/gg-products") {
    res.end(JSON.stringify({
      items: [{
        name: "GG Home Shirt",
        salePrice: "USD 39.99",
        stockStatus: "limited",
        sizes: [{ label: "M", available: true, price: "39.99" }],
      }],
    }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => productServer.listen(0, "127.0.0.1", resolve));
const port = productServer.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

try {
  const db = createFakeDb(baseUrl);

  const assignedContext = await buildMascotProductContext(db, {
    character: { id: "mascot_template", category_id: "mascot" },
    userId: "user_fkk",
    userText: "Can you recommend an England kit?"
  });
  assert.equal(assignedContext.siteSlug, "footballkituk", "assigned user should use their bound site");
  assert.equal(assignedContext.searchIntent.intent, "recommendation", "club/player product request should use recommendation intent");
  assert.ok(assignedContext.searchIntent.query.toLowerCase().includes("england"), "product query should preserve explicit club/team/player keywords");
  assert.equal(assignedContext.products[0].name, "FKK England Away Shirt", "assigned site product should be normalized");
  assert.equal(assignedContext.products[0].stock, "in stock", "availability should map to stock");
  assert.ok(seenRequests.at(-1).searchParams.get("q").toLowerCase().includes("england"), "product API should receive search query");
  assert.equal(seenRequests.at(-1).searchParams.get("intent"), "recommendation", "product API should receive recommendation intent");
  assert.equal(seenRequests.at(-1).searchParams.get("limit"), "50", "product API should fetch a larger candidate pool before local ranking");

  const defaultContext = await buildMascotProductContext(db, {
    character: { id: "mascot_template", category_id: "mascot" },
    userId: "user_unassigned",
    userText: "有什么球衣推荐吗？"
  });
  assert.equal(defaultContext.siteSlug, "gogoalshop", "unassigned user should use default site product API");
  assert.equal(defaultContext.searchIntent.intent, "recommendation", "Chinese product request should use recommendation intent");
  assert.equal(defaultContext.products[0].name, "GG Home Shirt", "default site product should be normalized");
  assert.equal(defaultContext.products[0].price, "USD 39.99", "salePrice should map to price");
  assert.equal(defaultContext.products[0].sizes[0].price, "$39.99", "generic API variant prices should use the site currency when numeric only");

  const budgetContext = await buildMascotProductContext(db, {
    character: { id: "mascot_template", category_id: "mascot" },
    userId: "user_fkk",
    userText: "I want a cheap Manchester United shirt",
  });
  assert.equal(budgetContext.searchIntent.intent, "budget", "cheap product request should use budget intent");
  assert.equal(seenRequests.at(-1).searchParams.get("intent"), "budget", "product API should receive budget intent");
  assert.ok(seenRequests.at(-1).searchParams.get("q").toLowerCase().includes("manchester"), "budget product query should preserve explicit team keywords");

  const normalContext = await buildMascotProductContext(db, {
    character: { id: "char_normal", category_id: "babe" },
    userId: "user_fkk",
    userText: "Can you recommend an England kit?"
  });
  assert.equal(normalContext, null, "non-mascot characters should not load product context");

  const creatorContext = await buildMascotProductContext(db, {
    character: { id: "creator_dani", category_id: "creator" },
    userId: "user_fkk",
    userText: "Can you recommend an England kit?"
  });
  assert.equal(creatorContext.siteSlug, "footballkituk", "creator characters should use the user's bound site product API");
  assert.equal(creatorContext.products[0].name, "FKK England Away Shirt", "creator product context should normalize product results");

  const shopifyContext = await buildMascotProductContext(db, {
    character: { id: "creator_dani", category_id: "creator", site_id: "site_shopify" },
    userId: "user_unassigned",
    userText: "Do you have Spain away kit in XL?",
  });
  assert.equal(shopifyContext.siteSlug, "footballkituk-shopify", "creator bound to a Shopify storefront should use that site");
  assert.equal(shopifyContext.products[0].name, "Spain Away Football Shirt World Cup 2026 White", "Shopify public search title should normalize");
  assert.equal(shopifyContext.products[0].imageUrl, "http://cdn.example.test/spain-away-detail.png", "Shopify detail image should normalize to an absolute URL");
  assert.deepEqual(shopifyContext.products[0].imageUrls, [
    "http://cdn.example.test/spain-away-detail.png",
    "https://cdn.example.test/spain-away.png",
    "http://cdn.example.test/spain-away-back.png",
  ], "Shopify detail images should normalize to an absolute image gallery");
  assert.equal(shopifyContext.siteCurrency, "GBP", "Shopify context should expose the site currency");
  assert.equal(shopifyContext.products[0].price, "£23.00", "Shopify cent prices should use the site currency");
  assert.equal(shopifyContext.products[0].priceWas, "£73.00", "Shopify compare-at cent prices should use the site currency");
  assert.equal(shopifyContext.products[0].url, `${baseUrl}/products/spain-away-soccer-jersey-world-cup-2026-white`, "Shopify relative product URLs should normalize to absolute URLs");
  assert.deepEqual(shopifyContext.products[0].sizes, [
    { label: "S", available: true, sku: "SPAIN-S", price: "£23.00", variantId: "5012345678901", buyUrl: `${baseUrl}/cart/5012345678901:1` },
    { label: "XL", available: false, sku: "SPAIN-XL", price: "£23.00", variantId: "5012345678902", buyUrl: `${baseUrl}/cart/5012345678902:1` },
  ], "Shopify variants should normalize to product sizes");
  assert.deepEqual(
    seenRequests.slice(-3).map((url) => url.pathname),
    ["/search/suggest.json", "/products/spain-away-soccer-jersey-world-cup-2026-white.js", "/search"],
    "Shopify storefront mode should use public search, public product view, and customization option endpoints"
  );

  const shopifyApiContext = await buildMascotProductContext(db, {
    character: { id: "creator_dani", category_id: "creator", site_id: "site_shopify_api" },
    userId: "user_unassigned",
    userText: "Do you have Spain away kit in XL?",
  });
  assert.equal(shopifyApiContext.siteSlug, "footballkituk-shopify-api", "Shopify public API URL should be accepted as the configured product API");
  assert.equal(shopifyApiContext.products[0].name, "Spain Away Football Shirt World Cup 2026 White", "Shopify public API URL should normalize products");
  const publicSearchRequest = [...seenRequests].reverse().find((url) => url.pathname === "/search/suggest.json");
  assert.equal(publicSearchRequest?.pathname, "/search/suggest.json", "Shopify public API mode should call the configured public search endpoint");
  assert.equal(publicSearchRequest?.searchParams.get("resources[type]"), "product", "Shopify public API mode should force product resources");
  assert.equal(publicSearchRequest?.searchParams.get("resources[limit]"), "50", "Shopify public API mode should fetch a larger candidate pool before local ranking");

  const blockedAdminContext = await buildMascotProductContext(db, {
    character: { id: "creator_dani", category_id: "creator", site_id: "site_shopify_admin" },
    userId: "user_unassigned",
    userText: "Do you have Spain away kit in XL?",
  });
  assert.equal(blockedAdminContext, null, "Shopify admin URLs should be rejected by the read-only product view");
  assert.notEqual(seenRequests.at(-1).pathname, "/admin/api/2025-10/products.json", "read-only product view must not call Shopify admin endpoints");

  const casualContext = await buildMascotProductContext(db, {
    character: { id: "mascot_template", category_id: "mascot" },
    userId: "user_fkk",
    userText: "How was your day?"
  });
  assert.equal(casualContext, null, "mascot should not load product context for casual non-product chat");

  console.log("mascot product context self-check passed");
} finally {
  await new Promise((resolve) => productServer.close(resolve));
}

function createFakeDb(baseUrl) {
  return {
    async execute(sql, values = []) {
      if (sql.includes("FROM users u")) {
        const userId = values[0];
        if (userId === "user_fkk") {
          return [[{ id: "site_fkk", name: "FKK", slug: "footballkituk", currency: "GBP", product_api_url: `${baseUrl}/fkk-products` }]];
        }
        return [[]];
      }
      if (sql.includes("WHERE s.id = ?")) {
        const siteId = values[0];
        if (siteId === "site_shopify") {
          return [[{ id: "site_shopify", name: "Football Kit UK", slug: "footballkituk-shopify", currency: "GBP", product_api_url: baseUrl }]];
        }
        if (siteId === "site_shopify_api") {
          return [[{ id: "site_shopify_api", name: "Football Kit UK", slug: "footballkituk-shopify-api", currency: "GBP", product_api_url: `${baseUrl}/search/suggest.json` }]];
        }
        if (siteId === "site_shopify_admin") {
          return [[{ id: "site_shopify_admin", name: "Football Kit UK Admin", slug: "footballkituk-admin", currency: "GBP", product_api_url: `${baseUrl}/admin/api/2025-10/products.json` }]];
        }
        return [[]];
      }
      if (sql.includes("FROM sites") && sql.includes("is_default = 1")) {
        return [[{ id: "site_gg", name: "GG", slug: "gogoalshop", currency: "USD", product_api_url: `${baseUrl}/gg-products` }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}
