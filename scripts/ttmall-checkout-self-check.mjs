import assert from "node:assert/strict";
import dns from "node:dns/promises";
import {
  createTtmallOrderWithPayment,
  listTtmallAddresses,
  listTtmallAddressRegions,
  listTtmallPaymentMethods,
  listTtmallShippingMethods,
} from "../server/ttmall-checkout-client-service.js";
import { fetchTtmallCheckoutUserJson } from "../server/ttmall-bound-user-client-service.js";

const checkoutServiceSource = await (await import("node:fs/promises")).readFile(new URL("../server/ttmall-checkout-service.js", import.meta.url), "utf8");

const source = { apiBaseUrl: "https://api.example.com", cacheKey: "https://api.example.com|4" };
const originalFetch = globalThis.fetch;
const originalLookup = dns.lookup;
const requests = [];
const submittedBillingAddressIds = new Set();

try {
  dns.lookup = async (hostname, options = {}) => hostname === "api.example.com"
    ? (options.all ? [{ address: "93.184.216.34", family: 4 }] : { address: "93.184.216.34", family: 4 })
    : originalLookup(hostname, options);
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    requests.push({ requestUrl, options });
    if (requestUrl.hostname === "cloudflare-dns.com") return response({ Answer: [{ type: 1, data: "93.184.216.34" }] });
    assert.match(options.headers.Authorization || "", /^Bearer /, "checkout calls must carry the server-owned user token");
    if (requestUrl.pathname === "/v1/address") return response({ data: { list: [{ address_id: "7", country_id: "2", firstname: "A", lastname: "User", line: "1 Test Street", email: "user@example.com" }] } });
    if (requestUrl.pathname === "/v1/zone") return response({ data: [{ zone_id: "1", zone_name: "Europe", countries: [{ country_id: "143", country_name: "Hungary", iso_code: "HU", states: [{ state_id: "4", state_name: "Budapest", state_code: "BP" }] }] }] });
    if (requestUrl.pathname === "/v1/shipping") {
      assert.equal(requestUrl.searchParams.get("check_list"), '["11"]');
      return response({ data: { list: [{ shipping_id: "3", shipping_name: "Tracked", price: "4.00" }] } });
    }
    if (requestUrl.pathname === "/v1/payment" && options.method === "GET") return response({ data: { list: [{ payment_id: "4", payment_name: "Redirect" }, { payment_id: "5", payment_name: "Western Union", payment_param: { wise_number: "required" } }, { payment_id: "6", payment_name: "Result" }, { payment_id: "7", payment_name: "Pending" }, { payment_id: "19", payment_name: "Card", payment_param: { card_num: "required" } }] } });
    if (requestUrl.pathname === "/v1/order/generate_order_to_pay") {
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded;charset=UTF-8", "TTMall direct order creation must use form key-value encoding");
      const body = Object.fromEntries(new URLSearchParams(options.body));
      submittedBillingAddressIds.add(body.billing_address_id);
      assert.deepEqual({
        hash: body.hash,
        check_list: body.check_list,
        shipping_address_id: body.shipping_address_id,
        billing_address_id: body.billing_address_id,
        shipping_id: body.shipping_id,
        payment_id: body.payment_id,
        zone_id: body.zone_id,
        country_id: body.country_id,
        state_id: body.state_id,
      }, { hash: "owned-hash", check_list: '["11"]', shipping_address_id: "7", billing_address_id: body.billing_address_id, shipping_id: "3", payment_id: body.payment_id, zone_id: "1", country_id: "2", state_id: "4" });
      if (body.payment_id === "4") return response({ data: { order_number: "ORDER-1234", redirect_link: "https://www.paypal.com/checkout/next", message: "Continue at https://unsafe.example.test/?token=secret" } });
      if (body.payment_id === "6") return response({ data: { succeed: true, message: "<h3>Provider markup</h3>" } });
      if (body.payment_id === "7") return response({ data: { type: 3, order_number: "ORDER-1236", cart_hash: "new-owned-hash-3", state: "Waiting For Payment", message: "Continue in TTMall" } });
      if (body.payment_id === "8") return response({ data: { type: 1, order_number: "ORDER-1237", cart_hash: "new-owned-hash-4", redirect_link: "https://unsafe.example.com/next" } });
      if (body.payment_id === "9") return response({}, 500);
      if (body.payment_id === "10") return response({}, 400);
      if (body.payment_id === "11") return response({ data: { order_number: "ORDER-1238", succeed: 1 } });
      if (body.payment_id === "12") return response({ data: { succeed: false, code: "PAYMENT_DECLINED", message: "Payment declined." } });
      if (body.payment_id === "13") return response({ data: { order_number: "ORDER-1240", succeed: 0, redirect_link: "https://www.paypal.com/checkout/next" } });
      if (body.payment_id === "14") return response({ data: { type: 2, order_number: "ORDER-1241", cart_hash: "new-owned-hash-6", message: "<h3>Provider markup</h3>" } });
      if (body.payment_id === "15") return response({ data: { succeed: 0, code: "WESTERN_UNION_UNAVAILABLE", message: "Western Union is unavailable. Bearer private-token https://unsafe.example.com/checkout", token: "private-token" } });
      if (body.payment_id === "16") return textResponse("<h3>Provider markup</h3>", 200, "text/html");
      if (body.payment_id === "17") throw new Error("provider connection failed");
      if (body.payment_id === "18") return response({ data: { type: 2, cart_hash: "new-owned-hash-7" } });
      if (body.payment_id === "19") return response({ data: { type: 3, order_number: "ORDER-1250", state: "Waiting For Payment" } });
      throw new Error(`unexpected payment ${body.payment_id}`);
    }
    throw new Error(`unexpected ${requestUrl} ${options.method}`);
  };
  assert.deepEqual(await listTtmallAddresses(source, "user-token"), [{ id: "7", zoneId: "", countryId: "2", stateId: "", tag: "", firstName: "A", lastName: "User", line: "1 Test Street", addressInvoice: "", postcode: "", city: "", phone: "", email: "user@example.com", country: "", state: "", isDefault: false }]);
  assert.deepEqual(await listTtmallAddressRegions(source, "user-token"), [{ id: "1", name: "Europe", countries: [{ id: "143", name: "Hungary", code: "HU", states: [{ id: "4", name: "Budapest", code: "BP" }] }] }], "TTMall country_name/state_name fields must populate the address selector");
  assert.equal((await listTtmallShippingMethods(source, "user-token", { countryId: "2", addressId: "7", cartHash: "owned-hash", cartLineIds: ["11"] }))[0].id, "3");
  const payments = await listTtmallPaymentMethods(source, "user-token", { productIds: ["9"], shippingAddressId: "7" });
  assert.equal(payments[0].requiresSensitiveInput, false);
  assert.equal(payments.find((payment) => payment.id === "5")?.requiresSensitiveInput, false, "non-card payment parameters must remain selectable in ALOVE");
  assert.equal(payments.find((payment) => payment.id === "19")?.requiresSensitiveInput, true, "card payment parameters must remain unavailable to ALOVE");
  const createInput = { cartHash: "owned-hash", cartLineIds: ["11"], shippingAddressId: "7", shippingId: "3", zoneId: "1", countryId: "2", stateId: "4" };
  assert.deepEqual(await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "4" }), {
    type: 0, orderNumber: "ORDER-1234", nextCartHash: "", redirectUrl: "https://www.paypal.com/checkout/next", redirectUnavailable: false, state: "", message: "", cartConsumed: true, paymentOutcome: "redirect", confirmationLevel: "payment_redirected",
  });
  assert.deepEqual(await createTtmallOrderWithPayment(source, "user-token", { ...createInput, billingAddressId: "8", paymentId: "4" }), {
    type: 0, orderNumber: "ORDER-1234", nextCartHash: "", redirectUrl: "https://www.paypal.com/checkout/next", redirectUnavailable: false, state: "", message: "", cartConsumed: true, paymentOutcome: "redirect", confirmationLevel: "payment_redirected",
  }, "an explicit billing address must be preserved instead of being replaced with the delivery address");
  assert.deepEqual(await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "6" }), {
    type: 0, orderNumber: "", nextCartHash: "", redirectUrl: "", redirectUnavailable: false, state: "", message: "", cartConsumed: true, paymentOutcome: "succeeded", confirmationLevel: "payment_succeeded",
  }, "a no-redirect succeed=true result must finish payment even without legacy checkout fields");
  assert.deepEqual(await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "7" }), {
    type: 3, orderNumber: "ORDER-1236", nextCartHash: "new-owned-hash-3", redirectUrl: "", redirectUnavailable: false, state: "Waiting For Payment", message: "", cartConsumed: true, paymentOutcome: "pending", confirmationLevel: "payment_pending",
  }, "a confirmed order without a redirect or explicit payment result must remain payment-pending, not be rejected");
  assert.equal((await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "19" })).orderNumber, "ORDER-1250", "a site-provided payment method marked sensitive must still be submitted without collecting its provider fields");
  const untrustedRedirectOrder = await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "8" });
  assert.equal(untrustedRedirectOrder.redirectUrl, "", "an untrusted redirect must never be opened");
  assert.equal(untrustedRedirectOrder.paymentOutcome, "pending", "an untrusted redirect does not erase an otherwise confirmed order");
  assert.deepEqual(await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "11" }), {
    type: 0, orderNumber: "ORDER-1238", nextCartHash: "", redirectUrl: "", redirectUnavailable: false, state: "", message: "", cartConsumed: true, paymentOutcome: "succeeded", confirmationLevel: "payment_succeeded",
  }, "a no-redirect succeed=true result must remain successful when an order number is also supplied");
  assert.deepEqual(await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "12" }), {
    type: 0, orderNumber: "", nextCartHash: "", redirectUrl: "", redirectUnavailable: false, state: "", message: "", cartConsumed: true, paymentOutcome: "failed", confirmationLevel: "payment_failed",
  }, "a no-redirect succeed=false result must report a direct payment failure");
  assert.deepEqual(await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "13" }), {
    type: 0, orderNumber: "ORDER-1240", nextCartHash: "", redirectUrl: "https://www.paypal.com/checkout/next", redirectUnavailable: false, state: "", message: "", cartConsumed: true, paymentOutcome: "redirect", confirmationLevel: "payment_redirected",
  }, "a safe redirect must take precedence over succeed=false because payment continues in TTMall");
  assert.equal((await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "14" })).paymentOutcome, "pending", "a valid order number without a redirect or explicit payment result must remain payment-pending");
  await assert.rejects(
    () => createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "18" }),
    (error) => error?.publicCode === "TTMALL_ORDER_RESPONSE_INVALID",
    "a no-redirect response with neither a valid order number nor explicit payment result must remain unconfirmed",
  );
  const failedPayment = await createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "15" });
  assert.equal(failedPayment.paymentOutcome, "failed");
  assert.equal(failedPayment.message, "", "provider payment failure text must not be returned to the browser");
  await assert.rejects(() => createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "4", stateId: "" }), /valid TTMall option/);
  await assert.rejects(
    () => createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "9" }),
    (error) => error?.publicCode === "TTMALL_CHECKOUT_STATUS_UNKNOWN"
      && error?.ttmallCheckoutDiagnostic?.upstreamOutcome === "http_unconfirmed"
      && error?.ttmallCheckoutDiagnostic?.upstreamHttpStatus === 500,
    "ambiguous provider 5xx results must be held for confirmation instead of retried",
  );
  await assert.rejects(
    () => createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "10" }),
    (error) => error?.publicCode === "TTMALL_CHECKOUT_STATUS_UNKNOWN",
    "order-creation rejections must be held for confirmation because TTMall does not document side-effect guarantees",
  );
  await assert.rejects(
    () => createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "16" }),
    (error) => error?.publicCode === "TTMALL_CHECKOUT_RESPONSE_INVALID"
      && error?.ttmallCheckoutDiagnostic?.upstreamOutcome === "invalid_json"
      && error?.ttmallCheckoutDiagnostic?.upstreamHttpStatus === 200
      && error?.ttmallCheckoutDiagnostic?.upstreamResponseShape === "content:html",
    "a 2xx non-JSON checkout result must remain unconfirmed with a safe response-type diagnostic",
  );
  await assert.rejects(
    () => createTtmallOrderWithPayment(source, "user-token", { ...createInput, paymentId: "17" }),
    (error) => error?.publicCode === "TTMALL_CHECKOUT_STATUS_UNKNOWN"
      && error?.ttmallCheckoutDiagnostic?.upstreamOutcome === "transport_unknown"
      && error?.ttmallCheckoutDiagnostic?.upstreamHttpStatus === null,
    "a transport failure must remain unconfirmed with no raw transport detail persisted",
  );
  await assert.rejects(() => fetchTtmallCheckoutUserJson(source, "user-token", "/v1/cart/checkpaypal"), /test action is unavailable/);
  await assert.rejects(() => fetchTtmallCheckoutUserJson(source, "user-token", "/v1/payment", { method: "POST" }), /test action is unavailable/);
  assert.deepEqual([...submittedBillingAddressIds].sort(), ["7", "8"], "the form payload must fall back to delivery address only when no explicit billing address is selected");
  assert.equal(requests.some(({ requestUrl }) => requestUrl.pathname === "/v1/order"), false, "the legacy order creation endpoint must not remain callable");
  assert.match(checkoutServiceSource, /confirmation_pending/, "unknown order creation results must remain blocked for reconciliation");
  assert.match(checkoutServiceSource, /active_snapshot_key/, "concurrent order creation must use a database-backed snapshot lock");
  const blockingAttemptReader = checkoutServiceSource.slice(checkoutServiceSource.indexOf("async function readBlockingAttempt"), checkoutServiceSource.indexOf("async function createAttempt"));
  assert.doesNotMatch(blockingAttemptReader, /WHERE user_id = \? AND site_id = \? AND source_cache_key = \? AND attempt_status = 'confirmation_pending'/, "an unresolved checkout must not block a later, different cart snapshot");
  assert.match(checkoutServiceSource, /recordCreatedOrder\(access, \{ attemptId, created: payment, consumedCartHash: cart\.hash \}\)/, "cart session updates must be tied to the cart consumed by this attempt");
  assert.doesNotMatch(checkoutServiceSource, /UPDATE ttmall_cart_sessions SET cart_hash/, "a post-order checkout hash must never be reused as a TTMall product cart");
  assert.match(checkoutServiceSource, /DELETE FROM ttmall_cart_sessions[\s\S]*?AND cart_hash = \?/, "a confirmed or unresolved checkout must only clear the cart mapping it consumed");
  assert.match(checkoutServiceSource, /providerConfirmed \|\| UNKNOWN_OUTCOME_CODES\.has/, "a provider-confirmed order must remain fail-closed when local recording fails");
  assert.match(checkoutServiceSource, /invalidateConsumedCartSession\(access, cart\.hash\)/, "an unresolved checkout must invalidate only its consumed local cart session");
  assert.match(checkoutServiceSource, /payment\.paymentOutcome === "succeeded"/, "an explicit no-redirect succeed=true result must be persisted as payment success");
  assert.match(checkoutServiceSource, /payment\.paymentOutcome === "failed"/, "an explicit no-redirect succeed=false result must be persisted as payment failure");
  assert.match(checkoutServiceSource, /payment_succeeded/, "a completed no-redirect payment must not be recorded as pending");
  assert.match(checkoutServiceSource, /payment_failed/, "a completed no-redirect payment failure must not be recorded as pending");
  assert.match(checkoutServiceSource, /payment_pending/, "a confirmed order without a payment result must be recorded as pending instead of failed");
  assert.match(checkoutServiceSource, /buildSitePaymentFollowupMessage\(access\)/, "pending payment follow-up must use the current site context");
  assert.match(checkoutServiceSource, /order dashboard to complete payment/, "pending payment follow-up must direct the user to the site order dashboard");
  assert.doesNotMatch(checkoutServiceSource, /Payment is awaiting confirmation in TTMall/, "the pending payment message must not expose the provider name");
  assert.doesNotMatch(checkoutServiceSource, /Please continue payment in TTMall/, "the unavailable redirect message must use the site order dashboard instead");
  assert.doesNotMatch(checkoutServiceSource, /Follow the payment instructions in TTMall/, "the legacy pending payment message must not remain for a confirmed result");
  assert.match(checkoutServiceSource, /ttmallCheckoutDiagnostic/, "checkout attempt failures must receive the server-only diagnostic object");
  assert.match(checkoutServiceSource, /upstream_http_status/, "checkout attempts must persist an HTTP-status diagnostic separately from their public error code");
  console.log("TTMall checkout self-check passed");
} finally {
  globalThis.fetch = originalFetch;
  dns.lookup = originalLookup;
}

function response(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }); }
function textResponse(payload, status = 200, contentType = "text/plain") { return new Response(payload, { status, headers: { "content-type": contentType } }); }
