import { ICONS } from "../../icons/icons.js";
import { markPendingShopifyPaymentReturn } from "../../app/shopify-payment-return-reconciliation.js";
import { createSiteCopy } from "../../i18n/site-copy.js";
import { calculateSelectedProductDiscountPrice, normalizeSelectedDiscountOfferIds, resolveFixedDiscountAmountForPrice, updateProductPanelPricePreview } from "./chat-product-panel-discounts.js";
import { parseProductPayload, renderPaymentMethods } from "./chat-product-panel-renderer.js";
import { calculateCustomizationSurcharge, hasIncompleteRequiredCustomization } from "./chat-product-panel-customization.js";
import { formatProductDisplayPrice, parseProductDisplayPrice } from "./chat-product-price-format.js";

const CART_STATE = new WeakMap();
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

export function productCartHtml({ pageLanguage = "English" } = {}) {
  const copy = createSiteCopy(pageLanguage);
  return `
    <aside class="product-cart-panel" data-product-cart-panel data-cart-state="closed" role="dialog" aria-modal="true" aria-hidden="true">
      <div class="pp-head product-cart-head"><span class="pp-title">${copy.t("product.cartTitle")}</span><button class="pp-close" data-product-cart-close type="button" aria-label="${copy.t("common.close")}">${ICONS.close}</button></div>
      <div class="pp-scroll product-cart-scroll">
        <div class="product-cart-empty" data-product-cart-empty>${ICONS.shop}<strong>${copy.t("product.cartEmpty")}</strong></div>
        <div class="product-cart-list" data-product-cart-list></div>
      </div>
      <div class="product-cart-discount-notice" data-product-cart-discount-notice hidden aria-live="polite"></div>
      <div class="pp-foot product-cart-foot">
        <div class="product-cart-summary"><span>${copy.t("product.subtotal")}</span><strong data-product-cart-subtotal>—</strong></div>
        <div class="product-cart-discount" data-product-cart-discount hidden><span>${copy.t("product.discount")}</span><strong data-product-cart-discount-value>—</strong></div>
        <p class="product-cart-status" data-product-cart-status hidden aria-live="polite"></p>
        <button class="btn btn-primary product-cart-checkout" data-product-cart-checkout type="button" disabled>${ICONS.shop} ${copy.t("product.checkout")}</button>
        <div class="pp-payment-strip product-cart-payment-strip" data-product-cart-payments hidden></div>
        <div class="pp-price-note product-cart-price-note" data-product-cart-price-note>${copy.t("product.priceNote")}</div>
      </div>
    </aside>`;
}

export function bindProductCart(root, { language = "", onCheckout, onItemsChange, requireAuthForCheckout = false, onRestrictedCheckout, suppressCheckoutStatus = false } = {}) {
  if (!root || CART_STATE.has(root)) return;
  const state = createCartState();
  state.onItemsChange = typeof onItemsChange === "function" ? onItemsChange : null;
  CART_STATE.set(root, state);
  root.dataset.productPanelQuantity = "1";
  renderProductQuantity(root);
  renderProductCart(root, language);

  root.addEventListener("click", (event) => {
    const quantityButton = event.target.closest?.("[data-product-quantity-action]");
    if (quantityButton && root.contains(quantityButton)) {
      const delta = quantityButton.dataset.productQuantityAction === "increase" ? 1 : -1;
      setProductQuantity(root, Number(root.dataset.productPanelQuantity || 1) + delta);
      return;
    }
    const openButton = event.target.closest?.("[data-product-cart-open]");
    if (openButton && root.contains(openButton)) {
      openProductCart(root, language);
      return;
    }
    const closeButton = event.target.closest?.("[data-product-cart-close]");
    if (closeButton && root.contains(closeButton)) {
      closeProductCart(root);
      return;
    }
    const itemButton = event.target.closest?.("[data-product-cart-item-action]");
    if (itemButton && root.contains(itemButton)) {
      updateCartLine(root, itemButton.dataset.productCartItemId || "", itemButton.dataset.productCartItemAction || "");
      renderProductCart(root, language);
      queueCartItemsSync(root, language);
      return;
    }
    const checkoutButton = event.target.closest?.("[data-product-cart-checkout]");
    if (checkoutButton && root.contains(checkoutButton) && !checkoutButton.disabled) {
      if (requireAuthForCheckout) {
        onRestrictedCheckout?.();
        return;
      }
      void checkoutProductCart(root, { language, onCheckout, suppressCheckoutStatus });
    }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !isProductCartOpen(root)) return;
    event.preventDefault();
    closeProductCart(root);
  });
}

export function resetProductQuantity(root) {
  setProductQuantity(root, 1);
}

export function addCurrentProductToCart(root, { language = "" } = {}) {
  const product = parseProductPayload(root?.dataset?.productPanelProduct);
  if (!root || !product || typeof product !== "object") return [];
  if (hasIncompleteRequiredCustomization(product.customizationOptions, product.customizationSelections)) return getProductCartItems(root);
  const state = getCartState(root);
  state.status = null;
  state.discountEvaluation = null;
  state.items = upsertCartItem(state.items, product, Number(root.dataset.productPanelQuantity || 1));
  renderProductCart(root, language);
  openProductCart(root, language);
  resetProductQuantity(root);
  const items = getProductCartItems(root);
  queueCartItemsSync(root, language);
  return items;
}

export function openProductCart(root, language = "") {
  renderProductCart(root, language);
  const state = getCartState(root);
  state.status = null;
  if (!isProductCartOpen(root)) state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const panel = getCartPanel(root);
  if (!panel) return;
  clearCartCloseTimer(state);
  state.transitionToken = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const token = state.transitionToken;
  panel?.setAttribute("aria-hidden", "false");
  panel.dataset.cartState = "opening";
  void panel.offsetWidth;
  requestCartFrame(root, () => {
    if (state.transitionToken !== token || panel.dataset.cartState !== "opening") return;
    panel.dataset.cartState = "open";
  });
  panel?.querySelector?.("[data-product-cart-close]")?.focus?.();
}

export function closeProductCart(root) {
  const state = getCartState(root);
  const panel = getCartPanel(root);
  if (!panel || !isProductCartOpen(root)) return;
  state.transitionToken = "";
  panel.dataset.cartState = "closing";
  settleCartClosed(root, panel, state);
  state.returnFocus?.focus?.();
  state.returnFocus = null;
}

export function getProductCartItems(root) {
  return getCartState(root).items.map((item) => ({ ...item, product: { ...item.product } }));
}

export function clearProductCart(root, { language = "" } = {}) {
  if (!root) return [];
  const state = getCartState(root);
  state.pendingItems = null;
  state.status = null;
  state.discountEvaluation = null;
  state.items = [];
  renderProductCart(root, language);
  return [];
}

export function syncCartDiscountSelection(root, product = {}, { language = "", selectedDiscountOfferIds = [] } = {}) {
  if (!root || !product || typeof product !== "object") return getProductCartItems(root);
  const state = getCartState(root);
  const normalizedSelections = normalizeSelectedDiscountOfferIds(selectedDiscountOfferIds, product.selectedDiscountOfferId);
  const nextItems = state.items.map((item) => {
    const isCurrentConfiguration = createCartConfigurationId(item?.product) === createCartConfigurationId(product);
    const sourceProduct = isCurrentConfiguration ? { ...(item.product || {}), ...product } : { ...(item.product || {}) };
    const availableIds = new Set((Array.isArray(sourceProduct.discountOffers) ? sourceProduct.discountOffers : []).map((offer) => String(offer?.id || "").trim()).filter(Boolean));
    const nextIds = normalizedSelections.filter((id) => availableIds.has(id));
    const nextProduct = { ...sourceProduct, selectedDiscountOfferIds: nextIds, selectedDiscountOfferId: nextIds[0] || "" };
    return {
      ...item,
      id: createCartLineId(nextProduct),
      product: nextProduct,
      unitPrice: resolveCartUnitPrice(nextProduct),
    };
  });
  state.items = mergeCartItems(nextItems);
  state.discountEvaluation = null;
  renderProductCart(root, language);
  queueCartItemsSync(root, language);
  return getProductCartItems(root);
}

export function clampCartQuantity(value) {
  const quantity = Math.trunc(Number(value) || MIN_QUANTITY);
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, quantity));
}

export function createCartLineId(product = {}) {
  return [
    createCartConfigurationId(product),
    normalizeSelectedDiscountOfferIds(product.selectedDiscountOfferIds, product.selectedDiscountOfferId).join("|"),
  ].map((value) => String(value || "").trim()).join("::");
}

function createCartConfigurationId(product = {}) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : [];
  const selectedSize = sizes[Number(product.selectedSizeIndex)] || {};
  const selections = Object.entries(product.customizationSelections || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
  return [
    product.productId || product.id || product.handle || product.url || product.name,
    selectedSize.variantId || selectedSize.id || selectedSize.label || "",
    selections,
  ].map((value) => String(value || "").trim()).join("::");
}

export function upsertCartItem(items = [], product = {}, quantity = 1) {
  const next = (Array.isArray(items) ? items : []).map((item) => ({ ...item }));
  const id = createCartLineId(product);
  if (!id.replaceAll(":", "")) return next;
  const index = next.findIndex((item) => item.id === id);
  if (index >= 0) {
    next[index].quantity = clampCartQuantity(next[index].quantity + clampCartQuantity(quantity));
    return next;
  }
  next.push({ id, product: { ...product }, quantity: clampCartQuantity(quantity), unitPrice: resolveCartUnitPrice(product) });
  return next;
}

export function updateCartItems(items = [], id = "", action = "") {
  const rows = (Array.isArray(items) ? items : []).map((item) => ({ ...item }));
  const index = rows.findIndex((item) => item.id === id);
  if (index < 0) return rows;
  if (action === "remove") return rows.filter((item) => item.id !== id);
  if (action === "increase") rows[index].quantity = clampCartQuantity(rows[index].quantity + 1);
  if (action === "decrease") {
    if (rows[index].quantity <= MIN_QUANTITY) return rows.filter((item) => item.id !== id);
    rows[index].quantity = clampCartQuantity(rows[index].quantity - 1);
  }
  return rows;
}

export function calculateCartSubtotal(items = []) {
  return calculateCartPricing(items).total;
}

function getCartState(root) {
  if (!CART_STATE.has(root)) CART_STATE.set(root, createCartState());
  return CART_STATE.get(root);
}

function createCartState() {
  return {
    items: [], closeTimer: null, transitionToken: "", returnFocus: null,
    syncing: false, syncingItems: false, pendingItems: null, onItemsChange: null, status: null, discountEvaluation: null,
  };
}

function isProductCartOpen(root) {
  const state = getCartPanel(root)?.dataset?.cartState;
  return state === "opening" || state === "open";
}

function getCartPanel(root) {
  return root?.querySelector?.("[data-product-cart-panel]") || null;
}

function requestCartFrame(root, callback) {
  const view = root?.ownerDocument?.defaultView;
  if (view?.requestAnimationFrame) view.requestAnimationFrame(callback);
  else callback();
}

function settleCartClosed(root, panel, state) {
  clearCartCloseTimer(state);
  const finalize = () => {
    if (panel.dataset.cartState !== "closing") return;
    panel.dataset.cartState = "closed";
    panel.setAttribute("aria-hidden", "true");
    clearCartCloseTimer(state);
  };
  const onTransitionEnd = (event) => {
    if (event.target !== panel || event.propertyName !== "transform") return;
    panel.removeEventListener("transitionend", onTransitionEnd);
    finalize();
  };
  panel.addEventListener("transitionend", onTransitionEnd);
  state.closeTimer = root?.ownerDocument?.defaultView?.setTimeout(finalize, 360) || null;
}

function clearCartCloseTimer(state) {
  if (state?.closeTimer == null) return;
  window.clearTimeout(state.closeTimer);
  state.closeTimer = null;
}

function setProductQuantity(root, value) {
  if (!root) return;
  root.dataset.productPanelQuantity = String(clampCartQuantity(value));
  renderProductQuantity(root);
  updateProductPanelPricePreview(
    root,
    parseProductPayload(root.dataset.productPanelProduct),
    createSiteCopy(root.dataset.productPanelLanguage || "English"),
  );
}

function renderProductQuantity(root) {
  const value = clampCartQuantity(root?.dataset?.productPanelQuantity || 1);
  const output = root?.querySelector?.("[data-product-panel-quantity]");
  if (output) output.textContent = String(value);
  const decrease = root?.querySelector?.('[data-product-quantity-action="decrease"]');
  const increase = root?.querySelector?.('[data-product-quantity-action="increase"]');
  if (decrease) decrease.disabled = value <= MIN_QUANTITY;
  if (increase) increase.disabled = value >= MAX_QUANTITY;
}

function updateCartLine(root, id, action) {
  const state = getCartState(root);
  state.status = null;
  state.discountEvaluation = null;
  state.items = updateCartItems(state.items, id, action);
}

function renderProductCart(root, language = "") {
  const copy = createSiteCopy(language || root?.dataset?.productPanelLanguage || "English");
  const state = getCartState(root);
  const items = state.items;
  const list = root?.querySelector?.("[data-product-cart-list]");
  const empty = root?.querySelector?.("[data-product-cart-empty]");
  const subtotal = root?.querySelector?.("[data-product-cart-subtotal]");
  const checkout = root?.querySelector?.("[data-product-cart-checkout]");
  const count = root?.querySelector?.("[data-product-cart-count]");
  const payments = root?.querySelector?.("[data-product-cart-payments]");
  const priceNote = root?.querySelector?.("[data-product-cart-price-note]");
  const discountRow = root?.querySelector?.("[data-product-cart-discount]");
  const discountValue = root?.querySelector?.("[data-product-cart-discount-value]");
  const status = root?.querySelector?.("[data-product-cart-status]");
  const detailProduct = parseProductPayload(root?.dataset?.productPanelProduct);
  const paymentProducts = items.length
    ? items.map((item) => item.product || {})
    : [detailProduct];
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const pricing = calculateCartPricing(items, state.discountEvaluation);
  const discountNotice = root?.querySelector?.("[data-product-cart-discount-notice]");
  if (empty) empty.hidden = items.length > 0;
  if (subtotal) subtotal.textContent = pricing.total;
  if (discountRow) discountRow.hidden = !pricing.hasDiscount;
  if (discountValue) discountValue.textContent = pricing.hasDiscount ? `-${pricing.discount}` : "—";
  renderCartDiscountNotice(discountNotice, state.discountEvaluation, copy);
  if (checkout) {
    const pending = state.syncing || state.syncingItems;
    checkout.disabled = items.length === 0 || pending;
    if (pending) {
      checkout.setAttribute("aria-busy", "true");
      checkout.innerHTML = `<span class="pp-action-spinner" aria-hidden="true"></span> ${copy.t("product.checkout")}`;
    } else {
      checkout.removeAttribute("aria-busy");
      checkout.innerHTML = `${ICONS.shop} ${copy.t("product.checkout")}`;
    }
  }
  if (count) {
    count.hidden = totalItems === 0;
    count.textContent = totalItems > MAX_QUANTITY ? `${MAX_QUANTITY}+` : String(totalItems);
  }
  renderPaymentMethods(payments, paymentProducts.flatMap((product) => product?.paymentMethods || []));
  if (priceNote) {
    priceNote.textContent = paymentProducts.some((product) => product?.selectedDiscountOfferId)
      ? copy.t("product.estimatedPriceNote")
      : copy.t("product.priceNote");
  }
  renderCartStatus(status, state.status, copy);
  if (!list) return;
  list.innerHTML = items.map((item) => renderCartItem(item, copy)).join("");
}

async function checkoutProductCart(root, { language = "", onCheckout, suppressCheckoutStatus = false } = {}) {
  const state = getCartState(root);
  if (state.syncing) return;
  const items = getProductCartItems(root);
  state.syncing = true;
  const suppressStatus = suppressCheckoutStatus || root?.dataset?.productPanelCartProvider === "shopify";
  state.status = suppressStatus ? null : { type: "pending" };
  renderProductCart(root, language);
  try {
    const result = typeof onCheckout === "function" ? await onCheckout(items) : null;
    if (result?.mode === "redirect" && typeof result.redirectUrl === "string") {
      state.status = null;
      root.dispatchEvent(new CustomEvent("aiove:cart-checkout", { bubbles: true, detail: { items, result } }));
      if (root?.dataset?.productPanelCartProvider === "shopify") {
        markPendingShopifyPaymentReturn(root.dataset.productPanelSiteSlug || "");
      }
      window.location.assign(result.redirectUrl);
      return;
    }
    // Only the local TTMall test source has a server-side cart contract in this
    // phase. Other sources keep their existing local cart behavior and must not
    // be presented as a successfully saved test cart.
    state.status = result?.mode === "synced" && !suppressStatus ? { type: "success" } : null;
    root.dispatchEvent(new CustomEvent("aiove:cart-checkout", { bubbles: true, detail: { items, result } }));
  } catch (error) {
    // Upstream details are intentionally hidden: the product cart is a public UI.
    state.status = resolveCartCheckoutErrorStatus(error);
  } finally {
    state.syncing = false;
    renderProductCart(root, language);
  }
}

function queueCartItemsSync(root, language = "") {
  const state = getCartState(root);
  if (typeof state.onItemsChange !== "function") return;
  state.pendingItems = getProductCartItems(root);
  if (state.syncingItems) return;
  void flushCartItemsSync(root, language);
}

async function flushCartItemsSync(root, language = "") {
  const state = getCartState(root);
  state.syncingItems = true;
  renderProductCart(root, language);
  try {
    while (state.pendingItems) {
      const items = state.pendingItems;
      state.pendingItems = null;
      try {
        const result = await state.onItemsChange(items);
        if (!state.pendingItems) state.discountEvaluation = normalizeCartDiscountEvaluation(result?.discountEvaluation);
        if (!state.pendingItems) state.status = null;
      } catch (error) {
        state.status = resolveCartCheckoutErrorStatus(error);
      }
    }
  } finally {
    state.syncingItems = false;
    renderProductCart(root, language);
  }
}

export function resolveCartCheckoutErrorStatus(error = {}) {
  const code = String(error?.payload?.code || "").trim();
  if (code === "SHOPIFY_CUSTOMER_BINDING_REQUIRED") return { type: "shopifyBinding" };
  if (code.startsWith("SHOPIFY_CHECKOUT_") || code.startsWith("SHOPIFY_DRAFT_ORDER_")) return { type: "shopifyCheckout" };
  if (code.startsWith("SHOPIFY_CART_")) return { type: "shopifyCart" };
  if (code === "TTMALL_BINDING_REAUTH_REQUIRED" || code === "TTMALL_BINDING_REQUIRED") return { type: "binding" };
  if (code === "TTMALL_BUNDLE_REQUIRED") return { type: "bundle" };
  if (code === "TTMALL_CART_SYNC_FAILED") return { type: "error" };
  if (code.startsWith("TTMALL_")) return { type: "checkout" };
  return { type: "error" };
}

function renderCartStatus(element, status, copy) {
  if (!element) return;
  if (!status?.type) {
    element.hidden = true;
    element.textContent = "";
    delete element.dataset.state;
    return;
  }
  const messages = {
    pending: copy.t("product.cartSyncSaving"),
    success: copy.t("product.cartSyncSaved"),
    error: copy.t("product.cartSyncFailed"),
    binding: copy.t("product.cartBindingRequired"),
    bundle: copy.t("product.cartBundleRequired"),
    checkout: copy.t("product.cartCheckoutFailed"),
    shopifyBinding: copy.t("product.shopifyBindingRequired"),
    shopifyCart: copy.t("product.shopifyCartFailed"),
    shopifyCheckout: copy.t("product.shopifyCheckoutFailed"),
  };
  element.hidden = false;
  element.dataset.state = status.type;
  element.textContent = messages[status.type] || "";
}

function renderCartItem(item, copy) {
  const product = item.product || {};
  const image = resolveCartItemImage(product);
  const size = Array.isArray(product.sizes) ? product.sizes[Number(product.selectedSizeIndex)] : null;
  const selections = Object.values(product.customizationSelections || {}).map((value) => String(value || "").trim()).filter(Boolean);
  const meta = [size?.label, ...selections].filter(Boolean).join(" · ");
  return `<article class="product-cart-item" data-product-cart-item="${escapeHtml(item.id)}">
    <img src="${escapeHtml(image)}" alt="" />
    <div class="product-cart-item-main">
      <div class="product-cart-item-title-row"><strong>${escapeHtml(product.name || copy.t("product.item"))}</strong><button type="button" data-product-cart-item-action="remove" data-product-cart-item-id="${escapeHtml(item.id)}">${copy.t("product.remove")}</button></div>
      ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
      <div class="product-cart-item-bottom"><b>${escapeHtml(resolveCartUnitPrice(product) || item.unitPrice || "—")}</b><div class="pp-quantity-control product-cart-quantity"><button type="button" data-product-cart-item-action="decrease" data-product-cart-item-id="${escapeHtml(item.id)}" aria-label="${copy.t("product.decreaseQuantity")}">−</button><output>${item.quantity}</output><button type="button" data-product-cart-item-action="increase" data-product-cart-item-id="${escapeHtml(item.id)}" aria-label="${copy.t("product.increaseQuantity")}">+</button></div></div>
    </div>
  </article>`;
}

export function resolveCartItemImage(product = {}) {
  const images = Array.isArray(product.imageUrls) && product.imageUrls.length
    ? product.imageUrls
    : (Array.isArray(product.images) ? product.images : []);
  const requestedIndex = Math.trunc(Number(product.imageIndex));
  const imageIndex = Number.isFinite(requestedIndex)
    ? Math.min(Math.max(requestedIndex, 0), Math.max(images.length - 1, 0))
    : 0;
  return images[imageIndex] || product.imageUrl || product.image || "/assets/jersey_product.png";
}

function resolveCartUnitPrice(product = {}) {
  return resolveCartUnitPricing(product).finalFormatted;
}

function resolveCartUnitPricing(product = {}) {
  const discounted = calculateSelectedProductDiscountPrice(product);
  const selectedSize = Array.isArray(product.sizes) ? product.sizes[Number(product.selectedSizeIndex)] : null;
  const baseFormatted = String(selectedSize?.price || product.priceNow || product.price || "").trim();
  const base = parseProductDisplayPrice(baseFormatted);
  if (!base) return { base: null, final: null, baseFormatted, finalFormatted: discounted?.formatted || baseFormatted };
  const legacyOrderOffer = resolveLegacyOrderPreviewOffer(product);
  const surcharge = calculateCustomizationSurcharge(product.customizationOptions, product.customizationSelections);
  const discountedPrice = legacyOrderOffer ? null : parseProductDisplayPrice(discounted?.formatted);
  const sourcePrice = discountedPrice || base;
  const final = { ...sourcePrice, value: sourcePrice.value + surcharge };
  const baseWithCustomization = { ...base, value: base.value + surcharge };
  return {
    base: baseWithCustomization,
    final,
    baseFormatted: formatProductDisplayPrice(baseWithCustomization, baseWithCustomization.value),
    finalFormatted: formatProductDisplayPrice(final, final.value),
    legacyOrderOffer,
  };
}

function resolveLegacyOrderPreviewOffer(product = {}) {
  const selectedOfferIds = new Set(normalizeSelectedDiscountOfferIds(product.selectedDiscountOfferIds, product.selectedDiscountOfferId));
  const offer = (Array.isArray(product.discountOffers) ? product.discountOffers : [])
    .find((item) => selectedOfferIds.has(String(item?.id || "")));
  return offer?.combination || offer?.pricingPreview?.type !== "fixed_amount" || offer.pricingPreview.appliesOnEachItem === true
    ? null
    : offer;
}

export function calculateCartPricing(items = [], discountEvaluation = null) {
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const product = item?.product;
    const pricing = product && typeof product === "object"
      ? resolveCartUnitPricing(product)
      : { base: parseProductDisplayPrice(item?.unitPrice), final: parseProductDisplayPrice(item?.unitPrice), legacyOrderOffer: null };
    return { pricing, quantity: clampCartQuantity(item?.quantity) };
  });
  if (!rows.length || rows.some((row) => !row.pricing.base || !row.pricing.final)) {
    return { total: "—", discount: "—", hasDiscount: false };
  }
  const signature = priceSignature(rows[0].pricing.base);
  if (rows.some((row) => priceSignature(row.pricing.base) !== signature || priceSignature(row.pricing.final) !== signature)) {
    return { total: "—", discount: "—", hasDiscount: false };
  }
  const baseTotal = rows.reduce((sum, row) => sum + row.pricing.base.value * row.quantity, 0);
  const lineTotal = rows.reduce((sum, row) => sum + row.pricing.final.value * row.quantity, 0);
  // Compatibility only: rows created before Shopify exposed discount classes
  // have no way to distinguish an order amount from a product amount. New
  // classified offers always wait for the trusted server calculation below.
  const legacyOrderOffer = rows
    .map((row) => row.pricing.legacyOrderOffer)
    .find((offer) => resolveFixedDiscountAmountForPrice(offer?.pricingPreview, rows[0].pricing.base) != null);
  const legacyOrderDiscount = resolveFixedDiscountAmountForPrice(legacyOrderOffer?.pricingPreview, rows[0].pricing.base) || 0;
  const trusted = normalizeCartDiscountEvaluation(discountEvaluation);
  const total = trusted?.state === "applied" && trusted.total && trusted.discount
    ? trusted.total.amount
    : trusted?.state === "threshold_not_met"
      ? baseTotal
      : Math.max(0, lineTotal - legacyOrderDiscount);
  const discount = trusted?.state === "applied" && trusted.discount
    ? trusted.discount.amount
    : trusted?.state === "threshold_not_met"
      ? 0
      : Math.max(0, baseTotal - total);
  const price = rows[0].pricing.base;
  return {
    total: formatProductDisplayPrice(price, total),
    discount: formatProductDisplayPrice(price, discount),
    hasDiscount: discount > 0.004,
  };
}

function renderCartDiscountNotice(element, evaluation, copy) {
  if (!element) return;
  const value = normalizeCartDiscountEvaluation(evaluation);
  const threshold = value?.threshold || (value?.state === "threshold_not_met" ? value : null);
  if (!threshold) {
    element.hidden = true;
    element.textContent = "";
    return;
  }
  element.hidden = false;
  if (threshold.thresholdType === "quantity") {
    element.textContent = copy.t("product.discountThresholdQuantity", { count: threshold.remainingQuantity, code: threshold.code });
    return;
  }
  if (threshold.remainingAmount == null || !threshold.currencyCode) {
    element.textContent = copy.t("product.discountThresholdSubtotalPending", { code: threshold.code });
    return;
  }
  element.textContent = copy.t("product.discountThresholdSubtotal", { amount: formatEvaluationMoney(threshold.remainingAmount, threshold.currencyCode), code: threshold.code });
}

function normalizeCartDiscountEvaluation(value = null) {
  const source = value && typeof value === "object" ? value : null;
  if (!source || !["applied", "threshold_not_met", "not_eligible", "none"].includes(String(source.state || ""))) return null;
  const money = (entry) => {
    const amount = Number(entry?.amount);
    const currencyCode = String(entry?.currencyCode || "").trim().toUpperCase();
    return Number.isFinite(amount) && amount >= 0 && /^[A-Z]{3}$/.test(currencyCode) ? { amount, currencyCode } : null;
  };
  const threshold = (Array.isArray(source.evaluations) ? source.evaluations : []).find((item) => String(item?.state || "") === "threshold_not_met") || null;
  const normalizeThreshold = (entry) => entry && typeof entry === "object" ? {
    code: String(entry.code || "").trim().slice(0, 64),
    thresholdType: String(entry.thresholdType || "").trim(),
    remainingQuantity: Math.max(0, Math.ceil(Number(entry.remainingQuantity || 0))),
    remainingAmount: Number.isFinite(Number(entry.remainingAmount)) && Number(entry.remainingAmount) > 0 ? Number(entry.remainingAmount) : null,
    currencyCode: String(entry.currencyCode || "").trim().toUpperCase(),
  } : null;
  return {
    state: String(source.state),
    code: String(source.code || "").trim().slice(0, 64),
    thresholdType: String(source.thresholdType || "").trim(),
    remainingQuantity: Math.max(0, Math.ceil(Number(source.remainingQuantity || 0))),
    remainingAmount: Number.isFinite(Number(source.remainingAmount)) && Number(source.remainingAmount) > 0
      ? Number(source.remainingAmount)
      : null,
    currencyCode: String(source.currencyCode || "").trim().toUpperCase(),
    subtotal: money(source.subtotal), discount: money(source.discount), total: money(source.total),
    threshold: normalizeThreshold(threshold),
  };
}

function formatEvaluationMoney(amount, currencyCode) {
  const currency = String(currencyCode || "").trim().toUpperCase();
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount || 0)); } catch { return `${Number(amount || 0).toFixed(2)} ${currency}`.trim(); }
}

function mergeCartItems(items = []) {
  const merged = new Map();
  for (const item of items) {
    const id = String(item?.id || "");
    if (!id) continue;
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { ...item, product: { ...(item.product || {}) }, quantity: clampCartQuantity(item.quantity) });
      continue;
    }
    existing.quantity = clampCartQuantity(existing.quantity + clampCartQuantity(item.quantity));
    existing.product = { ...(existing.product || {}), ...(item.product || {}) };
    existing.unitPrice = resolveCartUnitPrice(existing.product);
  }
  return [...merged.values()];
}

function priceSignature(price) {
  return `${price?.prefix || ""}|${price?.suffix || ""}|${price?.decimals || ""}`;
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
