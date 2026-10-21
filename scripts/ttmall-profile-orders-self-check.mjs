import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTtmallProfileOrderDetail, getTtmallProfileOrderHistory } from "../server/ttmall-profile-order-history-service.js";
import { profileModalBodyHtml } from "../src/features/profile-modal/profile-modal-content.js";

const service = readFileSync("server/ttmall-profile-order-history-service.js", "utf8");
const routes = readFileSync("server/profile-routes.js", "utf8");
const checkoutClient = readFileSync("server/ttmall-checkout-client-service.js", "utf8");
const profileActions = readFileSync("src/app/app-profile-actions.js", "utf8");
const appState = readFileSync("src/app/app-state.js", "utf8");
const authState = readFileSync("src/app/app-auth-state.js", "utf8");
const mainUiActions = readFileSync("src/app/app-main-ui-actions.js", "utf8");
const checkoutPanel = readFileSync("src/features/chat/chat-ttmall-checkout-panel.js", "utf8");
const main = readFileSync("src/app/main.js", "utf8");

const user = { id: "user-1", site_id: "site-1", site_slug: "ttmall-binding-test" };
const binding = { token: "server-only-token", source: { apiBaseUrl: "https://api.example.test" }, site: { id: "site-1" } };
const canonicalImageUrl = "https://cdn.example.test/catalog/product-101.png";
const dependencies = {
  resolveSiteAccess: async () => ({ mode: "ttmall", source: { apiBaseUrl: "https://api.example.test" }, site: { id: "site-1" } }),
  getBinding: async () => ({ mode: "ttmall", requiresBinding: false }),
  ensureBinding: async () => binding,
  listCachedProducts: async () => [{
    external_product_key: "101",
    product_payload_json: JSON.stringify({ productId: "101", imageUrl: canonicalImageUrl }),
  }],
  listOrders: async () => ({
    total: 2,
    orders: [{
      orderNumber: "TT-ORDER-100",
      state: "Unpaid",
      createdAt: 1787737457,
      orderAmount: "40.00",
      shippingFee: "2.99",
      totalAmount: "42.99",
      currencyCode: "USD",
      shippingMethod: "Tracked",
      tracking: "TRACK-1",
      items: [{ productId: "101", title: "Test jersey", image: "https://cdn.example.test/stale-thumbnail.png", quantity: 2, option: "M", unitPrice: "20.00", totalPrice: "40.00" }],
    }],
  }),
  getOrder: async () => ({
    orderNumber: "TT-ORDER-100",
    state: "Paid",
    createdAt: 1787737457,
    totalAmount: "42.99",
    currencyCode: "USD",
    items: [{ productId: "101", title: "Test jersey", image: "https://cdn.example.test/stale-thumbnail.png", quantity: 2, option: "M", unitPrice: "20.00", totalPrice: "40.00" }],
  }),
};

const history = await getTtmallProfileOrderHistory(user, dependencies);
assert.deepEqual(history.account, { provider: "TTMall", linked: true });
assert.equal(history.provider, "ttmall");
assert.equal(history.orders.length, 1);
assert.equal(history.orders[0].id, "TT-ORDER-100");
assert.equal(history.orders[0].financialStatus, "PENDING");
assert.equal(history.orders[0].items[0].imageUrl, canonicalImageUrl, "a same-site canonical product image must override a stale upstream order thumbnail");
assert.equal(history.orders[0].total.currencyCode, "USD");
assert.deepEqual(history.orders[0].items[0].unitPrice, { amount: "20.00", currencyCode: "USD" }, "a documented TTMall product_price must be preserved as the direct item price");
assert.equal(history.orders[0].shipments[0].tracking[0].number, "TRACK-1");

const mismatchedCacheHistory = await getTtmallProfileOrderHistory(user, {
  ...dependencies,
  listCachedProducts: async () => [{
    external_product_key: "999",
    product_payload_json: JSON.stringify({ productId: "999", imageUrl: "https://cdn.example.test/other-site-or-product.png" }),
  }],
});
assert.equal(
  mismatchedCacheHistory.orders[0].items[0].imageUrl,
  "https://cdn.example.test/stale-thumbnail.png",
  "a cached image for another product must never replace an order item's own image",
);

const missingCurrencyHistory = await getTtmallProfileOrderHistory(user, {
  ...dependencies,
  listOrders: async () => ({
    total: 1,
    orders: [{
      ...(await dependencies.listOrders()).orders[0],
      currencyCode: "",
    }],
  }),
});
assert.deepEqual(missingCurrencyHistory.orders[0].items[0].unitPrice, { amount: "20.00", currencyCode: "USD" }, "a TTMall order without a provider currency must use the confirmed USD settlement rule");

const conflictingCurrencyHistory = await getTtmallProfileOrderHistory(user, {
  ...dependencies,
  listOrders: async () => ({
    total: 1,
    orders: [{
      ...(await dependencies.listOrders()).orders[0],
      currencyCode: "EUR",
    }],
  }),
});
assert.equal(conflictingCurrencyHistory.orders[0].items[0].unitPrice, null, "a non-USD provider currency must not be mislabeled under the TTMall USD settlement rule");

const missingDirectPriceHistory = await getTtmallProfileOrderHistory(user, {
  ...dependencies,
  listOrders: async () => ({
    total: 1,
    orders: [{
      ...(await dependencies.listOrders()).orders[0],
      items: [{ productId: "101", title: "Test jersey", quantity: 2, option: "M", totalPrice: "40.00" }],
    }],
  }),
});
assert.equal(missingDirectPriceHistory.orders[0].items[0].unitPrice, null, "product_total_price must not be used to fabricate a unit price");

const detail = await getTtmallProfileOrderDetail(user, "TT-ORDER-100", dependencies);
assert.equal(detail.provider, "ttmall");
assert.equal(detail.order.financialStatus, "PAID");
assert.equal(detail.order.items[0].variantTitle, "M");
assert.equal(detail.order.items[0].imageUrl, canonicalImageUrl, "TTMall order details must use the same same-site canonical image resolver");
await assert.rejects(
  () => getTtmallProfileOrderDetail(user, "TT-ORDER-100", {
    ...dependencies,
    getOrder: async () => ({ ...detail.order, orderNumber: "TT-ORDER-OTHER" }),
  }),
  (error) => error?.publicCode === "TTMALL_ORDER_NOT_FOUND",
  "a TTMall order detail from a different binding must not be exposed",
);

const unlinked = await getTtmallProfileOrderHistory(user, { ...dependencies, ensureBinding: async () => null });
assert.deepEqual(unlinked, { ok: true, provider: "ttmall", account: { provider: "TTMall", linked: false }, orders: [], hasMore: false });
assert.equal(await getTtmallProfileOrderHistory(user, { ...dependencies, getBinding: async () => ({ mode: "not_ttmall" }) }), null, "Shopify sites must keep their existing profile order path");
await assert.rejects(
  () => getTtmallProfileOrderHistory({ ...user, site_id: "other-site" }, dependencies),
  (error) => error?.publicCode === "TTMALL_ORDER_SITE_UNAVAILABLE",
  "a session site ID mismatch must not reuse another site's TTMall binding",
);
const staleEvents = [];
await assert.rejects(
  () => getTtmallProfileOrderHistory(user, {
    ...dependencies,
    listOrders: async () => { throw Object.assign(new Error("reauth"), { publicCode: "TTMALL_BINDING_REAUTH_REQUIRED" }); },
    markStale: async (input) => staleEvents.push(input),
  }),
  (error) => error?.publicCode === "TTMALL_BINDING_REAUTH_REQUIRED",
  "a rejected TTMall token must require reauthentication",
);
assert.equal(staleEvents.length, 1, "a rejected TTMall token must mark only its binding stale");
await assert.rejects(
  () => getTtmallProfileOrderHistory(user, {
    ...dependencies,
    listOrders: async () => { throw Object.assign(new Error("upstream"), { publicCode: "TTMALL_CHECKOUT_UPSTREAM_UNAVAILABLE" }); },
    markStale: async () => staleEvents.push({ unexpected: true }),
  }),
  (error) => error?.publicCode === "TTMALL_ORDER_UPSTREAM_FAILED",
  "an upstream order error must stay retryable without treating the binding as stale",
);
assert.equal(staleEvents.length, 1, "a TTMall upstream error must not stale a valid binding");

assert.match(routes, /getTtmallProfileOrderHistory/, "profile order list must ask the TTMall adapter before the existing Shopify fallback");
assert.match(routes, /getTtmallProfileOrderDetail/, "profile order detail must ask the TTMall adapter before the existing Shopify fallback");
assert.match(routes, /ttmallOrders \|\| await getShopifyOrderHistory/, "a non-TTMall site must retain the existing Shopify order list behavior");
assert.match(routes, /ttmallOrder \|\| await getShopifyOrderDetail/, "a non-TTMall site must retain the existing Shopify order detail behavior");
assert.match(service, /ensureActiveTtmallBinding/, "TTMall profile order reads must reuse the server-owned active binding");
assert.match(service, /listTtmallOrders/, "TTMall profile order list must reuse the existing checkout client reader");
assert.match(service, /getTtmallOrder/, "TTMall profile order detail must reuse the existing checkout client reader");
assert.match(service, /ORDER_PAGE_SIZE/, "TTMall profile order list must be bounded");
assert.match(service, /resolveTtmallRuntimeAccess/, "TTMall profile order reads must resolve and validate the current site");
assert.match(service, /TTMALL_ORDER_SITE_UNAVAILABLE/, "TTMall profile order reads must reject a user/site mismatch");
assert.match(service, /markTtmallAccountBindingStale/, "TTMall order reads must mark a rejected binding stale");
assert.doesNotMatch(service, /access_token_encrypted|ttmall_email|Authorization|redirect_link|billing|shipping_address/, "profile order responses must not expose binding or payment fields");
assert.match(checkoutClient, /currencyCode: normalizeCurrencyCode/, "TTMall order mapping may only expose a strict ISO currency code when provided by TTMall");
assert.match(profileActions, /result\?\.provider === "shopify"/, "TTMall Orders must skip the Shopify reconciliation POST");
assert.match(appState, /profile:[\s\S]*orders:\s*\{[\s\S]*data:\s*null/, "profile Orders state must be initialized before actions access it");
assert.match(authState, /resetProfileState[\s\S]*profile\.orders\s*=\s*\{[\s\S]*data:\s*null/, "profile Orders state must be reset on logout/expiry");
assert.match(mainUiActions, /loadProfileOrders\(\{\s*force:\s*true\s*\}\)/, "opening or switching to Orders must bypass stale cached data");
assert.match(checkoutPanel, /aiove:ttmall-order-created/, "TTMall checkout success must invalidate the profile Orders cache");
assert.match(main, /aiove:ttmall-order-created[\s\S]*profile\.orders\.data = null/, "the app must clear cached Orders after a TTMall order result");

const listHtml = profileModalBodyHtml("orders", { email: "account@example.test" }, {
  orders: { data: history },
}, "English");
assert.match(listHtml, /TTMall · account@example\.test/, "the existing profile Orders surface must render its TTMall account identity");
assert.match(listHtml, /Test jersey/, "the existing order card must render TTMall product content");
assert.match(listHtml, /TT-ORDER-100/, "the existing order card must render the TTMall order reference");
assert.match(listHtml, /\$42\.99/, "the existing order card must render a TTMall amount only when the provider supplied a valid currency");
const detailHtml = profileModalBodyHtml("orders", { email: "account@example.test" }, {
  orders: { detail: detail.order },
}, "English");
assert.match(detailHtml, /pm-order-detail-price/, "TTMall must render the documented direct product_price when the provider supplied a valid currency");
assert.match(checkoutClient, /unitPrice: safeString\(item\?\.product_price\)/, "TTMall order mapping must read the documented direct product_price field");

console.log("TTMall profile orders self-check passed");
