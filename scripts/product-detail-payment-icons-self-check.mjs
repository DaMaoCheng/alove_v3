import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PAYMENT_METHOD_OPTIONS, normalizePaymentMethods } from "../shared/payment-methods.js";
import { normalizeProductPanelPayload } from "../src/features/chat/chat-product-panel-payload.js";

const files = {
  siteService: await read("server/product-search-site-service.js"),
  recommendationService: await read("server/chat-product-recommendation-service.js"),
  replyService: await read("server/chat-product-reply-service.js"),
  checkoutService: await read("server/product-checkout-resolver-service.js"),
  card: await read("src/features/chat/chat-product-card.js"),
  kitshop: await read("src/features/kitshop/kitshop-page.js"),
  chatPage: await read("src/features/chat/chat-page.js"),
  searchPage: await read("src/features/search/search-page.js"),
  callProductOverlay: await read("src/features/call-modal/call-product-overlay.js"),
  appViewFactory: await read("src/app/app-view-factory.js"),
  appCallActions: await read("src/app/app-call-actions.js"),
  callDomRenderer: await read("src/features/call-modal/call-dom-renderer.js"),
  template: await read("src/features/chat/chat-product-panel-template.js"),
  renderer: await read("src/features/chat/chat-product-panel-renderer.js"),
  panel: await read("src/features/chat/chat-product-panel.js"),
  hydration: await read("src/features/chat/chat-product-panel-hydration.js"),
  chatCss: await read("src/features/app-shell/styles/chat.css"),
};

assert.equal(PAYMENT_METHOD_OPTIONS.length, 11, "payment method option count should stay explicit");
assert.deepEqual(
  normalizePaymentMethods(["shop_pay", "bad", "visa", "shop_pay"]),
  ["shop_pay", "visa"],
  "payment method normalization should filter invalid keys and keep order"
);
assert.deepEqual(
  normalizePaymentMethods(Buffer.from(JSON.stringify(["shop_pay", "visa"]))),
  ["shop_pay", "visa"],
  "payment method normalization should support database JSON buffers"
);

assert.match(files.siteService, /payment_methods_json/, "public site query should select payment_methods_json");
assert.match(files.siteService, /paymentMethods:\s*normalizePaymentMethods/, "public site mapper should expose normalized paymentMethods");

assert.match(files.recommendationService, /payment_methods_json/, "chat recommendation site query should include payment_methods_json");
assert.match(files.recommendationService, /attachPaymentMethods/, "chat recommendations should attach site payment methods to products");
assert.match(files.replyService, /paymentMethods:\s*Array\.isArray\(product\.paymentMethods\)/, "chat product reply payload should persist paymentMethods");

assert.match(files.checkoutService, /attachSitePaymentMethods/, "checkout resolver should preserve site payment methods during live refresh");
assert.deepEqual(
  normalizeProductPanelPayload({ paymentMethods: ["visa"] }).paymentMethods,
  ["visa"],
  "chat product card payload should include paymentMethods",
);
assert.deepEqual(
  normalizeProductPanelPayload({}, { site: { paymentMethods: ["shop_pay"] } }).paymentMethods,
  ["shop_pay"],
  "kitshop product payload should fall back to site paymentMethods",
);
assert.match(files.kitshop, /bindProductPanel\(page,[\s\S]*siteSlug/s, "kitshop product panel should receive the current siteSlug");
assert.match(files.chatPage, /createChatPage\(\{[\s\S]*siteSlug\s*=\s*""/s, "chat page should accept current siteSlug");
assert.match(files.chatPage, /bindProductPanel\(wrap,[\s\S]*siteSlug/s, "chat product panel should receive current siteSlug");
assert.match(files.searchPage, /bindProductPanel\(page,[\s\S]*siteSlug/s, "search product panel should receive current siteSlug");
assert.match(files.callProductOverlay, /createCallProductOverlay\(\{[\s\S]*siteSlug\s*=\s*""/s, "call product overlay should accept current siteSlug");
assert.match(files.callProductOverlay, /bindProductPanel\(overlay,[\s\S]*siteSlug/s, "call product panel should receive current siteSlug");
assert.match(files.appViewFactory, /createChatPage\(\{[\s\S]*siteSlug:\s*appState\.site\.currentSlug/s, "app view factory should pass current siteSlug to chat");
assert.match(files.appViewFactory, /createCallProductOverlay\(\{[\s\S]*siteSlug:\s*appState\.site\.currentSlug/s, "app view factory should pass current siteSlug to call product overlay");
assert.match(files.appCallActions, /createCallDomRenderer\(\{[\s\S]*appState/s, "call actions should delegate product overlay rendering with current app state");
assert.match(files.callDomRenderer, /createCallProductOverlay\(\{[\s\S]*siteSlug:\s*appState\.site\.currentSlug/s, "call DOM renderer should pass current siteSlug to call product overlay");

assert.match(files.template, /data-product-panel-payments/, "product panel template should include payment method rail");
assert.match(files.renderer, /PAYMENT_METHOD_OPTIONS/, "product panel renderer should use shared payment method definitions");
assert.match(files.renderer, /renderPaymentMethods\(payments,\s*normalizedProduct\.commerceEnabled\s*===\s*false\s*\?\s*\[\]\s*:\s*normalizedProduct\.paymentMethods\)/, "product panel renderer should render normalized payment methods");
assert.match(files.renderer, /target\.hidden\s*=\s*!methods\.length/, "payment rail should be hidden when site has no methods");
assert.match(files.renderer, /queuePaymentRailLayout\(target\)/, "payment rail should measure overflow after render");
assert.match(files.renderer, /classList\.toggle\("is-overflowing",\s*overflowing\)/, "payment rail should mark overflowing rows");
assert.match(files.renderer, /<img src="\$\{escapeHtml\(option\.icon\)\}"/, "payment rail should render local icon images");

assert.match(files.hydration, /resolveProductCheckoutProduct/, "product panel should hydrate legacy site payment settings through the existing resolve endpoint");
assert.match(files.panel, /prepareProductForCurrentSite/, "product panel should prefer current path site payment settings");
assert.match(files.panel, /hydrateProductPanelCheckout/, "product panel should hydrate missing payment and checkout metadata");
assert.match(files.hydration, /product:\s*\{\s*\.\.\.product,\s*siteSlug:\s*currentSiteSlug\s*\}/, "product panel hydration should resolve using the open product payload for live customization");
assert.match(files.hydration, /paymentMethods,/, "product panel checkout hydration should patch payment icons without spreading the resolved item");
assert.doesNotMatch(files.hydration, /\.\.\.currentProduct,\s*\.\.\.item/, "product panel payment hydration should not overwrite product details with resolve results");
assert.match(files.hydration, /checkoutResolutionStatus:\s*"failed"/, "checkout hydration failures should expose a retry state");
assert.match(files.panel, /bindPaymentMethodRailDrag\(root\)/, "product panel should bind payment icon drag");
assert.match(files.panel, /scrollWidth\s*<=\s*rail\.clientWidth/, "payment drag should only start when the rail overflows");
assert.match(files.panel, /Math\.abs\(deltaX\)\s*<\s*4/, "payment drag should distinguish click from drag");

assert.match(files.chatCss, /\.pp-payment-strip\s*\{[^}]*overflow-x:\s*auto/s, "payment rail should scroll horizontally");
assert.match(files.chatCss, /\.pp-payment-strip\s*\{[^}]*white-space:\s*nowrap/s, "payment rail should keep icons in one row");
assert.match(files.chatCss, /\.pp-payment-strip\s*\{[^}]*justify-content:\s*center/s, "payment rail should center icons by default");
assert.match(files.chatCss, /\.pp-payment-strip\.is-overflowing\s*\{[^}]*justify-content:\s*flex-start/s, "overflowing payment rail should align left");
assert.match(files.chatCss, /\.pp-payment-strip\.is-overflowing\s*\{[^}]*cursor:\s*grab/s, "overflowing payment rail should expose drag cursor");
assert.match(files.chatCss, /\.pp-payment-method img\s*\{[^}]*height:\s*24px/s, "payment icons should use a fixed height");
assert.match(files.chatCss, /\.pp-payment-method img\s*\{[^}]*width:\s*auto/s, "payment icons should keep their original aspect ratio");

console.log("product detail payment icons self-check passed");

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}
