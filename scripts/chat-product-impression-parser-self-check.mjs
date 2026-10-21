import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/chat/chat-product-impressions.js", "utf8");

assert.match(source, /function reportProductImpressions\(root\)/, "chat product impression module should report product impressions");
assert.match(source, /parseProductPayload\(card\.dataset\.productAnalytics\)/, "product impression reporting should parse analytics payload");
assert.match(source, /function parseProductPayload\(value = ""\)/, "product impression module should define product payload parser used by impression reporting");
assert.match(source, /JSON\.parse\(value\)/, "product payload parser should parse serialized card data");
assert.match(source, /catch \{\s*return \{\};\s*\}/, "product payload parser should tolerate malformed card data");

console.log("chat product impression parser self-check passed");
