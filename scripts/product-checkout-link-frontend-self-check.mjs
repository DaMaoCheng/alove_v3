import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile("src/features/chat/chat-product-panel.js", "utf8");
const checkout = await readFile("src/features/chat/chat-product-panel-checkout.js", "utf8");
const hydration = await readFile("src/features/chat/chat-product-panel-hydration.js", "utf8");
const service = await readFile("src/services/product-checkout-service.js", "utf8");
const httpClient = await readFile("src/services/http-client.js", "utf8");
const api = await readFile("src/config/api-config.js", "utf8");

assert.match(service, /API_ENDPOINTS\.products\.checkoutLink/, "frontend checkout service should use the dedicated endpoint");
assert.match(api, /checkoutLink:\s*\"\/api\/products\/checkout-link\"/, "checkout endpoint should be centralized");
assert.match(checkout, /createProductCheckoutLink/, "product panel should request a server-generated discount link");
assert.match(checkout, /selectedDiscountOfferId/, "product panel should send the selected offer");
assert.match(checkout, /selectedSizeIndex:\s*product\.selectedSizeIndex/, "product panel should preserve the selected variant");
assert.doesNotMatch(checkout, /window\.open\("about:blank",\s*"_blank",\s*"noopener,noreferrer"\)/, "checkout must not create an inaccessible blank tab");
assert.match(checkout, /if \(!selectedOfferId \|\| !characterId \|\| !messageId\) \{\s*window\.open\(url, "_blank", "noopener,noreferrer"\);/s, "standard checkout should open its real URL directly");
assert.match(checkout, /popup\.opener\s*=\s*null/, "async discount checkout should detach the placeholder tab from the opener");
assert.match(checkout, /window\.location\.assign\(url\)/, "blocked discount popups should fall back to same-tab navigation");
assert.match(checkout, /navigateProductCheckout\(url, popup\)/, "checkout failures should fall back to the standard purchase URL");
assert.match(checkout, /root\.dataset\.productCheckoutPending === "true"/, "repeated checkout clicks should share one in-flight attempt");
assert.match(checkout, /const controller = new AbortController\(\)/, "discount checkout should own a cancellable request");
assert.match(checkout, /CHECKOUT_LINK_TIMEOUT_MS = 12000/, "discount checkout should have a deterministic timeout");
assert.match(checkout, /CHECKOUT_REPEAT_GUARD_MS = 800/, "all checkout paths should reject immediate duplicate clicks");
assert.match(checkout, /delete root\.dataset\.productCheckoutPending/, "checkout pending state should always be released");
assert.match(checkout, /export function cancelProductPanelCheckout/, "product switching and closing should cancel an in-flight checkout");
assert.match(checkout, /isCurrentProductCheckoutAttempt/, "checkout responses should be rejected when the visible product context has changed");
assert.match(panel, /cancelProductPanelCheckout\(root\)/, "product panel lifecycle should cancel stale checkout attempts");
assert.match(
  panel,
  /if \(useOfferButton && root\.contains\(useOfferButton\)\) \{[\s\S]*?cancelProductPanelCheckout\(root\);[\s\S]*?(updateSelectedDiscountOffer|updateProductPanelDiscountSelections)/,
  "changing a discount should cancel the pending checkout before changing context",
);
assert.match(
  panel,
  /if \(sizeButton && root\.contains\(sizeButton\)\) \{\s*cancelProductPanelCheckout\(root\);\s*const nextProduct = updateSelectedProductSize/s,
  "changing a size should cancel the pending checkout before changing context",
);
assert.match(service, /signal,/, "checkout service should pass the cancellation signal");
assert.match(httpClient, /signal,/, "shared HTTP client should pass caller cancellation to fetch");
assert.match(hydration, /product:\s*\{\s*\.\.\.product,\s*siteSlug:\s*currentSiteSlug\s*\}/s);
assert.match(hydration, /needsVariantCheckout/);
assert.match(hydration, /sizes\.length === 0 \|\| sizes\.some/);
assert.match(hydration, /checkoutResolutionStatus:\s*"loading"/);
assert.match(hydration, /const shouldHydrate = shouldHydrateProductCheckout\(product, currentSiteSlug, guestMode\)/);
assert.match(hydration, /checkoutResolutionStatus:\s*"failed"/);
assert.doesNotMatch(hydration, /hydrateProductPanelDiscountOffers/);
assert.match(hydration, /hydrationKey\s*=\s*`\$\{productHydrationKey\}:\$\{characterId\}:\$\{messageId\}`/);
assert.match(hydration, /const hasDiscountContext = Boolean\(requestedCharacterId && requestedMessageId\)/);
assert.match(hydration, /(retainAvailableDiscountOffer\(currentProduct\.selectedDiscountOfferId, resolvedOffers\)|retainAvailableDiscountOfferIds\()/);

const renderer = await readFile("src/features/chat/chat-product-panel-renderer.js", "utf8");
assert.doesNotMatch(renderer, /fallbackUrl\s*=\s*String\(product\.url/);

const popupState = { closed: false, replacedUrl: "" };
const popup = {
  get closed() { return popupState.closed; },
  close() { popupState.closed = true; },
  location: {
    replace(url) { popupState.replacedUrl = url; },
  },
  opener: {},
};
globalThis.window = {
  AIOVE_API_BASE_URL: "",
  localStorage: { getItem: () => "" },
  open: () => popup,
  setTimeout,
  clearTimeout,
  location: { assign: () => assert.fail("cancelled checkout must not navigate the current page") },
  dispatchEvent: () => {},
};
globalThis.fetch = (_url, { signal } = {}) => new Promise((_resolve, reject) => {
  signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
});

const { cancelProductPanelCheckout, handleProductPanelCheckout } = await import("../src/features/chat/chat-product-panel-checkout.js");
const buttonState = { busy: false };
const button = {
  dataset: { productUrl: "https://example.test/products/current" },
  setAttribute(name) { if (name === "aria-busy") buttonState.busy = true; },
  removeAttribute(name) { if (name === "aria-busy") buttonState.busy = false; },
};
const root = {
  dataset: {
    productPanelSiteSlug: "footballkituk",
    productPanelProduct: JSON.stringify({
      productId: "product-current",
      characterId: "character-current",
      messageId: "message-current",
      selectedDiscountOfferId: "offer-current",
      selectedSizeIndex: 1,
    }),
    productPanelAnalytics: "{}",
  },
  querySelector(selector) {
    return selector === "[data-product-panel-buy]" ? button : null;
  },
};
const checkoutPromise = handleProductPanelCheckout(root, {
  recordAnalytics: false,
  recordDetailEvents: true,
});
await Promise.resolve();
assert.equal(root.dataset.productCheckoutPending, "true", "checkout should enter pending state");
assert.equal(buttonState.busy, true, "checkout button should expose pending state");
cancelProductPanelCheckout(root);
await checkoutPromise;
assert.equal(root.dataset.productCheckoutPending, undefined, "cancellation should clear pending state");
assert.equal(buttonState.busy, false, "cancellation should release the checkout button");
assert.equal(popupState.closed, true, "cancellation should close the placeholder window");
assert.equal(popupState.replacedUrl, "", "cancelled checkout must not navigate to a stale product");

var stalePopupState = { closed: false, replacedUrl: "" };
var stalePopup = {
  get closed() { return stalePopupState.closed; },
  close() { stalePopupState.closed = true; },
  location: { replace(url) { stalePopupState.replacedUrl = url; } },
  opener: {},
};
window.open = () => stalePopup;
var resolveStaleFetch;
globalThis.fetch = () => new Promise((resolve) => {
  resolveStaleFetch = resolve;
});
var staleButton = {
  dataset: { productUrl: "https://example.test/products/old" },
  setAttribute() {},
  removeAttribute() {},
};
var staleRoot = {
  dataset: {
    productPanelSiteSlug: "footballkituk",
    productPanelProduct: JSON.stringify({
      productId: "product-old",
      characterId: "character-current",
      messageId: "message-current",
      selectedDiscountOfferId: "offer-current",
      selectedSizeIndex: 0,
    }),
    productPanelAnalytics: "{}",
  },
  querySelector: (selector) => selector === "[data-product-panel-buy]" ? staleButton : null,
};
var staleCheckoutPromise = handleProductPanelCheckout(staleRoot, {
  recordAnalytics: false,
  recordDetailEvents: true,
});
await Promise.resolve();
staleRoot.dataset.productPanelProduct = JSON.stringify({
  productId: "product-old",
  characterId: "character-current",
  messageId: "message-current",
  selectedDiscountOfferId: "offer-current",
  selectedSizeIndex: 1,
});
resolveStaleFetch({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ ok: true, url: "https://example.test/checkout/old" }),
});
await staleCheckoutPromise;
assert.equal(stalePopupState.closed, true, "a response for a changed size or offer should close its stale placeholder");
assert.equal(stalePopupState.replacedUrl, "", "a changed checkout context must never navigate the placeholder");

var directOpenCount = 0;
window.open = () => {
  directOpenCount += 1;
  return null;
};
var directButton = { dataset: { productUrl: "https://example.test/products/direct" } };
var directRoot = {
  dataset: {
    productPanelProduct: JSON.stringify({ productId: "product-direct" }),
    productPanelAnalytics: "{}",
  },
  querySelector: (selector) => selector === "[data-product-panel-buy]" ? directButton : null,
};
await handleProductPanelCheckout(directRoot, { recordAnalytics: false, recordDetailEvents: true });
await handleProductPanelCheckout(directRoot, { recordAnalytics: false, recordDetailEvents: true });
assert.equal(directOpenCount, 1, "immediate duplicate clicks should open only one direct checkout page");

console.log("product checkout link frontend self-check passed");
