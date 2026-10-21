import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProductPanelPayload } from "../src/features/chat/chat-product-panel-payload.js";
import { buildDynamicProductPatch } from "../src/features/chat/chat-product-card-live-refresh.js";
import { hasFreshProductSnapshot } from "../src/features/chat/chat-product-refresh-policy.js";
import { shouldHydrateProductCheckout } from "../src/features/chat/chat-product-panel-hydration.js";

const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const productCardSource = readFileSync("src/features/chat/chat-product-card.js", "utf8");
const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const panelRendererSource = readFileSync("src/features/chat/chat-product-panel-renderer.js", "utf8");
const siteBrandingSource = readFileSync("src/features/shared-ui/site-branding.js", "utf8");
const panelTemplateSource = readFileSync("src/features/chat/chat-product-panel-template.js", "utf8");
const panelStylesSource = readFileSync("src/features/app-shell/styles/chat.css", "utf8");
const siteCopySource = readFileSync("src/i18n/site-copy.js", "utf8");

assert.match(
  productCardSource,
  /data-product=/,
  "product cards should embed the clicked product payload for the detail panel"
);
const normalizedPayload = normalizeProductPanelPayload({
  sizes: [{ label: "M", available: true }],
  features: ["Available now"],
  siteLogoUrl: "https://example.com/logo.svg",
  purchaseMode: "product_detail",
});
assert.deepEqual(
  normalizedPayload.sizes,
  [{ label: "M", available: true }],
  "product cards should preserve product sizes for the detail panel"
);
assert.deepEqual(
  normalizedPayload.features,
  ["Available now"],
  "product cards should preserve product features for the detail panel"
);
assert.equal(
  normalizedPayload.siteLogoUrl,
  "https://example.com/logo.svg",
  "product cards should preserve site logo fields for the product detail panel",
);
assert.equal(
  normalizedPayload.purchaseMode,
  "product_detail",
  "the shared panel payload should preserve product-detail purchase mode",
);
assert.equal(
  shouldHydrateProductCheckout({
    id: "101",
    siteSlug: "example",
    url: "https://shop.example/productdetail/item/101",
    purchaseMode: "product_detail",
    paymentMethods: ["visa"],
    sizeChartResolved: false,
  }, "example"),
  true,
  "Search and Kitshop product-detail payloads with unresolved size data should call the shared resolve endpoint when opened",
);
assert.equal(
  shouldHydrateProductCheckout({
    id: "101",
    siteSlug: "example",
    url: "https://shop.example/productdetail/item/101",
    purchaseMode: "product_detail",
    paymentMethods: ["visa"],
    sizeChartResolved: true,
  }, "example"),
  false,
  "a resolved product-detail payload should not repeat the resolve request",
);
const sizeChart = {
  title: "Size Chart",
  columns: ["Size", "Chest"],
  rows: [["M", "104–108"]],
};
const snapshotTimestamp = new Date().toISOString();
assert.deepEqual(
  buildDynamicProductPatch({}, { sizeChart }).sizeChart,
  sizeChart,
  "the shared product refresh should carry the resolved size chart with live price data",
);
assert.equal(
  hasFreshProductSnapshot({ livePriceFetchedAt: snapshotTimestamp }),
  true,
  "a live price snapshot should stay fresh because size charts are local and do not expire",
);
assert.equal(
  hasFreshProductSnapshot({
    livePriceFetchedAt: snapshotTimestamp,
  }),
  true,
  "price freshness should not depend on a remote size chart timestamp",
);
assert.match(
  panelRendererSource,
  /updateProductPanel/,
  "product panel should update its content from the clicked product"
);
assert.match(
  panelRendererSource,
  /data-product-panel-sizes/,
  "product panel should render dynamic sizes"
);
assert.match(
  panelRendererSource,
  /data-product-panel-size-index=/,
  "product panel should render selectable size buttons with indexes"
);
assert.match(
  panelRendererSource,
  /copy\.selectSize/,
  "product panel CTA should require selecting a size before variant cart checkout using localized copy"
);
assert.match(
  panelRendererSource,
  /copy\.soldOut/,
  "product panel CTA should expose a localized sold out state when no purchasable variants remain"
);
assert.match(
  panelRendererSource,
  /product\.purchaseMode === "product_detail"/,
  "sources without variant checkout should use their trusted public product URL",
);
assert.match(
  panelRendererSource,
  /data-product-panel-features/,
  "product panel should render dynamic features"
);
assert.match(
  panelRendererSource,
  /resolveProductBenefitRows/,
  "product panel should resolve benefit rows from product features and safe product metadata"
);
assert.match(
  panelRendererSource,
  /extractBenefitsFromText/,
  "product panel should only derive extra benefit rows from explicit product summary text"
);
assert.match(
  siteCopySource,
  /"product\.priceNote": "Final price is shown at checkout\."/,
  "product panel should explain that checkout controls the final price"
);
assert.match(
  siteCopySource,
  /"product\.priceNote": "实际价格以付款页面为准。"/,
  "Chinese product panel copy should explain that checkout controls the final price"
);
assert.match(
  panelSource,
  /product_detail_page_click/,
  "product detail page link should have its own analytics event"
);
assert.match(
  panelTemplateSource,
  /data-product-panel-detail-link/,
  "product panel should render an independent store detail link"
);
assert.match(
  panelTemplateSource,
  /data-product-panel-detail-logo/,
  "product detail link should have an image slot for the store logo"
);
assert.match(
  panelTemplateSource,
  /data-product-panel-detail-logo-fallback/,
  "product detail link should keep the globe fallback when logo loading fails"
);
assert.match(
  panelRendererSource,
  /getSiteBranding\(siteSlug\)/,
  "product panel should refresh the current site branding by slug"
);
assert.match(
  siteBrandingSource,
  /google\.com\/s2\/favicons/,
  "shared branding should derive a favicon when no explicit logo is provided"
);
assert.match(
  panelTemplateSource,
  /data-product-panel-price-note/,
  "product panel should render a checkout price note below the CTA area"
);
assert.match(
  panelStylesSource,
  /\.pp-detail-link/,
  "store detail link should have dedicated styling"
);
assert.match(
  panelStylesSource,
  /\.pp-price-note/,
  "checkout price note should have dedicated styling"
);
assert.doesNotMatch(
  panelRendererSource,
  /Legends Matchday Kit 25\/26/,
  "product panel should not keep the hardcoded sample product as its main content"
);

console.log("chat product panel dynamic self-check passed");
