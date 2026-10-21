import assert from "node:assert/strict";
import fs from "node:fs";
import {
  calculateCartPricing,
  calculateCartSubtotal,
  clearProductCart,
  clampCartQuantity,
  createCartLineId,
  resolveCartItemImage,
  resolveCartCheckoutErrorStatus,
  updateCartItems,
  upsertCartItem,
} from "../src/features/chat/chat-product-cart.js";
import { setProductPanelAddPending } from "../src/features/chat/chat-product-panel-renderer.js";
import { hasIncompleteRequiredCustomization } from "../src/features/chat/chat-product-panel-customization.js";
import { createSiteCopy } from "../src/i18n/site-copy.js";

const baseProduct = {
  productId: "product-1",
  name: "Test shirt",
  priceNow: "£10.00",
  selectedSizeIndex: 0,
  sizes: [
    { label: "S", variantId: "variant-s", price: "£10.00" },
    { label: "M", variantId: "variant-m", price: "£10.00" },
  ],
};

assert.equal(typeof clearProductCart, "function", "the shared cart must expose a local-only clear operation for a consumed TTMall checkout");
const cartSource = fs.readFileSync("src/features/chat/chat-product-cart.js", "utf8");
const productCartServiceSource = fs.readFileSync("src/services/product-cart-service.js", "utf8");
const apiConfigSource = fs.readFileSync("src/config/api-config.js", "utf8");
const clearCartSource = cartSource.slice(cartSource.indexOf("export function clearProductCart"), cartSource.indexOf("export function syncCartDiscountSelection"));
assert.doesNotMatch(clearCartSource, /queueCartItemsSync|onItemsChange/, "clearing a consumed checkout cart must never issue another provider cart sync");
assert.doesNotMatch(`${productCartServiceSource}\n${apiConfigSource}`, /checkoutTtmallProductCart|ttmallCartCheckout/, "the obsolete TTMall cart checkout client endpoint must not remain beside the dedicated checkout flow");

assert.equal(clampCartQuantity(0), 1, "quantity must not fall below one");
assert.equal(clampCartQuantity(100), 99, "quantity must not exceed 99");
assert.deepEqual(resolveCartCheckoutErrorStatus({ payload: { code: "TTMALL_CART_SYNC_FAILED" } }), { type: "error" }, "cart-sync failures must retain the save-specific message");
assert.deepEqual(resolveCartCheckoutErrorStatus({ payload: { code: "TTMALL_PAYPAL_REDIRECT_MISSING" } }), { type: "checkout" }, "checkout failures must not be mislabeled as cart-save failures");
assert.deepEqual(resolveCartCheckoutErrorStatus({ payload: { code: "TTMALL_BINDING_REAUTH_REQUIRED" } }), { type: "binding" }, "expired bindings must request a reconnect");
assert.deepEqual(resolveCartCheckoutErrorStatus({ payload: { code: "TTMALL_BUNDLE_REQUIRED" } }), { type: "bundle" }, "bundle requirements must remain actionable");
assert.equal(hasIncompleteRequiredCustomization([{ id: "name", name: "Name", type: "text", required: true }], {}), true, "required customization must block an incomplete cart line");
assert.equal(hasIncompleteRequiredCustomization([{ id: "name", name: "Name", type: "text", required: true }], { name: "HAVARD" }), false, "completed required customization should allow add to cart");

let items = upsertCartItem([], baseProduct, 2);
items = upsertCartItem(items, baseProduct, 3);
assert.equal(items.length, 1, "the same product configuration should merge into one cart line");
assert.equal(items[0].quantity, 5, "merged cart lines should add their quantities");

items = upsertCartItem(items, { ...baseProduct, selectedSizeIndex: 1 }, 1);
assert.equal(items.length, 2, "different selected sizes should remain separate cart lines");

const firstId = createCartLineId({
  ...baseProduct,
  customizationSelections: { number: "10", name: "HAVARD" },
});
const sameSelectionsDifferentOrder = createCartLineId({
  ...baseProduct,
  customizationSelections: { name: "HAVARD", number: "10" },
});
assert.equal(firstId, sameSelectionsDifferentOrder, "customization key order must not create duplicate lines");

const removableId = items[0].id;
items = updateCartItems(items, removableId, "decrease");
assert.equal(items[0].quantity, 4, "decrease should update the selected cart line");
items = updateCartItems([{ ...items[0], quantity: 1 }], removableId, "decrease");
assert.equal(items.length, 0, "decreasing a quantity-one line should remove it");

assert.equal(
  calculateCartSubtotal([
    { unitPrice: "£10.00", quantity: 2 },
    { unitPrice: "£5.00", quantity: 1 },
  ]),
  "£25.00",
  "subtotal should preserve the product currency display",
);
assert.match(
  calculateCartSubtotal([
    { unitPrice: "15 500 Ft", quantity: 2 },
  ]),
  /^31[\s\u00a0\u202f]000[\s\u00a0\u202f]Ft$/,
  "cart subtotals must parse and multiply formatted HUF prices without splitting the thousands separator",
);
assert.equal(
  calculateCartSubtotal([
    { unitPrice: "MAD 473.00", quantity: 2 },
  ]),
  "Dh 946.00 MAD",
  "cart subtotals must preserve MTT's Dh prefix and MAD suffix after quantity changes",
);

assert.equal(
  resolveCartItemImage({ imageUrls: ["/front.jpg", "/back.jpg"], imageIndex: 1 }),
  "/back.jpg",
  "cart thumbnails must retain the image currently selected in the product gallery",
);

const customized = upsertCartItem([], {
  ...baseProduct,
  customizationOptions: [{ id: "name", name: "Name", type: "text", price: 5 }],
  customizationSelections: { name: "HAVARD" },
}, 1);
assert.equal(calculateCartSubtotal(customized), "£15.00", "customization surcharge should be included in the cart subtotal");

const orderDiscount = upsertCartItem([], {
  ...baseProduct,
  selectedDiscountOfferId: "order-offer",
  discountOffers: [{
    id: "order-offer",
    code: "ORDER5",
    offerDescription: "Order discount",
    pricingPreview: { eligible: true, type: "fixed_amount", value: 5, currencyCode: "GBP", appliesOnEachItem: false },
  }],
}, 2);
assert.equal(calculateCartSubtotal(orderDiscount), "£15.00", "legacy offers without a discount class retain their prior single-code preview behavior");
assert.deepEqual(
  calculateCartPricing(orderDiscount),
  { total: "£15.00", discount: "£5.00", hasDiscount: true },
  "legacy offers without a discount class retain their prior single-code preview behavior",
);
assert.deepEqual(
  calculateCartPricing(orderDiscount, {
    state: "applied", discount: { amount: 5, currencyCode: "GBP" }, total: { amount: 15, currencyCode: "GBP" },
    evaluations: [{ state: "applied", code: "ALOVE1" }, { state: "threshold_not_met", code: "ALOVE2", thresholdType: "subtotal", remainingAmount: 2, currencyCode: "GBP" }],
  }),
  { total: "£15.00", discount: "£5.00", hasDiscount: true },
  "a threshold failure for one selected code must not remove an independently applied discount",
);
const marketOrderDiscount = upsertCartItem([], {
  ...baseProduct,
  priceNow: "£42.00",
  sizes: [{ label: "M", variantId: "variant-m", price: "£42.00" }],
  selectedDiscountOfferId: "market-order-offer",
  discountOffers: [{
    id: "market-order-offer",
    code: "TEST",
    offerDescription: "$0.01 off entire order",
    pricingPreview: {
      eligible: true,
      type: "fixed_amount",
      value: 0.01,
      currencyCode: "USD",
      marketValue: 0.01,
      marketCurrencyCode: "GBP",
      appliesOnEachItem: false,
    },
  }],
}, 1);
assert.deepEqual(
  calculateCartPricing(marketOrderDiscount),
  { total: "£41.99", discount: "£0.01", hasDiscount: true },
  "legacy market previews retain their prior single-code behavior",
);
const competingOrderDiscounts = [
  ...orderDiscount,
  ...upsertCartItem([], {
    ...baseProduct,
    productId: "product-2",
    selectedDiscountOfferId: "order-offer-2",
    discountOffers: [{
      id: "order-offer-2",
      code: "ORDER3",
      offerDescription: "Another order discount",
      pricingPreview: { eligible: true, type: "fixed_amount", value: 3, currencyCode: "GBP", appliesOnEachItem: false },
    }],
  }, 1),
];
assert.deepEqual(
  calculateCartPricing(competingOrderDiscounts),
  { total: "£25.00", discount: "£5.00", hasDiscount: true },
  "legacy order-level previews retain their prior behavior until their class is available",
);
const knownOrderDiscount = upsertCartItem([], {
  ...baseProduct,
  selectedDiscountOfferIds: ["order-offer"],
  discountOffers: [{
    id: "order-offer",
    code: "ORDER5",
    offerDescription: "Order discount",
    combination: { discountClasses: ["ORDER"], combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: false } },
    pricingPreview: { eligible: true, type: "fixed_amount", value: 5, currencyCode: "GBP", appliesOnEachItem: false },
  }],
}, 2);
assert.deepEqual(
  calculateCartPricing(knownOrderDiscount),
  { total: "£20.00", discount: "£0.00", hasDiscount: false },
  "a classified order discount must wait for Shopify Calculate instead of changing multi-item cart totals locally",
);
const percentageDiscount = upsertCartItem([], {
  ...baseProduct,
  selectedDiscountOfferId: "save10",
  discountOffers: [{
    id: "save10",
    code: "SAVE10",
    offerDescription: "10% off",
    pricingPreview: { eligible: true, type: "percentage", value: 10, currencyCode: "", appliesOnEachItem: false },
  }],
}, 2);
assert.deepEqual(
  calculateCartPricing(percentageDiscount),
  { total: "£18.00", discount: "£2.00", hasDiscount: true },
  "per-item percentage discounts must update both line prices and the cart total",
);
assert.deepEqual(
  calculateCartPricing(percentageDiscount, {
    state: "threshold_not_met", code: "SAVE10", thresholdType: "subtotal", remainingAmount: 5, currencyCode: "GBP",
  }),
  { total: "£20.00", discount: "£0.00", hasDiscount: false },
  "a pending server threshold must force the cart back to its undiscounted price",
);
assert.deepEqual(
  calculateCartPricing(orderDiscount, {
    state: "applied", code: "ORDER5", discount: { amount: 4, currencyCode: "GBP" }, total: { amount: 16, currencyCode: "GBP" },
  }),
  { total: "£16.00", discount: "£4.00", hasDiscount: true },
  "a server-confirmed calculation must override a local discount estimate",
);
assert.equal(
  calculateCartSubtotal([
    { unitPrice: "£10.00", quantity: 1 },
    { unitPrice: "$5.00", quantity: 1 },
  ]),
  "—",
  "mixed currencies must not be combined into a misleading subtotal",
);

const primaryActionState = { busy: false };
const primaryActionButton = {
  disabled: false,
  dataset: {},
  innerHTML: "",
  setAttribute(name) { if (name === "aria-busy") primaryActionState.busy = true; },
  removeAttribute(name) { if (name === "aria-busy") primaryActionState.busy = false; },
};
const primaryActionRoot = {
  dataset: {
    productPanelLanguage: "English",
    productPanelProduct: JSON.stringify(baseProduct),
  },
  querySelector(selector) { return selector === "[data-product-panel-buy]" ? primaryActionButton : null; },
};
setProductPanelAddPending(primaryActionRoot, true);
assert.equal(primaryActionButton.disabled, true, "add to cart should be disabled during asynchronous readiness work");
assert.equal(primaryActionState.busy, true, "add to cart should expose its pending state to assistive technology");
assert.match(primaryActionButton.innerHTML, /pp-action-spinner/, "add to cart should replace its icon with the shared spinner while pending");
setProductPanelAddPending(primaryActionRoot, false);
assert.equal(primaryActionState.busy, false, "add to cart should clear its pending state after the request settles");
assert.doesNotMatch(primaryActionButton.innerHTML, /pp-action-spinner/, "add to cart should restore its shopping icon after the request settles");

for (const language of ["English", "Spanish", "Chinese (Mandarin)"]) {
  const copy = createSiteCopy(language);
  for (const key of ["product.addToCart", "product.quantity", "product.cartTitle", "product.discount", "product.checkout", "product.discountThresholdSubtotal", "product.discountThresholdSubtotalPending", "product.discountThresholdQuantity", "product.discountCombinationUnavailable", "product.cartBindingRequired", "product.cartBundleRequired", "product.cartCheckoutFailed"]) {
    assert.ok(copy.t(key).trim(), `${language} must provide ${key}`);
  }
}

const templateSource = fs.readFileSync("src/features/chat/chat-product-panel-template.js", "utf8");
assert.doesNotMatch(templateSource, /productCartHtml/, "the product detail template must not nest the cart inside its own panel");
assert.match(templateSource, /data-product-panel-quantity/, "the shared product panel should expose quantity controls");

const panelSource = fs.readFileSync("src/features/chat/chat-product-panel.js", "utf8");
assert.match(panelSource, /addCurrentProductToCart/, "the product primary action should add the current configuration to cart");
assert.match(panelSource, /addCurrentProductToCartAfterTtmallBinding/, "the product primary action must check TTMall binding before adding a TTMall item");
assert.match(panelSource, /onBound: async \(\) => \{\s*addCurrentProductToCart/, "a successful TTMall binding must resume the same add-to-cart action without a page reload");
assert.match(panelSource, /onItemsChange:[\s\S]*syncTtmallProductCart/, "TTMall cart changes must synchronize from the shared cart state, not only at checkout");
assert.match(panelSource, /productPanelTtmallCartMode === "not_ttmall"/, "non-TTMall carts must retain their existing local checkout behavior after shared cart synchronization");
assert.doesNotMatch(panelSource, /const cart = await syncTtmallProductCart[\s\S]*checkoutTtmallProductCart/, "checkout must not replay an already synchronized TTMall cart write");
assert.match(panelSource, /requireAuthForCheckout/, "the shared cart checkout must retain the existing guest authentication boundary");
assert.doesNotMatch(panelSource, /handleProductPanelCheckout/, "the product primary action must not call the legacy direct checkout flow");
assert.match(panelSource, /setProductPanelAddPending\(root, true\)/, "add to cart should enter a shared pending state before binding or cart readiness work");
assert.match(panelSource, /finally \{\s*setProductPanelAddPending\(root, false\)/, "add to cart should release its pending state after success, cancellation, or failure");

const sanitizerSource = fs.readFileSync("server/product-response-sanitizer.js", "utf8");
assert.match(cartSource, /data-product-cart-payments/, "the cart should expose the shared payment method strip");
assert.match(cartSource, /data-product-cart-price-note/, "the cart should expose the shared final-price note");
assert.match(cartSource, /data-product-cart-discount/, "the cart should expose the discount savings row");
assert.match(cartSource, /data-product-cart-discount-notice/, "the cart should expose a dedicated threshold notice outside the product list");
assert.match(cartSource, /state\.discountEvaluation/, "the cart must retain only the latest server discount evaluation");
assert.match(sanitizerSource, /sanitizeDiscountCombination/, "the product DTO must expose the safe combination capability needed to prevent invalid local selections");
assert.match(cartSource, /threshold_not_met/, "threshold failures must have their own UI state");
assert.match(cartSource, /syncCartDiscountSelection/, "selecting or cancelling an offer must synchronize matching cart lines");
assert.match(cartSource, /export function syncCartDiscountSelection[\s\S]*?renderProductCart\(root, language\);\s*queueCartItemsSync\(root, language\);/, "changing a selected offer must re-sync the server-side Shopify cart session before checkout");
assert.match(cartSource, /selectedDiscountOfferIds/, "cart line identities must include multi-code selection state");
const chatStyles = fs.readFileSync("src/features/app-shell/styles/chat.css", "utf8");
assert.match(chatStyles, /product-cart-discount-notice[^}]+background: var\(--accent\)[^}]+color: var\(--on-accent\)[^}]+font-weight: 600/, "light theme threshold notice must use the checkout accent background and on-accent text");
assert.match(chatStyles, /data-theme="dark"\] \.product-cart-discount-notice \{ color: #111; \}/, "dark theme threshold notice must retain dark text on the accent background");
assert.match(cartSource, /renderPaymentMethods\(payments, paymentProducts/, "the cart should reuse the shared payment method renderer");
assert.match(cartSource, /items\.length[\s\S]*\? items\.map[\s\S]*: \[detailProduct\]/, "an empty cart should retain the current detail payment configuration");
assert.match(cartSource, /data-cart-state="closed"/, "cart should start in its own closed presentation state");
assert.match(cartSource, /queueCartItemsSync/, "cart additions and line changes must queue their shared TTMall synchronization callback");
assert.match(cartSource, /pendingItems/, "rapid cart mutations must retain the latest cart state while synchronization is in flight");
assert.match(cartSource, /cartState = "opening"/, "cart opening should use a deterministic pre-transition state");
assert.match(cartSource, /requestAnimationFrame/, "cart opening should advance to its visible state on the next render frame");
assert.doesNotMatch(cartSource, /classList\.(?:add|remove|contains)\("product-cart-open"\)/, "cart state must not be a global body class shared between page instances");
assert.match(cartSource, /state\.syncing \|\| state\.syncingItems/, "checkout should remain visibly pending while cart synchronization or checkout navigation is in flight");
assert.match(cartSource, /aria-busy/, "checkout should expose an accessible pending state");
assert.match(cartSource, /function setProductQuantity[\s\S]*?updateProductPanelPricePreview\(/, "changing detail quantity must immediately refresh the main and footer prices without modifying cart quantities");
assert.doesNotMatch(cartSource, /const orderOffer = rows[\s\S]*?resolveFixedDiscountAmountForPrice\(orderOffer/, "cart must not choose an order-level discount from the first selected offer before Shopify Calculate responds");

const rendererSource = fs.readFileSync("src/features/chat/chat-product-panel-renderer.js", "utf8");
assert.match(rendererSource, /export function setProductPanelAddPending/, "the detail primary action should reuse one pending-state renderer");
assert.match(rendererSource, /pp-action-spinner/, "the detail primary action should replace its shopping icon with a spinner while pending");

const cssSource = fs.readFileSync("src/features/app-shell/styles/chat.css", "utf8");
assert.match(cssSource, /\.product-cart-panel[\s\S]*translateX\(108%\)/, "desktop cart should enter from the side");
assert.match(cssSource, /@media \(max-width: 900px\)[\s\S]*\.product-cart-panel[\s\S]*translateY\(108%\)/, "mobile cart should enter from the bottom");
assert.match(cssSource, /\.product-cart-panel\[data-cart-state="open"\]/, "cart visibility should belong to the cart panel itself");
assert.match(cssSource, /\.pp-action-spinner[\s\S]*animation: ppActionSpin/, "shared product actions should use a visible rotating spinner");
assert.match(cssSource, /\.product-cart-discount-notice[\s\S]*border-radius: 12px 12px 0 0/, "threshold notice must have only top rounded corners");
assert.doesNotMatch(cssSource.match(/\.product-cart-discount-notice[^\n]*/)?.[0] || "", /position: (?:fixed|absolute)/, "threshold notice must stay in normal cart flow");

for (const [file, pattern] of [
  ["src/features/chat/chat-page.js", /productCartHtml/],
  ["src/features/search/search-page.js", /productCartHtml/],
  ["src/features/kitshop/kitshop-page.js", /productCartHtml/],
  ["src/features/call-modal/call-product-overlay.js", /productCartHtml/],
]) {
  assert.match(fs.readFileSync(file, "utf8"), pattern, `${file} should mount the shared cart as a sibling of the product detail`);
}

console.log("product cart frontend self-check passed");
