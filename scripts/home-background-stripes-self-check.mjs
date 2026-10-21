import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseCss = readFileSync("src/styles/base.css", "utf8");
const foundationCss = readFileSync("src/features/app-shell/styles/foundation.css", "utf8");

assert.doesNotMatch(baseCss, /body::before[\s\S]*repeating-linear-gradient/, "base background should not render global vertical stripes");
assert.doesNotMatch(foundationCss, /body::before[\s\S]*repeating-linear-gradient/, "app shell background should not render global vertical stripes");
assert.doesNotMatch(foundationCss, /--stripe:/, "unused stripe color tokens should be removed from app shell tokens");

console.log("home background stripes self-check passed");
