import assert from "node:assert/strict";
import dns from "node:dns/promises";
import fs from "node:fs";
import { addTtmallCartLine, clearTtmallCart, getTtmallCart, normalizeTtmallCartSummary } from "../server/ttmall-cart-client-service.js";
import { fetchTtmallBoundUserJson } from "../server/ttmall-bound-user-client-service.js";
import { resetTtmallClientCachesForTests } from "../server/product-source-ttmall-client-service.js";

const source = {
  apiBaseUrl: "https://api.example.com",
  websiteId: "4",
  cacheKey: "https://api.example.com|4",
};
const originalFetch = globalThis.fetch;
const originalLookup = dns.lookup;
const requests = [];

try {
  resetTtmallClientCachesForTests();
  dns.lookup = async (hostname, options = {}) => {
    if (hostname === "api.example.com") {
      return options.all ? [{ address: "93.184.216.34", family: 4 }] : { address: "93.184.216.34", family: 4 };
    }
    return originalLookup(hostname, options);
  };
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    requests.push({ requestUrl, options });
    if (requestUrl.hostname === "cloudflare-dns.com") {
      return jsonResponse({ Answer: [{ type: 1, data: "93.184.216.34" }] });
    }
    if (requestUrl.pathname === "/v1/token/4") {
      assert.equal(options.method, "GET", "token bootstrap must remain a read request");
      return jsonResponse({ data: buildJwt({ websiteId: "4" }) });
    }
    assert.match(options.headers.Authorization || "", /^Bearer /, "cart calls must use the server-side temporary token");
    if (requestUrl.pathname === "/v1/cart") {
      assert.equal(options.method, "POST", "adding a line must use the documented cart write method");
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload, {
        id: "101",
        list: JSON.stringify([{ sku: "SKU-M", quantity: 2, option: [] }]),
        is_temp: 1,
      }, "cart writes must use the verified product, SKU, quantity and temporary-cart contract");
      return jsonResponse({ data: { hash: "test-hash", list: [{ quantity: 2 }] } });
    }
    if (requestUrl.pathname === "/v1/cart/clear") {
      assert.equal(options.method, "POST", "clearing a cart must remain a controlled POST request");
      assert.deepEqual(JSON.parse(options.body), { hash: "test-hash" });
      return jsonResponse({ data: { list: [] } });
    }
    if (requestUrl.pathname === "/v1/cart/test-hash") {
      assert.equal(options.method, "GET", "reading a cart must remain a read request");
      return jsonResponse({ data: { rows: [{ quantity: 2 }], quantity: 2 } });
    }
    if (requestUrl.pathname === "/v1/address") {
      assert.equal(options.method, "GET", "checkout preparation may only read the documented address endpoint");
      return jsonResponse({ data: { list: [{ id: "address-1" }] } });
    }
    throw new Error(`unexpected request ${requestUrl}`);
  };

  assert.deepEqual(normalizeTtmallCartSummary({ data: { hash: "h", list: [{ sku: "SKU-S", quantity: 2 }, { sku: "SKU-M", quantity: 3 }] } }), { hash: "h", itemCount: 5, lines: [{ cartLineId: "", productId: "", sku: "SKU-S", quantity: 2 }, { cartLineId: "", productId: "", sku: "SKU-M", quantity: 3 }] });
  assert.deepEqual(normalizeTtmallCartSummary({ data: { rows: [{ sku: "SKU-S", quantity: 2 }, { sku: "SKU-M", quantity: 3 }], quantity: 5 } }), { hash: "", itemCount: 5, lines: [{ cartLineId: "", productId: "", sku: "SKU-S", quantity: 2 }, { cartLineId: "", productId: "", sku: "SKU-M", quantity: 3 }] }, "cart reads may place rows directly under data");
  assert.deepEqual(await addTtmallCartLine(source, { productId: "101", sku: "SKU-M", quantity: 2 }), { hash: "test-hash", itemCount: 2, lines: [] });
  assert.deepEqual(await getTtmallCart(source, { hash: "test-hash" }), { hash: "test-hash", itemCount: 2, lines: [] }, "cart reads must retain the server-owned hash when TTMall omits it");
  assert.deepEqual(await clearTtmallCart(source, { hash: "test-hash" }), { hash: "test-hash", itemCount: 0, lines: [] }, "clear must retain its server-only cart identity when the provider omits it");
  assert.deepEqual(
    await fetchTtmallBoundUserJson(source, "bound-user-token", "/v1/cart/test-hash"),
    { data: { rows: [{ quantity: 2 }], quantity: 2 } },
    "bound-user cart reads must use the bound TTMall user token without exposing it to the browser",
  );
  assert.deepEqual(
    await fetchTtmallBoundUserJson(source, "bound-user-token", "/v1/address"),
    { data: { list: [{ id: "address-1" }] } },
    "the bound-user client may read the documented address list but no order or payment endpoint",
  );
  await assert.rejects(
    () => fetchTtmallBoundUserJson(source, "bound-user-token", "/v1/order/generate_order_to_pay"),
    /TTMall test action is unavailable/,
    "the bound-user client must reject order endpoints",
  );
  await assert.rejects(
    () => fetchTtmallBoundUserJson(source, "bound-user-token", "/v1/cart/checkpaypal"),
    /TTMall test action is unavailable/,
    "the obsolete PayPal shortcut must not remain callable through the bound-user client",
  );
  assert.equal(requests.filter(({ requestUrl }) => requestUrl.pathname === "/v1/token/4").length, 1, "cart writes must reuse the shared TTMall token cache");

  const serviceSource = fs.readFileSync("server/ttmall-cart-service.js", "utf8");
  const runtimeAccessSource = fs.readFileSync("server/ttmall-runtime-access-service.js", "utf8");
  const clientSource = fs.readFileSync("server/ttmall-cart-client-service.js", "utf8");
  const boundUserClientSource = fs.readFileSync("server/ttmall-bound-user-client-service.js", "utf8");
  const routeSource = fs.readFileSync("server/ttmall-cart-routes.js", "utf8");
  const checkoutServiceSource = fs.readFileSync("server/ttmall-checkout-service.js", "utf8");
  const preparationRouteSource = fs.readFileSync("server/ttmall-checkout-routes.js", "utf8");
  assert.match(runtimeAccessSource, /TTMALL_PRODUCTION_PUBLIC_URL_REQUIRED/, "production cart writes must require a public HTTPS app URL");
  assert.match(runtimeAccessSource, /TTMALL_PRODUCTION_SOURCE_REQUIRED/, "production cart writes must require a public HTTPS site source");
  assert.match(runtimeAccessSource, /api\.taotens\.com/, "local test carts must remain pinned to the test host");
  assert.doesNotMatch(`${serviceSource}\n${clientSource}\n${routeSource}`, /\/v1\/order(?:["'`/]|$)/, "cart sync must not invoke any order endpoint");
  assert.match(routeSource, /requireAuth/, "cart sync must require an authenticated Alove user");
  assert.match(routeSource, /assertPublicAppOrigin/, "cart sync writes must enforce the same public-origin guard as account binding");
  assert.match(serviceSource, /TTMALL_CART_SYNC_TIMEOUT_MS = 15_000/, "cart sync must not inherit the short generic product-read timeout");
  assert.doesNotMatch(`${serviceSource}\n${routeSource}`, /startTtmallCheckout|\/api\/product-cart\/ttmall\/checkout/, "the obsolete cart checkout endpoint must not remain beside the dedicated checkout flow");
  assert.match(checkoutServiceSource, /createTtmallOrderWithPayment/, "checkout order creation must stay in its dedicated, user-token service");
  assert.match(checkoutServiceSource, /paymentId: chosenPayment\.id,[\s\S]*zoneId: address\.zoneId,[\s\S]*countryId: address\.countryId,[\s\S]*stateId: address\.stateId/, "direct TTMall order creation must include the selected payment and complete address region");
  assert.match(checkoutServiceSource, /TTMALL_ADDRESS_REGION_INCOMPLETE/, "checkout must fail before order creation when a saved address lacks the documented region fields");
  assert.doesNotMatch(checkoutServiceSource, /startTtmallOrderPayment/, "the legacy separate payment POST must not remain in checkout orchestration");
  assert.doesNotMatch(checkoutServiceSource, /TTMALL_PAYMENT_SENSITIVE_INPUT_REQUIRED/, "checkout must submit every payment method returned by the current TTMall site");
  assert.match(serviceSource, /readActiveTtmallAccountToken/, "cart sync must obtain the bound token through the lifecycle gate");
  assert.match(serviceSource, /previousCartCleared/, "cart synchronization must track when it has cleared a previously AIOVE-owned temporary cart");
  assert.match(serviceSource, /clearTtmallCart\(source, \{ hash: current\.cart_hash, timeoutMs, userToken \}\)/, "bound-user cart synchronization must clear the previous AIOVE-owned cart before rebuilding its current rows");
  assert.match(serviceSource, /getTtmallCart\(source, \{ hash, timeoutMs, userToken \}\)/, "each rebuilt cart must be reread by its server-owned hash before it is accepted as synchronized");
  assert.match(serviceSource, /hasMatchingTtmallCartRows\(upstreamCart\.lines, verifiedRows\)/, "the TTMall cart reread must match the requested SKU quantities");
  assert.doesNotMatch(`${serviceSource}\n${routeSource}`, /checkpaypal|paypal\.com/i, "the obsolete PayPal shortcut must not remain in the TTMall checkout route");
  assert.match(boundUserClientSource, /pathname !== "\/v1\/cart\/checkpaypal"/, "the bound-user transport must explicitly reject the obsolete PayPal shortcut");
  assert.match(serviceSource, /syncOwnedTtmallCart[\s\S]*TTMALL_BINDING_REAUTH_REQUIRED[\s\S]*markTtmallAccountBindingStale/, "sync must mark an expired bound account stale instead of leaving a misleading active binding");
  assert.match(boundUserClientSource, /TTMALL_BINDING_REAUTH_REQUIRED/, "expired bound-user tokens must require a new account link");
  assert.match(boundUserClientSource, /isCartOrAddressReadPath/, "the original cart transport must retain its narrow policy");
  assert.match(boundUserClientSource, /fetchTtmallCheckoutUserJson[\s\S]*isCheckoutPath/, "checkout must use a separately named fixed route policy");
  assert.match(checkoutServiceSource, /ensureActiveTtmallBinding/, "checkout access must use the token lifecycle gate");
  assert.match(checkoutServiceSource, /readVerifiedCart/, "checkout must reread the server-owned cart before order creation");
  assert.match(checkoutServiceSource, /cart_snapshot_hash/, "checkout attempts must be snapshotted outside the mutable cart session");
  assert.match(preparationRouteSource, /requireAuth/, "checkout routes must require an AIOVE session");
  assert.match(preparationRouteSource, /assertPublicAppOrigin/, "checkout writes must enforce the public-origin guard");
  console.log("TTMall cart self-check passed");
} finally {
  globalThis.fetch = originalFetch;
  dns.lookup = originalLookup;
  resetTtmallClientCachesForTests();
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function buildJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  return `${header}.${body}.signature`;
}
