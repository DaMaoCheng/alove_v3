import { createPublicError } from "./public-error-utils.js";
import {
  clearShopifyCartForSettlement,
  decryptShopifyCartId,
  draftLinesFromCart,
  draftOrderSnapshotHash,
  hashShopifyCartId,
  parseShopifyCartDiscountSnapshot,
  readShopifyCartSession,
  readShopifyStorefrontCart,
  requireShopifyCustomerBinding,
  resolveShopifyCartAccess,
  withShopifyCartLock,
} from "./shopify-cart-service.js";
import { readShopifyDraftOrderSettlement } from "./shopify-draft-order-service.js";
import {
  listExpiredShopifyDraftOrderCreations,
  listReconcilableShopifyDraftOrderAttempts,
  markShopifyDraftOrderAttemptChecked,
  markShopifyDraftOrderCartCleared,
  markShopifyDraftOrderCartPreserved,
  markShopifyDraftOrderPaid,
  markShopifyDraftOrderAttemptFailed,
  markShopifyDraftOrderStaleUnsettled,
} from "./shopify-draft-order-attempt-service.js";

const READY_ATTEMPT = "draft_ready";
const PAID_RETRYABLE_ATTEMPT = "paid_cleanup_retryable";
const PAID_STATUS = "PAID";

export async function reconcileCurrentUserShopifyPayment({ userId = "", siteSlug = "", buyerIp = "", userSiteId = "", userSiteSlug = "" } = {}) {
  let access;
  try {
    access = await resolveShopifyCartAccess({ userId, siteSlug, userSiteId, userSiteSlug });
  } catch (error) {
    if (error?.publicCode === "SHOPIFY_CART_NOT_SUPPORTED") return { ok: true, mode: "not_shopify", checked: 0, reconciled: 0, cartCleared: false };
    throw error;
  }
  const binding = await requireShopifyCustomerBinding(access);
  return withShopifyCartLock(access, async () => {
    const currentSession = await readShopifyCartSession(access.userId, access.site.id, access.source.cacheKey);
    const attempts = await listReconcilableShopifyDraftOrderAttempts({
      userId: access.userId,
      siteId: access.site.id,
      sourceCacheKey: access.source.cacheKey,
      currentAttemptId: currentSession?.draft_order_attempt_id,
    });
    let checked = 0;
    let reconciled = 0;
    let cartCleared = false;
    for (const attempt of attempts) {
      const outcome = await reconcileAttemptSafely({ access, binding, attempt, currentSession, buyerIp });
      checked += outcome.checked;
      reconciled += outcome.reconciled;
      cartCleared = cartCleared || outcome.cartCleared;
    }
    const expiredCreations = await listExpiredShopifyDraftOrderCreations({
      userId: access.userId,
      siteId: access.site.id,
      sourceCacheKey: access.source.cacheKey,
      excludeAttemptId: currentSession?.draft_order_attempt_id,
    });
    let expired = 0;
    for (const attempt of expiredCreations) {
      if (await markShopifyDraftOrderAttemptFailed({ id: attempt.id, userId: access.userId, siteId: access.site.id })) expired += 1;
    }
    return { ok: true, mode: "shopify", checked, reconciled, cartCleared, expired };
  });
}

async function reconcileAttemptSafely({ access, binding, attempt, currentSession, buyerIp }) {
  try {
    return await reconcileAttempt({ access, binding, attempt, buyerIp });
  } catch (error) {
    const safeErrorCode = String(error?.publicCode || "SHOPIFY_DRAFT_ORDER_RECONCILE_FAILED").slice(0, 64);
    if (safeErrorCode === "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED" && !isCurrentAttemptPointer(currentSession, attempt)) {
      await markShopifyDraftOrderStaleUnsettled({ id: attempt.id, userId: access.userId, siteId: access.site.id, safeErrorCode });
      return { checked: 1, reconciled: 0, cartCleared: false };
    }
    await markShopifyDraftOrderAttemptChecked({ id: attempt.id, userId: access.userId, siteId: access.site.id, safeErrorCode });
    return { checked: 1, reconciled: 0, cartCleared: false };
  }
}

async function reconcileAttempt({ access, binding, attempt, buyerIp }) {
  if (String(attempt?.attempt_status || "") === READY_ATTEMPT) {
    const settlement = await readShopifyDraftOrderSettlement({
      source: access.source,
      draftOrderId: attempt.shopify_draft_order_id,
      customerId: binding.shopify_customer_id,
    });
    const discount = parseShopifyCartDiscountSnapshot(attempt.discount_snapshot_json);
    const snapshotHash = draftOrderSnapshotHash(binding, settlement.lines, discount, access.site.currency);
    if (snapshotHash !== String(attempt.snapshot_hash || "")) {
      if (settlement.orderId && settlement.financialStatus === PAID_STATUS) {
        await markShopifyDraftOrderPaid({ id: attempt.id, userId: access.userId, siteId: access.site.id, orderId: settlement.orderId });
        await markShopifyDraftOrderCartPreserved({ id: attempt.id, userId: access.userId, siteId: access.site.id });
        return { checked: 1, reconciled: 1, cartCleared: false };
      }
      throw createPublicError("Shopify payment checkout could not be verified. Please try again.", 422, "SHOPIFY_DRAFT_ORDER_VERIFY_FAILED");
    }
    if (!settlement.orderId || settlement.financialStatus !== PAID_STATUS) {
      await markShopifyDraftOrderAttemptChecked({ id: attempt.id, userId: access.userId, siteId: access.site.id });
      return { checked: 1, reconciled: 0, cartCleared: false };
    }
    const markedPaid = await markShopifyDraftOrderPaid({ id: attempt.id, userId: access.userId, siteId: access.site.id, orderId: settlement.orderId });
    if (!markedPaid) return { checked: 1, reconciled: 0, cartCleared: false };
    return clearMatchingPaidCart({ access, binding, attempt: { ...attempt, attempt_status: PAID_RETRYABLE_ATTEMPT }, buyerIp, checked: 1 });
  }
  if (String(attempt?.attempt_status || "") === PAID_RETRYABLE_ATTEMPT) {
    return clearMatchingPaidCart({ access, binding, attempt, buyerIp, checked: 0 });
  }
  return { checked: 0, reconciled: 0, cartCleared: false };
}

async function clearMatchingPaidCart({ access, binding, attempt, buyerIp, checked }) {
  const session = await readShopifyCartSession(access.userId, access.site.id, access.source.cacheKey);
  const cartId = decryptShopifyCartId(session?.cart_id_encrypted || "");
  if (!matchesPaidAttemptPointer({ session, attempt, cartId })) {
    await markShopifyDraftOrderCartPreserved({ id: attempt.id, userId: access.userId, siteId: access.site.id });
    return { checked, reconciled: 1, cartCleared: false };
  }
  const cart = await readShopifyStorefrontCart(access, buyerIp, cartId);
  if (cart && Number(cart.totalQuantity || 0) === 0) {
    await clearShopifyCartForSettlement({ access, buyerIp, cartId });
    await markShopifyDraftOrderCartCleared({ id: attempt.id, userId: access.userId, siteId: access.site.id });
    return { checked, reconciled: 1, cartCleared: true };
  }
  if (!matchesPaidAttemptCart({ attempt, binding, cart, presentmentCurrencyCode: access.site.currency })) {
    await markShopifyDraftOrderCartPreserved({ id: attempt.id, userId: access.userId, siteId: access.site.id });
    return { checked, reconciled: 1, cartCleared: false };
  }
  await clearShopifyCartForSettlement({ access, buyerIp, cartId });
  await markShopifyDraftOrderCartCleared({ id: attempt.id, userId: access.userId, siteId: access.site.id });
  return { checked, reconciled: 1, cartCleared: true };
}

function isCurrentAttemptPointer(session = null, attempt = null) {
  return Boolean(session
    && String(session?.draft_order_attempt_id || "") === String(attempt?.id || "")
    && String(session?.draft_order_id || "") === String(attempt?.shopify_draft_order_id || ""));
}

export function matchesPaidAttemptPointer({ session = null, attempt = null, cartId = "" } = {}) {
  return Boolean(session
    && cartId
    && String(session.draft_order_attempt_id || "") === String(attempt?.id || "")
    && String(session.draft_order_id || "") === String(attempt?.shopify_draft_order_id || "")
    && Number(session.cart_revision || 0) === Number(attempt?.cart_revision || 0)
    && hashShopifyCartId(cartId) === String(attempt?.cart_id_hash || ""));
}

export function matchesPaidAttemptCart({ attempt = null, binding = null, cart = null, presentmentCurrencyCode = "" } = {}) {
  const lines = draftLinesFromCart(cart);
  return Boolean(lines.length && draftOrderSnapshotHash(binding, lines, parseShopifyCartDiscountSnapshot(attempt?.discount_snapshot_json), presentmentCurrencyCode) === String(attempt?.snapshot_hash || ""));
}
