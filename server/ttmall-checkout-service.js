import { createHash } from "node:crypto";
import { SERVER_CONFIG } from "./config.js";
import { getDbPool, withTransaction } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { createId, encryptSecret } from "./security.js";
import { safeString } from "./product-source-shared-service.js";
import { ensureActiveTtmallBinding, markTtmallAccountBindingStale } from "./ttmall-account-binding-service.js";
import { getTtmallCart } from "./ttmall-cart-client-service.js";
import { assertSiteCommerceEnabled } from "./site-commerce-policy.js";
import {
  createTtmallAddress,
  createTtmallOrderWithPayment,
  deleteTtmallAddress,
  listTtmallAddressRegions,
  listTtmallAddresses,
  listTtmallPaymentMethods,
  listTtmallShippingMethods,
  normalizeTtmallCheckoutDiagnostic,
  updateTtmallAddress,
} from "./ttmall-checkout-client-service.js";

const checkoutFlights = new Map();
const TTMALL_CHECKOUT_READ_TIMEOUT_MS = 15_000;
const UNKNOWN_OUTCOME_CODES = new Set([
  "TTMALL_CHECKOUT_STATUS_UNKNOWN",
  "TTMALL_CHECKOUT_RESPONSE_INVALID",
  "TTMALL_ORDER_RESPONSE_INVALID",
]);

export async function getTtmallCheckoutState({ userId = "", siteSlug = "" } = {}) {
  const access = await resolveCheckoutAccess({ userId, siteSlug });
  const [cart, addresses] = await Promise.all([
    readVerifiedCart(access),
    listTtmallAddresses(access.source, access.token, { timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS }),
  ]);
  return {
    mode: "ttmall_checkout",
    cart: { itemCount: cart.itemCount },
    addresses,
    addressRegions: [],
    defaultAddressId: addresses.find((address) => address.isDefault)?.id || addresses[0]?.id || "",
  };
}

export async function getTtmallAddressRegions({ userId = "", siteSlug = "" } = {}) {
  const access = await resolveCheckoutAccess({ userId, siteSlug });
  return { zones: await listTtmallAddressRegions(access.source, access.token, { timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS }) };
}

export async function saveTtmallAddress({ userId = "", siteSlug = "", addressId = "", input = {} } = {}) {
  const access = await resolveCheckoutAccess({ userId, siteSlug });
  const address = safeString(addressId)
    ? await updateTtmallAddress(access.source, access.token, addressId, input, { timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS })
    : await createTtmallAddress(access.source, access.token, input, { timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS });
  return { address };
}

export async function removeTtmallAddress({ userId = "", siteSlug = "", addressId = "" } = {}) {
  const access = await resolveCheckoutAccess({ userId, siteSlug });
  const addresses = await listTtmallAddresses(access.source, access.token, { timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS });
  if (!addresses.some((address) => address.id === safeString(addressId))) {
    throw createPublicError("The selected TTMall address is unavailable.", 404, "TTMALL_ADDRESS_NOT_FOUND");
  }
  await deleteTtmallAddress(access.source, access.token, addressId, { timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS });
  return { id: safeString(addressId) };
}

export async function getTtmallCheckoutOptions({ userId = "", siteSlug = "", addressId = "" } = {}) {
  const access = await resolveCheckoutAccess({ userId, siteSlug });
  const { cart, address } = await readCheckoutContext(access, addressId);
  const shipping = await listTtmallShippingMethods(access.source, access.token, {
    countryId: address.countryId,
    addressId: address.id,
    cartHash: cart.hash,
    cartLineIds: cart.lines.map((line) => line.cartLineId),
    timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS,
  });
  const payments = await listTtmallPaymentMethods(access.source, access.token, {
    productIds: cart.lines.map((line) => line.productId),
    shippingAddressId: address.id, timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS,
  });
  // ALOVE never renders or accepts provider fields that require card/CVV input.
  // Non-sensitive provider metadata (for example a Wise/PayPal account marker)
  // must not hide an otherwise selectable payment method.
  return { shipping, payments };
}

export async function submitTtmallCheckout({ userId = "", siteSlug = "", addressId = "", shippingId = "", paymentId = "", billingAddressId = "", message = "" } = {}) {
  const access = await resolveCheckoutAccess({ userId, siteSlug });
  assertSiteCommerceEnabled(access.site);
  const key = `${access.userId}|${access.site.id}`;
  if (checkoutFlights.has(key)) return checkoutFlights.get(key);
  const flight = submitOwnedCheckout(access, { addressId, shippingId, paymentId, billingAddressId, message });
  checkoutFlights.set(key, flight);
  try {
    return await flight;
  } finally {
    checkoutFlights.delete(key);
  }
}

async function submitOwnedCheckout(access, selection) {
  const { cart, address, addresses } = await readCheckoutContext(access, selection.addressId);
  const [shipping, payments] = await Promise.all([
    listTtmallShippingMethods(access.source, access.token, {
      countryId: address.countryId,
      addressId: address.id,
      cartHash: cart.hash,
      cartLineIds: cart.lines.map((line) => line.cartLineId),
      timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS,
    }),
    listTtmallPaymentMethods(access.source, access.token, {
      productIds: cart.lines.map((line) => line.productId), shippingAddressId: address.id, timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS,
    }),
  ]);
  const chosenShipping = shipping.find((item) => item.id === safeString(selection.shippingId));
  const chosenPayment = payments.find((item) => item.id === safeString(selection.paymentId));
  if (!chosenShipping) throw createPublicError("Please choose an available TTMall shipping method.", 400, "TTMALL_SHIPPING_INVALID");
  if (!chosenPayment) throw createPublicError("Please choose an available TTMall payment method.", 400, "TTMALL_PAYMENT_INVALID");
  const billingAddressId = safeString(selection.billingAddressId || address.id);
  if (billingAddressId && !addresses.some((item) => item.id === billingAddressId)) {
    throw createPublicError("Please choose an available billing address.", 400, "TTMALL_ADDRESS_NOT_FOUND");
  }
  const snapshotHash = hashCheckoutSnapshot(cart, { addressId: address.id, shippingId: chosenShipping.id, paymentId: chosenPayment.id, billingAddressId });
  const existing = await readBlockingAttempt(access, snapshotHash);
  if (existing) throw createPublicError("TTMall is still confirming your previous checkout. Please do not submit it again yet.", 409, "TTMALL_CHECKOUT_IN_PROGRESS");
  const attemptId = createId("tca");
  await createAttempt(access, { attemptId, snapshotHash, activeSnapshotKey: hashActiveSnapshotKey(access, snapshotHash) });
  let providerConfirmed = false;
  try {
    const payment = await createTtmallOrderWithPayment(access.source, access.token, {
      cartHash: cart.hash,
      cartLineIds: cart.lines.map((line) => line.cartLineId),
      shippingAddressId: address.id,
      shippingId: chosenShipping.id,
      paymentId: chosenPayment.id,
      zoneId: address.zoneId,
      countryId: address.countryId,
      stateId: address.stateId,
      billingAddressId,
      message: safeString(selection.message),
    });
    providerConfirmed = true;
    if (payment.orderNumber) await recordCreatedOrder(access, { attemptId, created: payment, consumedCartHash: cart.hash });
    await recordPaymentResult(access, { attemptId, payment, consumedCartHash: cart.hash });
    return {
      mode: payment.redirectUrl ? "redirect" : "ttmall_payment_result",
      redirectUrl: payment.redirectUrl,
      paymentType: payment.type,
      paymentOutcome: payment.paymentOutcome,
      cartConsumed: true,
      message: payment.paymentOutcome === "succeeded"
        ? "TTMall payment was successful."
        : (payment.paymentOutcome === "failed"
          ? "TTMall payment failed."
          : (payment.paymentOutcome === "pending"
            ? buildSitePaymentFollowupMessage(access)
          : (payment.redirectUnavailable
            ? buildSitePaymentFollowupMessage(access)
            : payment.message))),
    };
  } catch (error) {
    const confirmationPending = providerConfirmed || UNKNOWN_OUTCOME_CODES.has(error?.publicCode);
    await recordAttemptFailure(access, {
      attemptId,
      code: error?.publicCode || "checkout_unknown",
      confirmationPending,
      diagnostic: error?.ttmallCheckoutDiagnostic,
    });
    if (confirmationPending) await invalidateConsumedCartSession(access, cart.hash);
    if (error?.publicCode === "TTMALL_BINDING_REAUTH_REQUIRED") {
      await markTtmallAccountBindingStale({ userId: access.userId, siteId: access.site.id, errorCode: "checkout_token_rejected" });
    }
    if (providerConfirmed) {
      throw createPublicError("TTMall confirmed the order, but ALOVE could not safely finish recording it. Please do not retry yet.", 409, "TTMALL_CHECKOUT_STATUS_UNKNOWN");
    }
    throw error;
  }
}

async function resolveCheckoutAccess({ userId = "", siteSlug = "" } = {}) {
  const account = await ensureActiveTtmallBinding({ userId, siteSlug });
  if (!account?.token || !account.site?.id || !account.source?.cacheKey) {
    throw createPublicError("Please link your TTMall account before checkout.", 409, "TTMALL_BINDING_REQUIRED");
  }
  return { userId: safeString(userId), site: account.site, source: account.source, token: account.token };
}

function buildSitePaymentFollowupMessage(access) {
  const siteName = safeString(access?.site?.name || access?.site?.slug)
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 128) || "your store";
  return `Order created. Please go to the ${siteName} order dashboard to complete payment.`;
}

async function readCheckoutContext(access, addressId) {
  const [cart, addresses] = await Promise.all([
    readVerifiedCart(access),
    listTtmallAddresses(access.source, access.token, { timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS }),
  ]);
  const address = addresses.find((item) => item.id === safeString(addressId));
  if (!address?.id || !address.zoneId || !address.countryId || !address.stateId) {
    throw createPublicError("Please choose a TTMall delivery address with a complete region.", 400, "TTMALL_ADDRESS_REGION_INCOMPLETE");
  }
  return { cart, addresses, address };
}

async function readVerifiedCart(access) {
  const [rows] = await getDbPool().execute(
    "SELECT cart_hash FROM ttmall_cart_sessions WHERE user_id = ? AND site_id = ? AND source_cache_key = ? LIMIT 1",
    [access.userId, access.site.id, access.source.cacheKey],
  );
  const hash = safeString(rows[0]?.cart_hash);
  if (!hash) throw createPublicError("Your TTMall cart is no longer available. Please return to your cart and try again.", 409, "TTMALL_CART_REQUIRED");
  const cart = await getTtmallCart(access.source, { hash, userToken: access.token, timeoutMs: TTMALL_CHECKOUT_READ_TIMEOUT_MS });
  if (!cart.lines.length || cart.lines.some((line) => !line.cartLineId || !line.productId)) {
    throw createPublicError("Your TTMall cart could not be verified. Please return to your cart and try again.", 409, "TTMALL_CART_SELECTION_INVALID");
  }
  return cart;
}

function hashCheckoutSnapshot(cart, selection) {
  const payload = { hash: safeString(cart.hash), lines: cart.lines.map((line) => [line.cartLineId, line.productId, line.sku, line.quantity]).sort(), selection };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function readBlockingAttempt(access, snapshotHash) {
  const [rows] = await getDbPool().execute(
    `SELECT id FROM ttmall_checkout_attempts
      WHERE user_id = ? AND site_id = ? AND source_cache_key = ? AND cart_snapshot_hash = ?
        AND attempt_status IN ('creating', 'confirmation_pending', 'order_created', 'payment_redirected', 'payment_pending') LIMIT 1`,
    [access.userId, access.site.id, access.source.cacheKey, snapshotHash],
  );
  return rows[0] || null;
}

async function createAttempt(access, { attemptId, snapshotHash, activeSnapshotKey }) {
  try {
    await getDbPool().execute(
      `INSERT INTO ttmall_checkout_attempts (id, user_id, site_id, source_cache_key, cart_snapshot_hash, attempt_status, active_snapshot_key)
       VALUES (?, ?, ?, ?, ?, 'creating', ?)`,
      [attemptId, access.userId, access.site.id, access.source.cacheKey, snapshotHash, activeSnapshotKey],
    );
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      throw createPublicError("TTMall is still confirming your previous checkout. Please do not submit it again yet.", 409, "TTMALL_CHECKOUT_IN_PROGRESS");
    }
    throw error;
  }
}

async function recordCreatedOrder(access, { attemptId, created, consumedCartHash }) {
  const secret = requireBindingSecret();
  await withTransaction(async (connection) => {
    const [attempt] = await connection.execute(
      `UPDATE ttmall_checkout_attempts
          SET attempt_status = 'order_created', order_number_encrypted = ?, next_cart_hash_encrypted = ?, safe_error_code = NULL,
              upstream_http_status = NULL, upstream_outcome = NULL, upstream_business_code = NULL, upstream_response_shape = NULL, upstream_safe_message = NULL
        WHERE id = ? AND user_id = ? AND site_id = ? AND attempt_status = 'creating'`,
      [encryptSecret(created.orderNumber, secret), created.nextCartHash ? encryptSecret(created.nextCartHash, secret) : null, attemptId, access.userId, access.site.id],
    );
    if (attempt.affectedRows !== 1) throw new Error("TTMall order attempt is no longer writable");
    await connection.execute(
      "DELETE FROM ttmall_cart_sessions WHERE user_id = ? AND site_id = ? AND source_cache_key = ? AND cart_hash = ?",
      [access.userId, access.site.id, access.source.cacheKey, safeString(consumedCartHash)],
    );
  });
}

async function recordPaymentResult(access, { attemptId, payment, consumedCartHash }) {
  const status = payment.paymentOutcome === "redirect"
    ? "payment_redirected"
    : (payment.paymentOutcome === "succeeded"
      ? "payment_succeeded"
      : (payment.paymentOutcome === "failed" ? "payment_failed" : "payment_pending"));
  const terminal = status === "payment_succeeded" || status === "payment_failed";
  await withTransaction(async (connection) => {
    const [attempt] = await connection.execute(
      `UPDATE ttmall_checkout_attempts SET attempt_status = ?, payment_type = ?, safe_error_code = NULL,
          upstream_http_status = NULL, upstream_outcome = NULL, upstream_business_code = NULL, upstream_response_shape = NULL, upstream_safe_message = NULL,
          active_snapshot_key = CASE WHEN ? THEN NULL ELSE active_snapshot_key END
        WHERE id = ? AND user_id = ? AND site_id = ? AND attempt_status IN ('creating', 'order_created')`,
      [status, payment.type || null, terminal, attemptId, access.userId, access.site.id],
    );
    if (attempt.affectedRows !== 1) throw new Error("TTMall payment attempt is no longer writable");
    await connection.execute(
      "DELETE FROM ttmall_cart_sessions WHERE user_id = ? AND site_id = ? AND source_cache_key = ? AND cart_hash = ?",
      [access.userId, access.site.id, access.source.cacheKey, safeString(consumedCartHash)],
    );
  });
}

async function recordAttemptFailure(access, { attemptId, code, confirmationPending = false, diagnostic = null }) {
  const status = confirmationPending ? "confirmation_pending" : "failed";
  const safeDiagnostic = normalizeTtmallCheckoutDiagnostic(diagnostic);
  await getDbPool().execute(
    `UPDATE ttmall_checkout_attempts
        SET attempt_status = ?, safe_error_code = ?, upstream_http_status = ?, upstream_outcome = ?, upstream_business_code = ?, upstream_response_shape = ?, upstream_safe_message = ?,
            active_snapshot_key = CASE WHEN ? = 'failed' THEN NULL ELSE active_snapshot_key END
      WHERE id = ? AND user_id = ? AND site_id = ? AND attempt_status IN ('creating', 'order_created')`,
    [
      status,
      safeString(code).slice(0, 64) || "checkout_unknown",
      safeDiagnostic.upstreamHttpStatus,
      safeDiagnostic.upstreamOutcome || null,
      safeDiagnostic.upstreamBusinessCode || null,
      safeDiagnostic.upstreamResponseShape || null,
      safeDiagnostic.upstreamSafeMessage || null,
      status,
      attemptId,
      access.userId,
      access.site.id,
    ],
  ).catch(() => {});
}

async function invalidateConsumedCartSession(access, consumedCartHash) {
  await getDbPool().execute(
    "DELETE FROM ttmall_cart_sessions WHERE user_id = ? AND site_id = ? AND source_cache_key = ? AND cart_hash = ?",
    [access.userId, access.site.id, access.source.cacheKey, safeString(consumedCartHash)],
  ).catch(() => {});
}

function hashActiveSnapshotKey(access, snapshotHash) {
  return createHash("sha256").update(`${access.userId}|${access.site.id}|${access.source.cacheKey}|${snapshotHash}`).digest("hex");
}

function requireBindingSecret() {
  const key = safeString(SERVER_CONFIG.ttmallAccountBinding?.secretKey);
  if (!key) throw createPublicError("TTMall account binding is not configured.", 503, "TTMALL_BINDING_SECRET_REQUIRED");
  return key;
}
