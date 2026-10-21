import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stateSource = readFileSync("src/app/app-state.js", "utf8");
const pageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const panelSource = readFileSync("src/features/chat/chat-product-panel.js", "utf8");
const panelGallerySource = readFileSync("src/features/chat/chat-product-panel-gallery.js", "utf8");
const textActionsSource = readFileSync("src/app/chat-text-actions.js", "utf8");
const dataActionsSource = readFileSync("src/app/chat-data-actions.js", "utf8");

assert.match(
  stateSource,
  /openProductPanel:\s*null/,
  "chat state should keep the currently open product panel payload"
);
assert.match(
  pageSource,
  /openProductPanel/,
  "chat page should receive the currently open product panel state"
);
assert.match(
  pageSource,
  /onProductPanelChange/,
  "chat page should notify app state when the product panel changes"
);
assert.match(
  panelSource,
  /initialProduct/,
  "product panel binding should restore an already open product after remount"
);
assert.match(
  panelSource,
  /onProductChange/,
  "product panel binding should persist product open and close events"
);
assert.match(
  panelGallerySource,
  /imageIndex/,
  "product panel state should preserve the currently visible gallery image"
);
assert.match(
  panelSource,
  /openClass = "product-open"/,
  "product panel should keep product-open as the default chat panel body class"
);
assert.match(
  panelSource,
  /document\.body\.classList\.remove\(openClass\)/,
  "remounting without an open product should close stale product panel UI through the active body class"
);
assert.match(
  panelSource,
  /openProductPanel[\s\S]*restart/,
  "clicking another product card while the panel is open should still detect switch state"
);
assert.doesNotMatch(
  panelSource,
  /if\s*\(\s*!restart\s*\)[\s\S]*document\.body\.classList\.remove\(openClass\)/,
  "switching product cards should not remove product-open and shake the chat layout"
);
assert.match(
  panelSource,
  /restart && wasOpen[\s\S]*animateProductPanelSwitch/,
  "switching product cards should animate content inside the already-open panel"
);
assert.doesNotMatch(
  textActionsSource,
  /openProductPanel\s*=\s*null[\s\S]*handleChatMessageSubmit/,
  "sending a text message should not clear the currently open product panel"
);
assert.match(
  pageSource,
  /initialProduct:\s*openProductPanel/,
  "remounting the chat page should restore the currently open product instead of closing it"
);
assert.match(
  dataActionsSource,
  /openProductPanel\s*=\s*null/,
  "loading another character or clearing chat should close stale product panel state"
);

console.log("chat product panel state self-check passed");
