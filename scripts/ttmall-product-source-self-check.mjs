import assert from "node:assert/strict";
import dns from "node:dns/promises";
import {
  fetchTtmallHomepageProductSections,
  extractTtmallProductId,
  fetchTtmallProductById,
  fetchProductSummary,
  isTtmallProductSource,
  parseTtmallProductSource,
} from "../server/product-source-service.js";
import { resetTtmallProductSourceCachesForTests } from "../server/product-source-ttmall-service.js";

const source = "ttmall://api.example.com?websiteId=4";
assert.equal(isTtmallProductSource(source), true, "TTMall canonical source should be recognized");
assert.deepEqual(parseTtmallProductSource(source), {
  apiBaseUrl: "https://api.example.com",
  websiteId: "4",
  cacheKey: "https://api.example.com|4",
}, "TTMall source should expose only a HTTPS API origin and website ID");
assert.equal(parseTtmallProductSource("ttmall://api.example.com?websiteId=0"), null, "TTMall website ID must be positive");
assert.equal(extractTtmallProductId("https://shop.example.com/productdetail/Arsenal-Home-Jersey-2026-27/101"), "101", "TTMall public product URL should expose its stable product ID");

const originalFetch = globalThis.fetch;
const originalLookup = dns.lookup;
const requests = [];
let tokenCalls = 0;
let forceUnauthorized = false;
let sizeChartCalls = 0;
let ageDetailCalls = 0;
try {
  resetTtmallProductSourceCachesForTests();
  dns.lookup = async (hostname, options = {}) => {
    if (hostname === "fake.example.com") {
      return options?.all ? [{ address: "198.18.1.10", family: 4 }] : { address: "198.18.1.10", family: 4 };
    }
    if (hostname.endsWith(".example.com")) {
      return options?.all ? [{ address: "93.184.216.34", family: 4 }] : { address: "93.184.216.34", family: 4 };
    }
    return originalLookup(hostname, options);
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    requests.push({ url: requestUrl, options });
    assert.equal(options.redirect, "error", "TTMall reads must reject upstream redirects instead of following an unvalidated target");
    if (requestUrl.hostname === "cloudflare-dns.com") {
      assert.equal(options.dispatcher, undefined, "the fixed trusted DNS resolver should not recurse through the product-source dispatcher");
      return jsonResponse({ Answer: [{ type: 1, data: "93.184.216.34" }] });
    }
    assert.ok(options.dispatcher, "TTMall reads should pin the validated DNS result into the outbound connection");
    if (requestUrl.pathname.startsWith("/v1/token/")) {
      tokenCalls += 1;
      assert.equal(options.headers.Authorization, undefined, "TTMall token bootstrap must not send a stored secret");
      return jsonResponse({ data: buildTestJwt({ websiteId: requestUrl.pathname.split("/").at(-1) }) });
    }
    assert.match(options.headers.Authorization || "", /^Bearer /, "TTMall reads should use the temporary service token");
    if (requestUrl.pathname === "/v1/website") {
      if (decodeTestJwt(options.headers.Authorization).websiteId === "5") {
        return jsonResponse({ data: { WEBSITE_DOMAIN: "https://127.0.0.1", website_name: "Unsafe" } });
      }
      return jsonResponse({ data: {
        WEBSITE_DOMAIN: "https://shop.example.com",
        CDN_LINK: "https://cdn.example.com",
        website_name: "Example",
        exchange_rate: [{ name: "GBP", rate: 0.8, exchange_sign: "GBP£" }],
      } });
    }
    if (requestUrl.pathname === "/v1/search") {
      if (requestUrl.searchParams.get("keyword") === "upstream failure") {
        return jsonResponse({ code: 503 }, 503);
      }
      if (requestUrl.searchParams.get("keyword") === "slow response") {
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (requestUrl.searchParams.get("keyword") === "Kids age search") {
        return jsonResponse({ data: { list: Array.from({ length: 18 }, (_, index) => ({
          product_id: 201 + index,
          title: `Kids jersey ${index + 1}`,
          price: 30,
          is_stock: 1,
        })) } });
      }
      assert.equal(requestUrl.searchParams.get("keyword"), "Arsenal jersey", "TTMall search should preserve the complete product query");
      assert.equal(requestUrl.searchParams.get("limit"), "3", "TTMall search should respect the caller limit");
      return jsonResponse({ data: { list: [{ product_id: 101, title: "Arsenal Home Jersey 2026/27", price: 39.99, regular_price: 69.99, is_stock: 1 }] } });
    }
    if (/^\/v1\/product\/(?:20[1-9]|21[0-8])$/.test(requestUrl.pathname)) {
      ageDetailCalls += 1;
      const productId = Number(requestUrl.pathname.split("/").at(-1));
      return jsonResponse({ data: {
        product_id: productId,
        title: `Kids jersey ${productId - 200}`,
        price: 30,
        is_stock: 1,
        sup_attr: [{ name: "Size", value: { "1-2 years": [`SKU-${productId}`] } }],
        sku_list: { [`SKU-${productId}`]: 1 },
      } });
    }
    if (requestUrl.pathname === "/v1/product/101") {
      if (forceUnauthorized) {
        forceUnauthorized = false;
        return jsonResponse({}, 401);
      }
      return jsonResponse({ data: {
        product_id: 101,
        title: "Arsenal Home Jersey 2026/27",
        alias_title: "Arsenal-Home-Jersey-2026-27",
        price: 39.99,
        regular_price: 69.99,
        is_stock: 1,
        cover: "/upload/arsenal.png",
        image: ["https://127.0.0.1/private.png", "https://tracker.invalid/pixel.png"],
        sizechart_template_id: 7,
        sup_attr: [{ name: "Size", value: { S: ["SKU-S"], M: ["SKU-M"] } }],
        sku_list: { "SKU-S": 2, "SKU-M": 0 },
        attr_list: [
          { mode: "input", name: "Printing", attr_value: [{ attr_id: 9, attr_value: "Name", attr_price: 5 }] },
          { mode: "select", name: "Patch", attr_value: [{ attr_id: 10, attr_value: "League", attr_image: "https://127.0.0.1/patch.png" }] },
        ],
      } });
    }
    if (requestUrl.pathname === "/v1/sizechart/7") {
      sizeChartCalls += 1;
      return jsonResponse({ data: { list: [{ Length: { S: "70", M: "72" }, Chest: { S: "100", M: "104" } }] } });
    }
    if (requestUrl.pathname === "/v1/floor") {
      return jsonResponse({ data: { list: [
        {
          floor_id: 55,
          floor_title: "Latest kits",
          floor_sort: 100,
          display: 0,
          product: [{ product_list: [{ product_id: 101, title: "Arsenal Home Jersey 2026/27", alias_title: "Arsenal-Home-Jersey-2026-27", price: 39.99, regular_price: 69.99, is_stock: 1, cover: "/upload/arsenal.png" }] }],
        },
        {
          floor_id: 56,
          floor_title: "Retro kits",
          floor_sort: 999,
          display: 0,
          product: [{ product_list: [{ product_id: 102, title: "Arsenal Retro Jersey", alias_title: "Arsenal-Retro-Jersey", price: 42, is_stock: 1, cover: "/upload/retro.png" }] }],
        },
      ] } });
    }
    throw new Error(`unexpected TTMall request ${requestUrl}`);
  };

  const products = await fetchProductSummary(source, { query: "Arsenal jersey" }, { currency: "GBP", maxProducts: 3, timeoutMs: 2000, throwOnError: true });
  assert.equal(products.length, 1, "TTMall source should normalize search results");
  assert.equal(products[0].price, "£31.99", "TTMall product should convert the source base price using the upstream exchange rate");
  assert.equal(products[0].priceWas, "£55.99", "TTMall product should convert compare-at price using the same upstream exchange rate");
  assert.equal(products[0].url, "https://shop.example.com/productdetail/Arsenal-Home-Jersey-2026-27/101", "TTMall product should map to its public detail route");
  assert.equal(products[0].imageUrl, "https://cdn.example.com/upload/arsenal.png", "TTMall image should use the website CDN");
  assert.deepEqual(products[0].sizes.map(({ label, available, price }) => ({ label, available, price })), [
    { label: "S", available: true, price: "£31.99" },
    { label: "M", available: false, price: "£31.99" },
  ], "TTMall product should expose size inventory without leaking raw quantities");
  assert.equal(products[0].customizationOptions[0]?.name, "Name", "TTMall product should expose customization inputs");
  assert.equal(products[0].sizeChart, null, "search hydration should not fetch a size chart before the user opens product details");
  assert.equal(products[0].sizeChartResolved, false, "search results should tell the shared product panel to resolve full detail on open");
  assert.equal(sizeChartCalls, 0, "search hydration should avoid one size-chart request per candidate");
  assert.deepEqual(products[0].imageUrls, ["https://cdn.example.com/upload/arsenal.png"], "TTMall product media should reject absolute URLs outside verified website origins");
  assert.equal(products[0].customizationOptions[1]?.values?.[0]?.imageUrl, "", "TTMall customization media should reject private or unrelated absolute origins");
  assert.equal(products[0].purchaseMode, "product_detail", "TTMall products should explicitly use the public detail page instead of pretending to support variant checkout");

  const resolvedProduct = await fetchTtmallProductById(source, "101", { currency: "GBP", timeoutMs: 2000, throwOnError: true });
  assert.equal(resolvedProduct?.id, "101", "TTMall detail resolution should hydrate a product directly by stable ID");
  assert.equal(resolvedProduct?.sizes?.length, 2, "TTMall detail resolution should retain variant sizes");
  assert.deepEqual(resolvedProduct?.sizeChart?.columns, ["Size", "Length", "Chest"], "opened product details should expose the normalized size chart");
  assert.equal(resolvedProduct?.sizeChartResolved, true, "direct detail resolution should mark the size-chart lookup complete even when the source has no chart");
  assert.equal(sizeChartCalls, 1, "only direct product detail resolution should fetch the size chart");

  const ageProducts = await fetchProductSummary(source, {
    query: "Kids age search",
    requestedAgeRange: "1-2 years",
  }, { currency: "GBP", maxProducts: 18, timeoutMs: 2000, throwOnError: true });
  assert.equal(ageProducts.length, 18, "age searches should retain hydrated matches plus untouched summaries for the shared filter pipeline");
  assert.equal(ageProducts.slice(0, 10).every((product) => product.sizes?.[0]?.label === "1-2 years"), true, "the first age batch should contain enough hydrated exact matches for deterministic filtering");
  assert.equal(ageDetailCalls, 10, "age searches should stop detail hydration after one sufficient batch");
  assert.equal(sizeChartCalls, 1, "age filtering should not fetch candidate size charts");

  const sections = await fetchTtmallHomepageProductSections({ product_api_url: source, currency: "GBP" }, { timeoutMs: 2000 });
  assert.equal(sections.length, 2, "TTMall floor endpoint should map visible homepage floors");
  assert.equal(sections[0].sectionTitle, "Latest kits", "TTMall floor title should be preserved");
  assert.equal(sections[1].sectionTitle, "Retro kits", "TTMall floor order should follow the storefront response, not floor_sort direction");
  assert.equal(sections[0].products[0].name, "Arsenal Home Jersey 2026/27", "TTMall floor products should use the shared product contract");
  assert.equal(tokenCalls, 1, "TTMall temporary token should be reused across product and floor reads");
  assert.equal(requests.some(({ options }) => /Bearer /.test(options.headers?.Authorization || "")), true, "TTMall protected reads should be authorized");

  resetTtmallProductSourceCachesForTests();
  const retryTokenBaseline = tokenCalls;
  forceUnauthorized = true;
  const retriedProduct = await fetchTtmallProductById(source, "101", { currency: "GBP", timeoutMs: 2000, throwOnError: true });
  assert.equal(retriedProduct?.id, "101", "one upstream 401 should refresh the temporary token and retry once");
  assert.equal(tokenCalls - retryTokenBaseline, 2, "a 401 retry should issue exactly one replacement token request");

  resetTtmallProductSourceCachesForTests();
  const concurrentTokenBaseline = tokenCalls;
  await Promise.all([
    fetchTtmallProductById(source, "101", { currency: "GBP", timeoutMs: 2000, throwOnError: true }),
    fetchTtmallProductById(source, "101", { currency: "GBP", timeoutMs: 2000, throwOnError: true }),
  ]);
  assert.equal(tokenCalls - concurrentTokenBaseline, 1, "concurrent reads for the same source should share one token request");

  resetTtmallProductSourceCachesForTests();
  const isolatedTokenBaseline = tokenCalls;
  const isolatedProduct = await fetchTtmallProductById("ttmall://api.example.com?websiteId=6", "101", { currency: "GBP", timeoutMs: 2000, throwOnError: true });
  assert.equal(isolatedProduct?.id, "101", "a second website ID should remain readable with its own temporary token");
  assert.equal(tokenCalls - isolatedTokenBaseline, 1, "different website IDs must not share cached temporary tokens");

  resetTtmallProductSourceCachesForTests();
  const fakeIpProduct = await fetchTtmallProductById("ttmall://fake.example.com?websiteId=7", "101", { currency: "GBP", timeoutMs: 2000, throwOnError: true });
  assert.equal(fakeIpProduct?.id, "101", "a VPN benchmark Fake-IP should be replaced by a trusted public DNS answer before the pinned connection");
  assert.equal(requests.some(({ url }) => url.hostname === "cloudflare-dns.com"), true, "Fake-IP compatibility should use the fixed trusted DNS resolver");

  await assert.rejects(
    fetchProductSummary(source, { query: "upstream failure" }, { currency: "GBP", maxProducts: 3, timeoutMs: 2000, throwOnError: true }),
    /TTMall API HTTP 503/,
    "upstream 5xx responses should surface as source failures instead of empty success",
  );
  await assert.rejects(
    fetchProductSummary(source, { query: "slow response" }, { currency: "GBP", maxProducts: 3, timeoutMs: 10, throwOnError: true }),
    /AbortError|aborted/i,
    "upstream timeouts should abort deterministically",
  );

  resetTtmallProductSourceCachesForTests();
  await assert.rejects(
    fetchProductSummary("ttmall://api.example.com?websiteId=5", { query: "unsafe" }, { currency: "USD", maxProducts: 1, timeoutMs: 2000, throwOnError: true }),
    /public http\/https host/,
    "TTMall storefront origins returned by the upstream API must pass the same public-host guard",
  );
} finally {
  globalThis.fetch = originalFetch;
  dns.lookup = originalLookup;
  resetTtmallProductSourceCachesForTests();
}

console.log("TTMall product source self-check passed");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function buildTestJwt(extra = {}) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...extra })).toString("base64url");
  return `header.${payload}.signature`;
}

function decodeTestJwt(authorization = "") {
  const token = String(authorization || "").replace(/^Bearer\s+/i, "");
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}
