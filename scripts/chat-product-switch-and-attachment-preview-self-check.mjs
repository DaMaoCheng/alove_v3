import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const pageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const attachmentSource = readFileSync("src/features/chat/chat-attachments.js", "utf8");
const previewSource = readFileSync("src/features/chat/chat-attachment-preview.js", "utf8");
const chatCss = readFileSync("src/features/app-shell/styles/chat.css", "utf8");

assert.doesNotMatch(
  panelSource,
  /if\s*\(\s*!restart\s*\)[\s\S]*document\.body\.classList\.remove\(openClass\)/,
  "switching between products should not remove product-open before opening the next product"
);
assert.match(
  panelSource,
  /function openProductPanel[\s\S]*applyProduct\(\);[\s\S]*function closeProductPanel/,
  "product switch should update panel content while keeping the open layout stable"
);
assert.match(
  panelSource,
  /restart && wasOpen[\s\S]*animateProductPanelSwitch/,
  "switching products while the panel is open should animate inside the existing panel"
);
assert.match(
  panelSource,
  /function animateProductPanelSwitch[\s\S]*is-product-switching-out[\s\S]*is-product-switching-in/,
  "product switch animation should use internal panel states instead of closing the outer panel"
);
assert.match(
  attachmentSource,
  /data-chat-attachment-preview/,
  "image attachments should render a local preview trigger"
);
assert.doesNotMatch(
  attachmentSource,
  /class="attachment-card attachment-image" href=/,
  "image attachments should not open a new browser page directly"
);
assert.match(
  pageSource,
  /bindChatAttachmentPreview\(wrap,\s*\{\s*pageLanguage\s*\}\)/,
  "chat page should bind image attachment preview behavior"
);
assert.match(
  previewSource,
  /chat-image-preview-host/,
  "attachment preview module should create a dedicated preview host"
);
assert.match(
  previewSource,
  /event\.preventDefault\(\)/,
  "attachment preview click should prevent browser navigation"
);
assert.match(
  previewSource,
  /event\.key === "Escape"/,
  "attachment preview should close on Escape"
);
assert.match(
  chatCss,
  /\.chat-image-preview-scrim[\s\S]*backdrop-filter: blur/,
  "attachment preview should use a dark blurred scrim"
);
assert.match(
  chatCss,
  /\.chat-image-preview-modal img[\s\S]*object-fit: contain/,
  "attachment preview should show the full image without cropping"
);
assert.match(
  chatCss,
  /\.prod-panel\.is-product-switching-out \.pp-scroll[\s\S]*translateX\(-12px\)/,
  "product switch should animate panel contents without changing the outer product panel width"
);
assert.match(
  chatCss,
  /@keyframes productPanelContentIn/,
  "product switch should have an internal re-entry animation"
);

console.log("chat product switch and attachment preview self-check passed");
