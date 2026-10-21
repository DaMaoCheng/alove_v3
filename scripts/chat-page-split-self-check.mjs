import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const files = {
  page: "src/features/chat/chat-page.js",
  quickReplies: "src/features/chat/chat-quick-replies.js",
  renderer: "src/features/chat/chat-message-renderer.js",
  productCard: "src/features/chat/chat-product-card.js",
  impressions: "src/features/chat/chat-product-impressions.js",
};

for (const path of Object.values(files)) {
  assert.ok(existsSync(path), `chat page split file should exist: ${path}`);
}

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);

assert.match(source.page, /export\s+function\s+createChatPage/, "chat page should keep createChatPage entry");
assert.match(source.page, /export\s+function\s+scrollChatToLatest/, "chat page should keep scrollChatToLatest export");
assert.match(source.page, /export\s+function\s+bindChatAutoScroll/, "chat page should keep bindChatAutoScroll export");
assert.match(source.page, /renderQuickReplies/, "chat page should import quick reply rendering");
assert.match(source.page, /renderChatMessagesHtml/, "chat page should delegate message rendering");
assert.match(source.page, /reportProductImpressions/, "chat page should delegate product impression reporting");
assert.match(source.page, /bindChatAttachmentPreview/, "chat page should delegate attachment image previews");
assert.doesNotMatch(source.page, /FALLBACK_DAILY_QUICK_REPLIES|FALLBACK_PRODUCT_QUICK_REPLIES|function\s+renderProductCard|function\s+productPanelPayload|function\s+parseProductPayload/, "chat page should not keep quick reply/product card/parser implementation details");

for (const name of ["FALLBACK_DAILY_QUICK_REPLIES", "FALLBACK_PRODUCT_QUICK_REPLIES", "QUICK_REPLY_EMOJIS"]) {
  assert.match(source.quickReplies, new RegExp(`export\\s+const\\s+${name}`), `quick replies module should export ${name}`);
}
for (const name of ["renderQuickReplies", "getFallbackQuickRepliesForCharacter", "buildFallbackQuickReplies", "canUseProductQuickReplies", "sampleQuickReplies", "shuffleQuickReplies", "createFallbackCharacter"]) {
  assert.match(source.quickReplies, new RegExp(`export\\s+function\\s+${name}`), `quick replies module should export ${name}`);
}

assert.match(source.renderer, /export\s+function\s+renderChatMessages/, "message renderer should export renderChatMessages");
assert.match(source.renderer, /renderProductCard/, "message renderer should delegate product cards");
assert.match(source.renderer, /renderAttachmentBubble/, "message renderer should handle attachment messages");
assert.match(source.renderer, /voiceButtonHtml/, "message renderer should keep voice button rendering");

for (const name of ["renderProductCard", "productPanelPayload", "productAnalyticsPayload", "normalizeProductImageUrls"]) {
  assert.match(source.productCard, new RegExp(`export\\s+function\\s+${name}`), `product card module should export ${name}`);
}
assert.match(source.productCard, /data-product=/, "product card should embed panel payload");
assert.match(source.productCard, /data-product-analytics=/, "product card should embed analytics payload");

assert.match(source.impressions, /export\s+function\s+reportProductImpressions/, "impression module should export reportProductImpressions");
assert.match(source.impressions, /export\s+function\s+parseProductPayload/, "impression module should export parseProductPayload");
assert.match(source.impressions, /recordProductAnalyticsEvent/, "impression module should record product analytics events");

console.log("chat page split self-check passed");
