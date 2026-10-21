import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProductPanelPayload } from "../src/features/chat/chat-product-panel-payload.js";

const normalizerSource = readFileSync("server/product-normalizer.js", "utf8");
const textMessageSource = readFileSync("server/chat-text-message-service.js", "utf8");
const replyOrchestratorSource = readFileSync("server/chat-reply-orchestrator-service.js", "utf8");
const productReplySource = readFileSync("server/chat-product-reply-service.js", "utf8");
const voiceMessageSource = readFileSync("server/chat-voice-message-service.js", "utf8");
const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const productCardSource = readFileSync("src/features/chat/chat-product-card.js", "utf8");
const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const panelRendererSource = readFileSync("src/features/chat/chat-product-panel-renderer.js", "utf8");
const panelGallerySource = readFileSync("src/features/chat/chat-product-panel-gallery.js", "utf8");
const chatCss = readFileSync("src/features/app-shell/styles/chat.css", "utf8");

assert.match(normalizerSource, /imageUrls:/, "product normalizer should expose multiple product images");
assert.match(normalizerSource, /normalizeProductImageUrls/, "product normalizer should normalize image arrays");
assert.match(productReplySource, /imageUrls:/, "text reply product payload should preserve imageUrls");
assert.match(textMessageSource, /persistCharacterReplyForDb/, "text reply should delegate reply persistence through the reply orchestrator");
assert.match(replyOrchestratorSource, /insertProductReplyMessage/, "reply orchestrator should delegate product payload insertion through the product helper");
assert.match(voiceMessageSource, /persistCharacterReplyForDb/, "voice reply should use the same product-preserving reply orchestrator");
assert.deepEqual(
  normalizeProductPanelPayload({ imageUrls: ["https://cdn.example.com/one.jpg"] }).imageUrls,
  ["https://cdn.example.com/one.jpg"],
  "product card payload should pass imageUrls into the detail panel",
);
assert.match(panelRendererSource, /data-product-panel-prev/, "product panel should include previous image control");
assert.match(panelRendererSource, /data-product-panel-next/, "product panel should include next image control");
assert.match(panelRendererSource, /data-product-panel-count/, "product panel should show image position when multiple images exist");
assert.match(panelRendererSource, /setProductPanelImage/, "product panel should update the active image without rebuilding the panel");
assert.match(panelRendererSource, /data-product-panel-track/, "product panel should render a horizontal gallery track");
assert.match(panelRendererSource, /pp-gallery-slide/, "product panel should render one slide per product image");
assert.match(panelGallerySource, /bindProductGalleryDrag/, "product panel should support dragging the gallery image");
assert.match(panelGallerySource, /pointerdown/, "product gallery drag should use pointer events for mouse and touch");
assert.match(panelGallerySource, /pointermove/, "product gallery drag should move while the pointer is dragging");
assert.match(panelGallerySource, /setProductPanelTrackOffset\(root, \{ dragDeltaX \}\)/, "product gallery drag should translate the track before release");
assert.match(panelGallerySource, /finishProductGalleryDrag/, "product gallery drag should only turn into a page change after a threshold");
assert.match(chatCss, /\.pp-gallery-track\s*\{[^}]*display:\s*flex/, "product gallery track should lay slides out horizontally");
assert.match(chatCss, /\.pp-gallery-slide\s*\{[^}]*flex:\s*0 0 100%/, "product gallery slides should each occupy one hero width");
assert.match(chatCss, /\.pp-gallery-track\.is-dragging\s*\{[^}]*transition:\s*none/, "product gallery should follow the pointer without transition while dragging");

console.log("chat product panel gallery self-check passed");
