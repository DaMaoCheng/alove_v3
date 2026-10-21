import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styleSource = readFileSync("src/features/app-shell/styles/discover.css", "utf8");

const gridRule = styleSource.match(/\.card-grid\s*\{([\s\S]*?)\n\}/)?.[1] || "";
assert.match(gridRule, /overflow-x:\s*auto;/, "character rail must retain horizontal scrolling");
assert.match(gridRule, /overflow-y:\s*hidden;/, "character rail must keep its vertical clipping boundary");
assert.match(gridRule, /padding:\s*34px 2px 50px;/, "character rail must reserve hover-glow safety space inside the scrollport");
assert.match(gridRule, /margin:\s*-34px -2px -50px;/, "character rail must offset its safety space so card placement and surrounding spacing stay unchanged");

const hoverRule = styleSource.match(/\.char-card:hover\s*\{([\s\S]*?)\n\}/)?.[1] || "";
assert.match(hoverRule, /translateY\(-4px\) scale\(1\.012\)/, "existing desktop card hover lift must remain unchanged");
assert.match(hoverRule, /box-shadow:\s*var\(--shadow-glow\)/, "existing desktop card hover glow must remain unchanged");

const mobileRule = styleSource.match(/@media \(max-width: 720px\) \{([\s\S]*)$/)?.[1] || "";
assert.match(mobileRule, /\.card-grid\s*\{[\s\S]*?scroll-snap-type:\s*x mandatory;[\s\S]*?padding-bottom:\s*54px;[\s\S]*?margin-bottom:\s*-54px;/, "mobile card rail must preserve scroll snapping while retaining the lower hover-glow safety space");

console.log("discover card hover-bleed self-check passed");
