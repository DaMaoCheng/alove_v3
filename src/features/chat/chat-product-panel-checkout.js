import { recordProductAnalyticsEvent } from "../../services/product-analytics-service.js";
import { createProductCheckoutLink } from "../../services/product-checkout-service.js";
import { parseProductPayload } from "./chat-product-panel-renderer.js";

const CHECKOUT_LINK_TIMEOUT_MS = 12000;
const CHECKOUT_REPEAT_GUARD_MS = 800;
const checkoutAttempts = new WeakMap();

export async function handleProductPanelCheckout(root, {
  requireAuthForCheckout = false,
  onRestrictedCheckout,
  recordAnalytics = true,
  recordDetailEvents = true,
} = {}) {
  if (!root || root.dataset.productCheckoutPending === "true") return;
  const button = root?.querySelector?.("[data-product-panel-buy]");
  const url = button?.dataset.productUrl || "";
  const product = parseProductPayload(root?.dataset?.productPanelProduct);
  const analytics = parseProductPayload(root?.dataset?.productPanelAnalytics);
  if (requireAuthForCheckout) {
    onRestrictedCheckout?.();
    return;
  }
  if (!url || isRepeatedProductCheckoutClick(root)) return;
  if (!recordDetailEvents) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  if (recordAnalytics) recordProductAnalyticsEvent({
    ...analytics,
    eventType: "product_detail_cta_click",
    source: "product_detail_panel",
  });
  const selectedOfferId = String(product.selectedDiscountOfferId || "").trim();
  const characterId = String(product.characterId || "").trim();
  const messageId = String(product.messageId || "").trim();
  if (!selectedOfferId || !characterId || !messageId) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  root.dataset.productCheckoutPending = "true";
  button?.setAttribute?.("aria-busy", "true");
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), CHECKOUT_LINK_TIMEOUT_MS);
  const attempt = {
    button,
    contextKey: productCheckoutContextKey(root, product, selectedOfferId),
    controller,
    popup,
    timeoutId,
    cancelled: false,
  };
  checkoutAttempts.set(root, attempt);
  try {
    const result = await createProductCheckoutLink({
      siteSlug: root.dataset.productPanelSiteSlug || "",
      product,
      characterId,
      messageId,
      discountOfferId: selectedOfferId,
      selectedSizeIndex: product.selectedSizeIndex,
      signal: controller.signal,
    });
    if (isCurrentProductCheckoutAttempt(root, attempt)) {
      navigateProductCheckout(result?.url || url, popup);
    }
  } catch {
    if (isCurrentProductCheckoutAttempt(root, attempt)) {
      navigateProductCheckout(url, popup);
    }
  } finally {
    window.clearTimeout(timeoutId);
    if (!isCurrentProductCheckoutAttempt(root, attempt) && popup && !popup.closed) {
      popup.close();
    }
    if (checkoutAttempts.get(root) === attempt) {
      checkoutAttempts.delete(root);
      delete root.dataset.productCheckoutPending;
      button?.removeAttribute?.("aria-busy");
    }
  }
}

export function cancelProductPanelCheckout(root) {
  if (!root) return;
  const attempt = checkoutAttempts.get(root);
  if (attempt) {
    attempt.cancelled = true;
    attempt.controller.abort();
    window.clearTimeout(attempt.timeoutId);
    if (attempt.popup && !attempt.popup.closed) attempt.popup.close();
    checkoutAttempts.delete(root);
    attempt.button?.removeAttribute?.("aria-busy");
  }
  delete root.dataset.productCheckoutPending;
}

export function navigateProductCheckout(url = "", popup = null) {
  if (!url) return;
  if (popup) {
    if (!popup.closed) popup.location.replace(url);
    return;
  }
  window.location.assign(url);
}

function isCurrentProductCheckoutAttempt(root, attempt) {
  if (!root || !attempt || attempt.cancelled || checkoutAttempts.get(root) !== attempt) return false;
  const currentProduct = parseProductPayload(root.dataset.productPanelProduct);
  const currentOfferId = String(currentProduct.selectedDiscountOfferId || "").trim();
  return productCheckoutContextKey(root, currentProduct, currentOfferId) === attempt.contextKey;
}

function productCheckoutContextKey(root, product = {}, selectedOfferId = "") {
  return JSON.stringify([
    String(root?.dataset?.productPanelSiteSlug || ""),
    String(product.productId || product.id || product.handle || product.url || ""),
    Number.isInteger(Number(product.selectedSizeIndex)) ? Number(product.selectedSizeIndex) : -1,
    String(selectedOfferId || ""),
  ]);
}

function isRepeatedProductCheckoutClick(root) {
  const now = Date.now();
  const previous = Number(root?.dataset?.productCheckoutLastClickAt || 0);
  root.dataset.productCheckoutLastClickAt = String(now);
  return previous > 0 && now - previous < CHECKOUT_REPEAT_GUARD_MS;
}
