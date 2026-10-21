import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProductPanelPayload } from "../src/features/chat/chat-product-panel-payload.js";

const refreshSource = readFileSync("src/features/chat/chat-product-card-live-refresh.js", "utf8");
const refreshPolicySource = readFileSync("src/features/chat/chat-product-refresh-policy.js", "utf8");
const pageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const panelHydrationSource = readFileSync("src/features/chat/chat-product-panel-hydration.js", "utf8");
const productReplySource = readFileSync("server/chat-product-reply-service.js", "utf8");
const chatCss = readFileSync("src/features/app-shell/styles/chat.css", "utf8");

assert.match(
  pageSource,
  /import \{ bindProductCardLiveRefresh \} from "\.\/chat-product-card-live-refresh\.js";/,
  "chat page should import product card live refresh binding"
);
assert.match(
  pageSource,
  /reportProductImpressions\(wrap\);[\s\S]*bindProductCardLiveRefresh\(wrap, \{ pageLanguage \}\);/,
  "chat page should bind product card live refresh after product cards render"
);
assert.match(
  refreshSource,
  /new IntersectionObserver/,
  "product card live refresh should wait until a product card enters the viewport"
);
assert.match(
  refreshSource,
  /window\.requestAnimationFrame\(\(\) => \{[\s\S]*isElementVisibleInChat/,
  "product card live refresh should also scan cards already visible after render"
);
assert.match(
  refreshSource,
  /root:\s*root\.querySelector\("#chatBody"\) \|\| null/,
  "product card live refresh should observe visibility inside the chat scroll body"
);
assert.match(
  refreshPolicySource,
  /4 \* 60 \* 60 \* 1000/,
  "product card live refresh cache TTL should be four hours"
);
assert.match(
  refreshSource,
  /productCardRefreshRequests/,
  "product card live refresh should dedupe in-flight refreshes for identical products"
);
assert.match(
  refreshSource,
  /window\.localStorage\?\.setItem\(PRODUCT_CARD_REFRESH_CACHE_KEY/,
  "product card live refresh should cache refreshed products locally"
);
assert.match(
  productReplySource,
  /livePriceFetchedAt = new Date\(\)\.toISOString\(\)/,
  "AI product reply messages should mark freshly fetched product prices"
);
assert.equal(
  normalizeProductPanelPayload({ livePriceFetchedAt: "2026-07-23T00:00:00.000Z" }).livePriceFetchedAt,
  "2026-07-23T00:00:00.000Z",
  "product card payload should preserve fresh product price markers"
);
assert.match(
  refreshSource,
  /hasFreshProductSnapshot\(product\)/,
  "product card live refresh should skip resolve when the live price snapshot is fresh"
);
assert.doesNotMatch(
  refreshSource,
  /productSentAt|dataset\.productSentAt|sentAt/,
  "product card live refresh should not use message sent time as product freshness"
);
assert.match(
  refreshSource,
  /resolveProductCheckoutProduct/,
  "product card live refresh should reuse the existing product resolve API"
);
assert.match(
  refreshSource,
  /setProductCardPriceLoading/,
  "product card live refresh should show a loading state while resolving price"
);
assert.match(
  refreshSource,
  /card\.dataset\.product = JSON\.stringify\(mergedProduct\)/,
  "product card live refresh should update the card product payload used by product details"
);
assert.match(
  refreshSource,
  /buildDynamicProductPatch/,
  "product card live refresh should keep resolved updates scoped to dynamic fields"
);
assert.doesNotMatch(
  refreshSource,
  /\.\.\.currentProduct,\s*\.\.\.nextProduct/,
  "product card live refresh should not overwrite the historical product snapshot with resolved product data"
);
assert.match(
  refreshSource,
  /aiove:product-card-live-refresh/,
  "product card live refresh should emit a local event after refreshing a card"
);
assert.match(
  panelSource,
  /root\.addEventListener\("aiove:product-card-live-refresh"/,
  "product panel should listen for product card refresh events"
);
assert.match(
  panelSource,
  /isSameProductPayload\(currentProduct, refreshedProduct\)/,
  "product panel should only sync refreshes for the same open product"
);
assert.match(
  panelHydrationSource,
  /selectedSizeIndex: currentProduct\.selectedSizeIndex/,
  "product panel sync should preserve the user's selected size"
);
assert.match(
  panelHydrationSource,
  /isResolvingPrice: false/,
  "product panel sync should clear its price loading state after a card refresh"
);
assert.equal(
  normalizeProductPanelPayload({ id: "product-1" }).productId,
  "product-1",
  "product card panel payload should include stable product id for refresh caching"
);
assert.match(
  chatCss,
  /\.pc-price-loading[\s\S]*animation: chatImageSpin/,
  "product card live price loading state should render as a spinner"
);

console.log("chat product card live refresh self-check passed");
