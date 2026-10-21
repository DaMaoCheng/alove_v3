import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/app-shell/styles/kitshop.css", "utf8");

assert.doesNotMatch(source, /\.kitshop-rail-nav--prev\s*\{\s*left:\s*0;\s*transform:\s*translate\(-50%, -50%\);\s*\}/, "desktop previous buttons must not use the clipped edge-centered position");
assert.doesNotMatch(source, /\.kitshop-rail-nav--next\s*\{\s*right:\s*0;\s*transform:\s*translate\(50%, -50%\) rotate\(180deg\);\s*\}/, "desktop next buttons must not use the clipped edge-centered position");
assert.match(source, /\.kitshop-rail-nav--prev\s*\{\s*left:\s*10px;\s*transform:\s*translateY\(-50%\);\s*\}/, "desktop previous buttons should stay fully inside the rail");
assert.match(source, /\.kitshop-rail-nav--next\s*\{\s*right:\s*10px;\s*transform:\s*translateY\(-50%\) rotate\(180deg\);\s*\}/, "desktop next buttons should stay fully inside the rail");
assert.match(source, /@media \(max-width: 720px\)[\s\S]*?\.kitshop-rail-nav--prev\s*\{\s*left:\s*-9px;\s*transform:\s*translateY\(-50%\);\s*\}/, "mobile previous button positioning should remain unchanged");
assert.match(source, /@media \(max-width: 720px\)[\s\S]*?\.kitshop-rail-nav--next\s*\{\s*right:\s*-9px;\s*transform:\s*translateY\(-50%\) rotate\(180deg\);\s*\}/, "mobile next button positioning should remain unchanged");

console.log("kitshop low-resolution navigation self-check passed");
