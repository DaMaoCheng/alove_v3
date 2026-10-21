import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const normalizerSource = readFileSync("server/product-normalizer.js", "utf8");
const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const panelRendererSource = readFileSync("src/features/chat/chat-product-panel-renderer.js", "utf8");
const panelHydrationSource = readFileSync("src/features/chat/chat-product-panel-hydration.js", "utf8");
const chatCss = readFileSync("src/features/app-shell/styles/chat.css", "utf8");

assert.match(
  normalizerSource,
  /variantId:\s*normalizeShopifyVariantId/,
  "Shopify product sizes should preserve a stable variantId for cart checkout"
);
assert.match(
  normalizerSource,
  /buyUrl:\s*buildShopifyVariantCartUrl/,
  "Shopify product sizes should expose a variant cart URL"
);
assert.match(
  panelRendererSource,
  /selectedSizeIndex/,
  "product panel renderer should persist the selected size state"
);
assert.match(
  panelRendererSource,
  /copy\.selectSize/,
  "product panel CTA should require choosing a size before variant checkout using localized copy"
);
assert.match(
  panelRendererSource,
  /dataset\.productUrl = purchaseState\.url/,
  "product panel CTA should update its target URL from the selected size purchase state"
);
assert.match(
  panelSource,
  /data-product-panel-size-index/,
  "product panel should listen for size selection clicks"
);
assert.match(
  chatCss,
  /\.pp-size:disabled,\.pp-size\.is-sold-out/,
  "out-of-stock size buttons should render as disabled in chat product details"
);
assert.match(
  panelRendererSource,
  /aria-disabled="true"/,
  "out-of-stock size buttons should expose aria-disabled state"
);
assert.match(
  panelRendererSource,
  /data-product-panel-sold-out="true"/,
  "out-of-stock size buttons should remain clickable for mobile sold-out hint without becoming selectable"
);
assert.match(
  panelSource,
  /showSoldOutSizeHint/,
  "product panel should show a sold-out hint when tapping an unavailable size"
);
assert.match(
  panelSource,
  /openProductPanel\(root, \{ \.\.\.product, analytics \}/,
  "product panel should open directly from the product card payload"
);
assert.match(
  panelHydrationSource,
  /product:\s*\{\s*\.\.\.product,\s*siteSlug:\s*currentSiteSlug\s*\}/,
  "product panel checkout hydration should resolve the open product so trusted variants and customization can be attached"
);
assert.match(panelHydrationSource, /sizes:\s*(?:checkoutState\.sizes|resolvedSizes\.length)/);
assert.doesNotMatch(
  panelHydrationSource,
  /\.\.\.currentProduct,\s*\.\.\.item/,
  "product panel should not overwrite the open product with checkout resolve results"
);
assert.match(
  panelSource,
  /root\.dataset\.productPanelLanguage = String\(language \|\| "English"\)/,
  "product panel should use the current page language instead of browser language for sold-out copy"
);
assert.match(
  panelRendererSource,
  /resolveProductPanelLanguage\(root, normalizedProduct, options\)/,
  "product panel renderer should resolve sold-out copy from panel page-language context"
);
assert.doesNotMatch(
  panelRendererSource,
  /navigator\.language|document\.documentElement\.lang/,
  "sold-out copy should not fall back to browser/page-shell language"
);
assert.match(
  readFileSync("src/app/app-view-factory.js", "utf8"),
  /pageLanguage: appState\.site\.pageLanguage \|\| "English"/,
  "chat and search product panels should receive page language from site state"
);
assert.match(
  readFileSync("src/app/site-routing.js", "utf8"),
  /resolveSitePageLanguage/,
  "site routing should expose a page language resolver for product UI copy"
);
assert.match(
  chatCss,
  /\.pp-soldout-hint \{ position: fixed; left: 50%; top: 50%;/,
  "mobile sold-out hint should be centered on screen"
);
assert.match(
  chatCss,
  /\.pp-soldout-hint[\s\S]*background: #e6e6e6; color: #202020;/,
  "mobile sold-out hint should use a light gray background"
);
assert.match(
  chatCss,
  /\.pp-size\.is-sold-out::after/,
  "desktop sold-out sizes should expose a hover tooltip"
);
assert.match(
  chatCss,
  /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.pp-size\.is-sold-out::after[\s\S]*content: none;/,
  "touch/mobile sold-out sizes should hide the near-size tooltip and keep only the centered hint"
);

console.log("chat product variant cart self-check passed");
