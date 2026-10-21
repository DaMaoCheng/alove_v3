import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  extractCallProductsFromPayload,
  hasCallProducts,
  mergeCallProducts,
  normalizeCallProductIndex,
  resolveLatestCallProduct,
} from "../src/features/call-modal/call-product-state.js";

const files = {
  state: "src/app/app-state.js",
  actions: "src/app/app-call-actions.js",
  renderer: "src/features/call-modal/call-dom-renderer.js",
  viewFactory: "src/app/app-view-factory.js",
  modal: "src/features/call-modal/call-modal.js",
  overlay: "src/features/call-modal/call-product-overlay.js",
  panel: "src/features/chat/chat-product-panel.js",
  styles: "src/features/app-shell/styles/call-modal.css",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, readFileSync(file, "utf8")]),
);

assert.match(source.state, /products:\s*\[\]/, "call state must keep triggered products");
assert.match(source.state, /productOverlayOpen:\s*false/, "call state must track product overlay visibility");
assert.match(source.state, /hasHiddenProducts:\s*false/, "call state must track hidden product badge");

assert.match(source.actions, /extractCallProductsFromPayload/, "call actions must extract products from call replies");
assert.match(source.actions, /mergeCallProductMessages/, "call actions must merge product messages from call replies");
assert.match(source.actions, /closeCallProductOverlay/, "call actions must expose overlay close handler");
assert.match(source.actions, /setCallProductIndex/, "call actions must expose product carousel handler");
assert.match(source.renderer, /createCallProductOverlay/, "call DOM renderer must own product overlay rendering");

assert.match(source.viewFactory, /createCallProductOverlay/, "view factory must render call product overlay");
assert.match(source.viewFactory, /hasCallProducts:/, "call modal must receive product availability state");
assert.match(source.viewFactory, /hasHiddenProducts:/, "call modal must receive hidden badge state");

assert.match(source.modal, /call-shop-alert/, "call modal must render Shop badge");
assert.match(source.modal, /hasCallProducts/, "call modal must know if call products exist");

assert.match(source.overlay, /productPanelHtml\(\{\s*pageLanguage\s*\}\)/, "call overlay must reuse localized product panel markup");
assert.match(source.overlay, /bindProductPanel/, "call overlay must reuse product panel binder");
assert.match(source.overlay, /CALL_PRODUCT_OPEN_CLASS/, "call overlay must use an isolated body class");

assert.match(source.panel, /openClass = "product-open"/, "product panel binder must keep default chat open class");
assert.match(source.panel, /classList\.add\(openClass\)/, "product panel must add configurable open class");
assert.match(source.panel, /classList\.remove\(openClass\)/, "product panel must remove configurable open class");

assert.match(source.styles, /\.call-product-panel/, "call product overlay styles must exist");
assert.match(source.styles, /\.call-shop-alert/, "Shop badge styles must exist");

const payload = {
  items: [
    { id: "m1", contentType: "text", text: "not a product" },
    {
      id: "m2",
      contentType: "product",
      characterId: "mascot_1",
      product: {
        productId: "shopify-101",
        name: "Barcelona Third Away Football Shirt",
        siteSlug: "footballkituk",
        price: "$46.99",
      },
    },
  ],
};

const extracted = extractCallProductsFromPayload(payload);
assert.equal(extracted.length, 1, "only product messages should be extracted");
assert.equal(extracted[0].name, "Barcelona Third Away Football Shirt");
assert.equal(extracted[0].messageId, "m2");
assert.equal(extracted[0].characterId, "mascot_1");

const merged = mergeCallProducts(
  [{ productId: "shopify-100", name: "AC Milan Home Shirt", siteSlug: "footballkituk" }],
  [
    { productId: "shopify-101", name: "Barcelona Third Away Football Shirt", siteSlug: "footballkituk" },
    { productId: "shopify-100", name: "AC Milan Home Shirt", siteSlug: "footballkituk" },
  ],
);
assert.equal(merged.length, 2, "duplicate products should be deduped");
assert.equal(merged[0].productId, "shopify-101", "newest product should appear first");
assert.equal(normalizeCallProductIndex(99, merged), 1, "index should clamp to product range");
assert.equal(hasCallProducts({ products: merged }), true, "call state should report product availability");
assert.equal(resolveLatestCallProduct({ products: merged })?.productId, "shopify-101", "latest product should resolve first");

console.log("call product overlay self-check passed");
