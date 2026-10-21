import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeDatabase, getDbPool, closeDbPool } from "../server/db.js";
import { createAdminSite, updateAdminSite } from "../server/admin-site-service.js";
import { searchAdminPromotionProducts } from "../server/product-search-service.js";

const suffix = Date.now().toString(36);
const token = "shpca_selfcheck_read_products_token_123456";
const sitePayload = {
  name: `Product Source ${suffix}`,
  slug: `product-source-${suffix}`,
  siteUrl: "",
  defaultLanguage: "English",
  mascotCharacterId: "",
  productSourceType: "shopify_admin",
  productShopDomain: "shop.myshopify.com",
  productApiVersion: "2026-04",
  productAccessToken: token,
  description: "self-check",
  regionIds: [],
};

const sitesTemplate = readFileSync("src/features/admin-console/admin-console-sites-template.js", "utf8");
const adminConsoleStyles = readFileSync("src/features/app-shell/styles/admin-console.css", "utf8");
assert.match(sitesTemplate, /site-product-api-version/, "site editor should show API version as a compact badge");
assert.doesNotMatch(sitesTemplate, /renderField\("API 版本"/, "site editor should not render API version as a main input field");
assert.match(sitesTemplate, /name="productApiVersion" type="hidden"/, "site editor should keep API version as a hidden submitted value");
assert.match(sitesTemplate, /placeholder="例：fbed87-94\.myshopify\.com"/, "site editor should show a Chinese example placeholder for Shopify shop domain");
assert.match(sitesTemplate, /例：shpca_\.\.\./, "site editor should show a Chinese example placeholder for empty read-only tokens");
assert.match(sitesTemplate, /value="ttmall"/, "site editor should expose TTMall as a product source type");
assert.match(sitesTemplate, /name="productTtmallApiBaseUrl"/, "site editor should collect the TTMall API base URL");
assert.match(sitesTemplate, /name="productTtmallWebsiteId"/, "site editor should collect the TTMall website ID");
assert.equal((sitesTemplate.match(/class="site-product-source-config-field"/g) || []).length, 4, "Shopify and TTMall fields should share the same alignment wrapper");
assert.match(adminConsoleStyles, /\.site-product-source-config-field \.agent-field>span\{[^}]*min-height:18px;[^}]*line-height:18px;/, "product source field labels should use one explicit row height");
assert.doesNotMatch(adminConsoleStyles, /\.site-product-source-config-field \.agent-field>input/, "product source inputs should keep the shared project input height");

await initializeDatabase();
const db = getDbPool();
let siteId = "";

try {
  const created = await createAdminSite(sitePayload);
  siteId = created.item.id;

  assert.equal(created.item.productSourceType, "shopify_admin", "created site should expose product source type");
  assert.equal(created.item.productShopDomain, "shop.myshopify.com", "created site should expose Shopify shop domain");
  assert.equal(created.item.productApiVersion, "2026-04", "created site should expose API version");
  assert.equal(created.item.hasProductAccessToken, true, "created site should expose token configured state");
  assert.equal("productAccessToken" in created.item, false, "created site must not return the raw token");
  assert.equal(created.item.productApiUrl, "shopify-admin://shop.myshopify.com?version=2026-04", "created site should generate the source URL");

  const [[stored]] = await db.execute(
    "SELECT product_api_url, product_source_type, product_shop_domain, product_api_version, product_access_token_encrypted FROM sites WHERE id = ? LIMIT 1",
    [siteId]
  );
  assert.equal(stored.product_source_type, "shopify_admin");
  assert.equal(stored.product_shop_domain, "shop.myshopify.com");
  assert.equal(stored.product_api_version, "2026-04");
  assert.equal(stored.product_api_url, "shopify-admin://shop.myshopify.com?version=2026-04");
  assert.ok(String(stored.product_access_token_encrypted || "").startsWith("v1:"), "token should be encrypted before storage");
  assert.notEqual(stored.product_access_token_encrypted, token, "stored token must not equal raw token");

  const updated = await updateAdminSite(siteId, {
    ...sitePayload,
    name: `Product Source Updated ${suffix}`,
    productAccessToken: "",
  });
  assert.equal(updated.item.hasProductAccessToken, true, "empty token update should keep existing token");

  const ttmallUpdated = await updateAdminSite(siteId, {
    ...sitePayload,
    productSourceType: "ttmall",
    productTtmallApiBaseUrl: "https://api.example.com",
    productTtmallWebsiteId: "4",
    productAccessToken: "must-not-be-stored",
  });
  assert.equal(ttmallUpdated.item.productSourceType, "ttmall", "site editor should expose the saved TTMall source type");
  assert.equal(ttmallUpdated.item.productApiUrl, "ttmall://api.example.com?websiteId=4", "site editor should save a canonical TTMall source URI");
  assert.equal(ttmallUpdated.item.productTtmallApiBaseUrl, "https://api.example.com", "site editor should map the TTMall API base URL back to the form");
  assert.equal(ttmallUpdated.item.productTtmallWebsiteId, "4", "site editor should map the TTMall website ID back to the form");
  assert.equal(ttmallUpdated.item.hasProductAccessToken, false, "switching away from Shopify should clear its stored token");
  const [[ttmallStored]] = await db.execute(
    "SELECT product_api_url, product_source_type, product_shop_domain, product_api_version, product_access_token_encrypted FROM sites WHERE id = ? LIMIT 1",
    [siteId]
  );
  assert.equal(ttmallStored.product_api_url, "ttmall://api.example.com?websiteId=4");
  assert.equal(ttmallStored.product_source_type, "ttmall");
  assert.equal(ttmallStored.product_shop_domain, "");
  assert.equal(ttmallStored.product_api_version, "");
  assert.equal(ttmallStored.product_access_token_encrypted, "", "TTMall source must not persist a temporary or Shopify token");

  await assert.rejects(
    () => updateAdminSite(siteId, {
      ...sitePayload,
      productSourceType: "ttmall",
      productTtmallApiBaseUrl: "http://127.0.0.1:3000",
      productTtmallWebsiteId: "4",
    }),
    /TTMall API Base URL 必须是可公开访问的 HTTPS 根地址/,
    "site editor should reject unsafe TTMall API origins"
  );

  await updateAdminSite(siteId, sitePayload);

  await assert.rejects(
    () => updateAdminSite(siteId, {
      ...sitePayload,
      productSourceType: "",
      productApiUrl: "http://127.0.0.1:4173/products",
    }),
    /商品库 API 必须是可公开访问的 http\/https 地址/,
    "site editor should reject loopback product source URLs"
  );

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    assert.equal(options.headers["X-Shopify-Access-Token"], token, "product search should decrypt and use the stored token");
    const body = JSON.parse(options.body || "{}");
    if (/^query\s+AioveMarkets/m.test(body.query || "")) {
      return new Response(JSON.stringify({
        data: { markets: { nodes: [{ status: "ACTIVE", regions: { nodes: [{ code: "US", currency: { currencyCode: "USD" } }] } }] } },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(body.variables?.country, "US", "admin product search should use the country resolved from its Shopify market");
    return new Response(JSON.stringify({
      data: {
        products: {
          nodes: [{
              id: "gid://shopify/Product/1",
              title: "AC Milan Self Check Shirt",
              handle: "ac-milan-self-check-shirt",
              status: "ACTIVE",
              vendor: "Self Check",
              productType: "AC Milan",
              onlineStoreUrl: "https://shop.example/products/ac-milan-self-check-shirt",
              featuredImage: { url: "https://cdn.example.test/front.png" },
              images: { edges: [{ node: { url: "https://cdn.example.test/front.png" } }] },
              variants: {
                nodes: [{
                    id: "gid://shopify/ProductVariant/1",
                    title: "M",
                    sku: "ACM-SELF-M",
                    contextualPricing: {
                      price: { amount: "32.99", currencyCode: "USD" },
                      compareAtPrice: { amount: "115.00", currencyCode: "USD" },
                    },
                    availableForSale: true,
                    inventoryQuantity: 3,
                    selectedOptions: [{ name: "Size", value: "M" }],
                }],
              },
          }],
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await searchAdminPromotionProducts({ siteId, query: "AC Milan", limit: 3 });
    assert.equal(requests.length, 2, "admin product search should resolve Shopify Markets before reading products");
    assert.match(JSON.parse(requests[0].options.body).query, /^query\s+AioveMarkets/m, "admin product search should read Shopify Markets first");
    assert.equal(result.items[0]?.name, "AC Milan Self Check Shirt", "admin product search should use stored Shopify source");
    assert.equal(result.items[0]?.sku, "ACM-SELF-M", "admin product search should expose Shopify variant SKU");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("admin site product source self-check passed");
} finally {
  if (siteId) {
    await db.execute("DELETE FROM site_geo_regions WHERE site_id = ?", [siteId]).catch(() => {});
    await db.execute("DELETE FROM sites WHERE id = ?", [siteId]).catch(() => {});
  }
  await closeDbPool();
}
