import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/chat/chat-product-panel.js", "utf8");

assert.match(
  source,
  /root\.addEventListener\("click",[\s\S]*?closest\("\.product-card, \.product-card-trigger"\)/,
  "product panel should use delegated clicks so every product card can open details"
);
assert.doesNotMatch(
  source,
  /querySelector\("\.product-card"\)\?\.addEventListener\("click"/,
  "product panel should not bind only the first product card"
);
assert.match(
  source,
  /data-product-panel-size-index/,
  "product panel should listen for size button clicks inside the detail panel"
);
assert.match(
  source,
  /updateSelectedProductSize/,
  "product panel should persist the chosen product size back into panel state"
);

console.log("chat product panel binding self-check passed");
