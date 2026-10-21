import { ICONS } from "../../icons/icons.js";
import { bindProductPanel, productPanelHtml } from "../chat/chat-product-panel.js";
import { productCartHtml } from "../chat/chat-product-cart.js";
import { ttmallAccountBindingHtml } from "../chat/chat-ttmall-binding-panel.js";
import { ttmallCheckoutPanelHtml } from "../chat/chat-ttmall-checkout-panel.js";
import { normalizeCallProductIndex } from "./call-product-state.js";
import { createSiteCopy } from "../../i18n/site-copy.js";

const CALL_PRODUCT_OPEN_CLASS = "call-product-open";

export function createCallProductOverlay({ products = [], index = 0, siteSlug = "", pageLanguage = "English", guestMode = false, onRestrictedCheckout, onClose, onIndexChange, onProductChange } = {}) {
  const normalizedProducts = Array.isArray(products) ? products.filter(Boolean) : [];
  if (!normalizedProducts.length) return document.createDocumentFragment();
  const currentIndex = normalizeCallProductIndex(index, normalizedProducts);
  const currentProduct = normalizedProducts[currentIndex];
  const hasMultipleProducts = normalizedProducts.length > 1;
  const copy = createSiteCopy(pageLanguage);
  const overlay = document.createElement("div");
  overlay.className = "call-product-overlay";
  overlay.innerHTML = `
    <div class="call-product-scrim prod-scrim"></div>
    <aside class="prod-panel call-product-panel" role="dialog" aria-label="${copy.t("call.productDetails")}">
      ${productPanelHtml({ pageLanguage })}
      ${hasMultipleProducts ? `
        <button class="call-product-nav prev" type="button" data-call-product-prev aria-label="${copy.t("call.previousProduct")}">${ICONS.back}</button>
        <button class="call-product-nav next" type="button" data-call-product-next aria-label="${copy.t("call.nextProduct")}">${ICONS.back}</button>
        <div class="call-product-count">${currentIndex + 1}/${normalizedProducts.length}</div>
      ` : ""}
    </aside>
    ${productCartHtml({ pageLanguage })}
    ${ttmallAccountBindingHtml()}
    ${ttmallCheckoutPanelHtml()}
  `;

  bindProductPanel(overlay, {
    initialProduct: currentProduct,
    language: pageLanguage,
    siteSlug,
    openClass: CALL_PRODUCT_OPEN_CLASS,
    clickEventType: "call_product_detail_open",
    clickSource: "realtime_call_product_overlay",
    recordAnalytics: !guestMode,
    guestMode,
    recordDetailEvents: !guestMode,
    requireAuthForCheckout: guestMode,
    onRestrictedCheckout,
    onProductChange: (product) => {
      if (!product) {
        document.body.classList.remove(CALL_PRODUCT_OPEN_CLASS);
        onClose?.();
        return;
      }
      onProductChange?.({ product, index: currentIndex });
    },
  });

  overlay.querySelector("[data-call-product-prev]")?.addEventListener("click", () => {
    onIndexChange?.(shiftIndex(currentIndex, -1, normalizedProducts.length));
  });
  overlay.querySelector("[data-call-product-next]")?.addEventListener("click", () => {
    onIndexChange?.(shiftIndex(currentIndex, 1, normalizedProducts.length));
  });
  bindCallProductSwipe(overlay, {
    onPrevious: () => onIndexChange?.(shiftIndex(currentIndex, -1, normalizedProducts.length)),
    onNext: () => onIndexChange?.(shiftIndex(currentIndex, 1, normalizedProducts.length)),
  });
  return overlay;
}

function shiftIndex(index, delta, count) {
  if (!count) return 0;
  return (index + delta + count) % count;
}

function bindCallProductSwipe(root, { onPrevious, onNext } = {}) {
  const shell = root.querySelector(".call-product-panel");
  if (!shell) return;
  let startX = 0;
  let startY = 0;
  shell.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".pp-hero, .pp-scroll, button, a")) return;
    startX = event.clientX;
    startY = event.clientY;
  });
  shell.addEventListener("pointerup", (event) => {
    if (!startX) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    startX = 0;
    startY = 0;
    if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;
    if (deltaX > 0) {
      onPrevious?.();
    } else {
      onNext?.();
    }
  });
}
