import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const responsiveCss = readFileSync("src/features/app-shell/styles/app-responsive.css", "utf8");
const chatCss = readFileSync("src/features/app-shell/styles/chat.css", "utf8");
const mobileBlock = responsiveCss.match(/@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\/\* --- product panel becomes a bottom sheet on mobile --- \*\//)?.[0] || "";

assert.match(
  mobileBlock,
  /\.msg \.bubble\s*\{[^}]*max-width:\s*78vw/,
  "mobile AI text bubbles should keep the shared 78vw width rule"
);
assert.match(
  mobileBlock,
  /\.product-card\s*\{[\s\S]*?width:\s*78vw/,
  "mobile product card should use the same width as AI text bubbles"
);
assert.match(
  mobileBlock,
  /\.product-card\s*\{[\s\S]*?max-width:\s*78vw/,
  "mobile product card should use the same max width as AI text bubbles"
);
assert.doesNotMatch(
  mobileBlock,
  /\.product-card\s*\{[\s\S]*?margin-left:\s*0/,
  "mobile product card should keep the desktop avatar offset so it aligns with AI bubbles"
);
assert.match(
  chatCss,
  /\.product-card \.pc-img\s*\{[^}]*aspect-ratio:\s*1\/1/,
  "chat product card images should keep a square 1:1 frame"
);

console.log("chat mobile product card self-check passed");
