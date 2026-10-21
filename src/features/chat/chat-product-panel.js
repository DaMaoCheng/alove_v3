import { recordProductAnalyticsEvent } from "../../services/product-analytics-service.js";
import { bindProductGalleryDrag, shiftProductPanelImage } from "./chat-product-panel-gallery.js";
import { getProductPanelCopy, parseProductPayload, setProductPanelAddPending, updateProductCustomization, updateProductCustomizationTotal, updateProductPanel, updateSelectedProductSize } from "./chat-product-panel-renderer.js";
import { cancelProductPanelCheckout } from "./chat-product-panel-checkout.js";
import { addCurrentProductToCart, bindProductCart, closeProductCart, resetProductQuantity, syncCartDiscountSelection } from "./chat-product-cart.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { checkoutShopifyProductCart, getShopifyProductCartReadiness, syncShopifyProductCart, syncTtmallProductCart } from "../../services/product-cart-service.js";
import { bindTtmallAccountBindingPanel, ensureTtmallAccountBinding } from "./chat-ttmall-binding-panel.js";
import { bindTtmallCheckoutPanel, openTtmallCheckoutPanel } from "./chat-ttmall-checkout-panel.js";
import {
  hydrateProductPanelCheckout,
  isSameProductPayload,
  mergeProductDynamicRefresh,
  normalizeSiteSlug,
  prepareProductForCurrentSite,
  prepareProductForGuest,
} from "./chat-product-panel-hydration.js";
import { applyProductPanelDiscountSelections, readProductPanelDiscountSelections, updateProductPanelDiscountSelections, writeProductPanelDiscountSelections } from "./chat-product-panel-discount-selection-state.js";
import { resolveDiscountOfferSelection } from "./chat-product-panel-discounts.js";
import { showToast } from "../shared-ui/toast.js";
import { getSiteBranding } from "../../services/site-branding-service.js";
export { productPanelHtml, productSizeChartModalHtml } from "./chat-product-panel-template.js";

const PRODUCT_SWITCH_OUT_MS = 120;
const PRODUCT_SWITCH_IN_MS = 210;

export function bindProductPanel(root, { initialProduct = null, onProductChange, onCartCheckout, requireAuthForCheckout = false, onRestrictedCheckout, clickEventType = "product_bubble_click", clickSource = "chat_product_card", recordAnalytics = true, recordDetailEvents = true, guestMode = false, language = "", openClass = "product-open", siteSlug = "" } = {}) {
  let soldOutHintTimer = null;
  const currentSiteSlug = normalizeSiteSlug(siteSlug);
  root.dataset.productPanelLanguage = String(language || "English");
  root.dataset.productPanelSiteSlug = currentSiteSlug;
  root.dataset.productPanelGuestMode = guestMode ? "true" : "false";
  if (currentSiteSlug) {
    getSiteBranding(currentSiteSlug).then((branding) => {
      if (!branding || root.dataset.productPanelSiteSlug !== currentSiteSlug) return;
      root.dataset.productPanelCommerceEnabled = branding.commerceEnabled === false ? "false" : "true";
      const currentProduct = parseProductPayload(root.dataset.productPanelProduct);
      if (currentProduct.name) {
        const nextProduct = prepareProductForGuest(prepareProductForCurrentSite(currentProduct, currentSiteSlug), guestMode);
        updateProductPanel(root, nextProduct, { language });
        onProductChange?.(nextProduct);
      }
    }).catch(() => {});
  }
  writeProductPanelDiscountSelections(root, currentSiteSlug, []);
  bindTtmallAccountBindingPanel(root, { language });
  bindTtmallCheckoutPanel(root, { language });
  bindProductCart(root, {
    language,
    suppressCheckoutStatus: currentSiteSlug === "ttmall-binding-test",
    onItemsChange: guestMode ? null : async (items) => {
      const result = await syncTtmallProductCart({ siteSlug: currentSiteSlug, items });
      root.dataset.productPanelTtmallCartMode = result?.mode || "";
      if (result?.mode === "not_ttmall") {
        root.dataset.productPanelCartProvider = "shopify";
        return syncShopifyProductCart({ siteSlug: currentSiteSlug, items });
      }
      return result;
    },
    onCheckout: onCartCheckout || (async (items) => {
      if (root.dataset.productPanelTtmallCartMode === "not_ttmall") return checkoutShopifyProductCart({ siteSlug: currentSiteSlug });
      const binding = await ensureTtmallAccountBinding(root, { siteSlug: currentSiteSlug, language });
      if (binding?.mode === "ttmall" && binding?.requiresBinding) return { ok: false, mode: "binding_required" };
      await openTtmallCheckoutPanel(root, { siteSlug: currentSiteSlug, language });
      return { ok: true, mode: "handled" };
    }),
    requireAuthForCheckout,
    onRestrictedCheckout,
  });

  root.addEventListener("click", (event) => {
    const copyOfferButton = event.target.closest("[data-product-discount-copy]");
    if (copyOfferButton && root.contains(copyOfferButton)) {
      copyDiscountCode(copyOfferButton.dataset.productDiscountCopy || "", copyOfferButton);
      return;
    }
    const sizeChartOpen = event.target.closest("[data-product-size-chart-open]");
    if (sizeChartOpen && root.contains(sizeChartOpen) && sizeChartOpen.dataset.productSizeChartReady === "true") {
      root.querySelector("[data-product-size-chart-modal]")?.removeAttribute("hidden");
      return;
    }
    const sizeChartClose = event.target.closest("[data-product-size-chart-close]");
    if (sizeChartClose && root.contains(sizeChartClose)) {
      root.querySelector("[data-product-size-chart-modal]")?.setAttribute("hidden", "");
      return;
    }
    const useOfferButton = event.target.closest("[data-product-discount-use]");
    if (useOfferButton && root.contains(useOfferButton)) {
      cancelProductPanelCheckout(root);
      const currentProduct = parseProductPayload(root.dataset.productPanelProduct);
      const offerId = String(useOfferButton.dataset.productDiscountUse || "").trim();
      const currentSelections = readProductPanelDiscountSelections(root, currentSiteSlug);
      const selection = resolveDiscountOfferSelection(currentSelections, offerId, currentProduct.discountOffers);
      if (selection.replaced) showToast(createSiteCopy(language || root?.dataset?.productPanelLanguage || "English").t("product.discountCombinationUnavailable"));
      const nextSelections = selection.ids;
      const selectedDiscountOfferIds = updateProductPanelDiscountSelections(root, currentSiteSlug, currentProduct, nextSelections);
      const nextProduct = applyProductPanelDiscountSelections(root, currentProduct, currentSiteSlug);
      updateProductPanel(root, nextProduct, { language });
      syncCartDiscountSelection(root, nextProduct, { language, selectedDiscountOfferIds });
      onProductChange?.(nextProduct);
      return;
    }
    const customizationButton = event.target.closest("[data-product-customization-option][data-product-customization-value]");
    if (customizationButton && root.contains(customizationButton)) {
      const nextProduct = updateProductCustomization(
        root,
        customizationButton.dataset.productCustomizationOption || "",
        customizationButton.dataset.productCustomizationValue || "",
        { language },
      );
      onProductChange?.(nextProduct);
      return;
    }
    const sizeButton = event.target.closest("[data-product-panel-size-index]");
    if (sizeButton && root.contains(sizeButton) && sizeButton.dataset.productPanelSoldOut === "true") {
      showSoldOutSizeHint(root, sizeButton.dataset.soldOutMessage, () => {
        if (soldOutHintTimer) window.clearTimeout(soldOutHintTimer);
        soldOutHintTimer = null;
      });
      if (soldOutHintTimer) window.clearTimeout(soldOutHintTimer);
      soldOutHintTimer = window.setTimeout(() => hideSoldOutSizeHint(root), 2000);
      return;
    }
    if (sizeButton && root.contains(sizeButton)) {
      cancelProductPanelCheckout(root);
      const nextProduct = updateSelectedProductSize(root, Number(sizeButton.dataset.productPanelSizeIndex || -1), { language });
      onProductChange?.(nextProduct);
      return;
    }
    if (!event.target.closest("[data-product-panel-soldout-hint]")) {
      hideSoldOutSizeHint(root);
      if (soldOutHintTimer) window.clearTimeout(soldOutHintTimer);
      soldOutHintTimer = null;
    }
    const card = event.target.closest(".product-card, .product-card-trigger");
    if (!card) return;
    openProductPanelFromCard(root, card, {
      clickEventType,
      clickSource,
      onProductChange,
      recordAnalytics,
      recordDetailEvents,
      language,
      openClass,
      siteSlug: currentSiteSlug,
    });
  });
  root.addEventListener("change", (event) => {
    const field = event.target.closest?.("[data-product-customization-select], [data-product-customization-input]");
    if (!field || !root.contains(field)) return;
    if (field.matches("[data-product-customization-input]")) return;
    const nextProduct = updateProductCustomization(
      root,
      field.dataset.productCustomizationOption || "",
      field.value || "",
      { language },
    );
    onProductChange?.(nextProduct);
  });
  root.addEventListener("input", (event) => {
    const field = event.target.closest?.("[data-product-customization-input]");
    if (!field || !root.contains(field)) return;
    const nextProduct = updateProductCustomization(
      root,
      field.dataset.productCustomizationOption || "",
      field.value || "",
      { language, render: false },
    );
    updateProductCustomizationTotal(root, nextProduct);
    onProductChange?.(nextProduct);
  });
  root.addEventListener("aiove:product-card-live-refresh", (event) => {
    if (!document.body.classList.contains(openClass)) return;
    const refreshedProduct = event.detail?.product && typeof event.detail.product === "object" ? event.detail.product : null;
    if (!refreshedProduct) return;
    const currentProduct = parseProductPayload(root.dataset.productPanelProduct);
    if (!isSameProductPayload(currentProduct, refreshedProduct)) return;
    const nextProduct = mergeProductDynamicRefresh(currentProduct, refreshedProduct, {
      analytics: event.detail?.analytics || currentProduct.analytics || {},
    });
    const displayProduct = applyProductPanelDiscountSelections(root, prepareProductForGuest(prepareProductForCurrentSite(nextProduct, currentSiteSlug), guestMode), currentSiteSlug);
    updateProductPanel(root, displayProduct, { language });
    onProductChange?.(displayProduct);
  });
  root.querySelector("[data-product-panel-buy]")?.addEventListener("click", () => {
    const product = parseProductPayload(root.dataset.productPanelProduct);
    if (product.commerceEnabled === false) {
      const url = String(product.url || "").trim();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (product.checkoutResolutionStatus === "failed") {
      hydrateProductPanelCheckout(root, product, onProductChange, {
        language,
        openClass,
        siteSlug: currentSiteSlug,
        guestMode,
      });
      return;
    }
    void addCurrentProductToCartAfterTtmallBinding(root, {
      currentSiteSlug,
      guestMode,
      language,
    });
  });
  root.querySelector("[data-product-panel-detail-link]")?.addEventListener("click", () => {
    if (!recordAnalytics || !recordDetailEvents) return;
    const analytics = parseProductPayload(root.dataset.productPanelAnalytics);
    recordProductAnalyticsEvent({
      ...analytics,
      eventType: "product_detail_page_click",
      source: "product_detail_panel",
    });
  });
  root.querySelector("[data-product-panel-prev]")?.addEventListener("click", () => shiftProductPanelImage(root, -1, onProductChange));
  root.querySelector("[data-product-panel-next]")?.addEventListener("click", () => shiftProductPanelImage(root, 1, onProductChange));
  bindProductGalleryDrag(root, onProductChange);
  bindPaymentMethodRailDrag(root);
  root.querySelector(".prod-scrim")?.addEventListener("click", () => closeProductPanel(root, onProductChange, { openClass }));
  root.querySelector(".pp-close")?.addEventListener("click", () => closeProductPanel(root, onProductChange, { openClass }));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    root.querySelector("[data-product-size-chart-modal]:not([hidden])")?.setAttribute("hidden", "");
  });
  if (initialProduct) {
    const initialProductForCurrentSite = applyProductPanelDiscountSelections(root, prepareProductForGuest(
      prepareProductForCurrentSite(initialProduct, currentSiteSlug),
      guestMode,
    ), currentSiteSlug);
    updateProductPanel(root, initialProductForCurrentSite, { language });
    resetProductQuantity(root);
    onProductChange?.(initialProductForCurrentSite);
    document.body.classList.add(openClass);
    hydrateProductPanelCheckout(root, initialProductForCurrentSite, onProductChange, {
      language,
      openClass,
      siteSlug: currentSiteSlug,
      guestMode,
    });
  } else {
    document.body.classList.remove(openClass);
  }
}

async function addCurrentProductToCartAfterTtmallBinding(root, { currentSiteSlug = "", guestMode = false, language = "" } = {}) {
  if (!root || root.dataset.productPanelAddPending === "true") return;
  setProductPanelAddPending(root, true);
  try {
    if (guestMode || root.dataset.productPanelTtmallBindingMode === "not_ttmall") {
      if (guestMode || await ensureShopifyCartIsReady(root, { siteSlug: currentSiteSlug, language })) addCurrentProductToCart(root, { language });
      return;
    }
    const binding = await ensureTtmallAccountBinding(root, {
      siteSlug: currentSiteSlug,
      language,
      onBound: async () => {
        addCurrentProductToCart(root, { language });
      },
    });
    if (binding?.mode === "not_ttmall") root.dataset.productPanelTtmallBindingMode = "not_ttmall";
    if (binding?.mode === "ttmall" && binding?.requiresBinding) return;
    if (binding?.mode === "not_ttmall" && !await ensureShopifyCartIsReady(root, { siteSlug: currentSiteSlug, language })) return;
    addCurrentProductToCart(root, { language });
  } finally {
    setProductPanelAddPending(root, false);
  }
}

async function ensureShopifyCartIsReady(root, { siteSlug = "", language = "" } = {}) {
  try {
    const result = await getShopifyProductCartReadiness({ siteSlug });
    if (result?.mode !== "shopify") return true;
    root.dataset.productPanelCartProvider = "shopify";
    if (!result?.requiresBinding) return true;
    showProductPanelHint(root, createSiteCopy(language || root?.dataset?.productPanelLanguage || "English").t("product.shopifyBindingRequired"));
    return false;
  } catch {
    showProductPanelHint(root, createSiteCopy(language || root?.dataset?.productPanelLanguage || "English").t("product.shopifyCartFailed"));
    return false;
  }
}

async function copyDiscountCode(code = "", button) {
  const value = String(code || "").trim();
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    if (!button) return;
    button.classList.add("is-copied");
    button.setAttribute("aria-label", button.dataset.copiedLabel || getProductPanelCopy(button?.closest?.("[data-product-panel-language]")?.dataset?.productPanelLanguage || "").copied);
    window.clearTimeout(button.copyResetTimer);
    button.copyResetTimer = window.setTimeout(() => {
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", button.dataset.copyLabel || "");
    }, 1400);
  } catch {
    // Clipboard failure does not alter the selected offer or product state.
  }
}

export function openProductPanelFromCard(root, card, { clickEventType = "product_bubble_click", clickSource = "chat_product_card", onProductChange, recordAnalytics = true, recordDetailEvents = true, language = "", openClass = "product-open", siteSlug = "" } = {}) {
  if (!root || !card) return;
  const product = parseProductPayload(card.dataset.product);
  const analytics = parseProductPayload(card.dataset.productAnalytics);
  if (recordAnalytics) recordProductAnalyticsEvent({
    ...analytics,
    eventType: clickEventType,
    source: clickSource,
  });
  openProductPanel(root, { ...product, analytics }, onProductChange, {
    restart: document.body.classList.contains(openClass),
    recordAnalytics,
    recordDetailEvents,
    language,
    openClass,
    siteSlug: normalizeSiteSlug(siteSlug || root.dataset.productPanelSiteSlug),
    guestMode: root.dataset.productPanelGuestMode === "true",
  });
}

function showSoldOutSizeHint(root, message = "", onBeforeShow) {
  if (!isTouchLikePointer()) return;
  onBeforeShow?.();
  showProductPanelHint(root, message || getFallbackSoldOutMessage(root));
}

function showProductPanelHint(root, message = "") {
  const hint = root.querySelector("[data-product-panel-soldout-hint]");
  if (!hint) return;
  hint.textContent = message || getFallbackSoldOutMessage(root);
  hint.hidden = false;
  window.requestAnimationFrame(() => hint.classList.add("show"));
}

function hideSoldOutSizeHint(root) {
  hideProductPanelHint(root);
}

function hideProductPanelHint(root) {
  const hint = root.querySelector("[data-product-panel-soldout-hint]");
  if (!hint) return;
  hint.classList.remove("show");
  window.setTimeout(() => {
    if (!hint.classList.contains("show")) hint.hidden = true;
  }, 180);
}

function isTouchLikePointer() {
  return window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches || false;
}

function getFallbackSoldOutMessage(root) {
  return createSiteCopy(root?.dataset?.productPanelLanguage || "English").t("product.sizeSoldOut");
}

function openProductPanel(root, product, onProductChange, { restart = false, recordAnalytics = true, recordDetailEvents = true, language = "", openClass = "product-open", siteSlug = "", guestMode = false } = {}) {
  cancelProductPanelCheckout(root);
  const currentSiteSlug = normalizeSiteSlug(siteSlug || root?.dataset?.productPanelSiteSlug);
  const productForCurrentSite = applyProductPanelDiscountSelections(root, prepareProductForGuest(
    prepareProductForCurrentSite(product, currentSiteSlug),
    guestMode,
  ), currentSiteSlug);
  const wasOpen = document.body.classList.contains(openClass);
  const applyProduct = () => {
    closeProductCart(root);
    updateProductPanel(root, productForCurrentSite, { language });
    resetProductQuantity(root);
    onProductChange?.(productForCurrentSite);
    if (recordAnalytics && recordDetailEvents) {
      recordProductAnalyticsEvent({
        ...(productForCurrentSite.analytics || {}),
        eventType: "product_detail_open",
        source: "product_detail_panel",
      });
    }
    document.body.classList.add(openClass);
    hydrateProductPanelCheckout(root, productForCurrentSite, onProductChange, {
      language,
      openClass,
      siteSlug: currentSiteSlug,
      guestMode,
    });
  };
  if (restart && wasOpen) {
    animateProductPanelSwitch(root, applyProduct, { openClass });
    return;
  }
  applyProduct();
}

function closeProductPanel(root, onProductChange, { openClass = "product-open" } = {}) {
  cancelProductPanelCheckout(root);
  closeProductCart(root);
  document.body.classList.remove(openClass);
  clearProductPanelSwitchState(document);
  onProductChange?.(null);
}

function animateProductPanelSwitch(root, applyProduct, { openClass = "product-open" } = {}) {
  const panel = root?.querySelector?.(".prod-panel");
  if (!panel || prefersReducedMotion()) {
    applyProduct();
    return;
  }
  const switchKey = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  root.dataset.productPanelSwitchKey = switchKey;
  panel.classList.remove("is-product-switching-in");
  panel.classList.add("is-product-switching-out");
  window.setTimeout(() => {
    if (root.dataset.productPanelSwitchKey !== switchKey) return;
    if (!document.body.classList.contains(openClass)) {
      clearProductPanelSwitchState(root);
      return;
    }
    applyProduct();
    panel.classList.remove("is-product-switching-out");
    panel.classList.add("is-product-switching-in");
    window.setTimeout(() => {
      if (root.dataset.productPanelSwitchKey !== switchKey) return;
      clearProductPanelSwitchState(root);
    }, PRODUCT_SWITCH_IN_MS);
  }, PRODUCT_SWITCH_OUT_MS);
}

function clearProductPanelSwitchState(root) {
  delete root?.dataset?.productPanelSwitchKey;
  root?.querySelector?.(".prod-panel")?.classList.remove("is-product-switching-out", "is-product-switching-in");
}

function bindPaymentMethodRailDrag(root) {
  const rail = root.querySelector("[data-product-panel-payments]");
  if (!rail) return;
  let pointerId = null;
  let startX = 0;
  let startScrollLeft = 0;
  let isDragging = false;

  rail.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || rail.scrollWidth <= rail.clientWidth + 1) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startScrollLeft = rail.scrollLeft;
    isDragging = false;
  });

  rail.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const deltaX = event.clientX - startX;
    if (!isDragging && Math.abs(deltaX) < 4) return;
    if (!isDragging) {
      isDragging = true;
      rail.classList.add("is-dragging");
      rail.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    rail.scrollLeft = startScrollLeft - deltaX;
  });

  const endDrag = (event) => {
    if (pointerId !== event.pointerId) return;
    if (isDragging) {
      rail.classList.remove("is-dragging");
      rail.releasePointerCapture?.(event.pointerId);
    }
    pointerId = null;
    isDragging = false;
  };

  rail.addEventListener("pointerup", endDrag);
  rail.addEventListener("pointercancel", endDrag);
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
}
