import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/app/app-main-ui-actions.js", "utf8");
const stateSource = readFileSync("src/app/app-state.js", "utf8");
const authStateSource = readFileSync("src/app/app-auth-state.js", "utf8");
const normalizeSource = extractFunction(source, "normalizeProfileTab");
const setTabSource = extractFunction(source, "setProfileTab");
const openProfileSource = extractFunction(source, "openProfile");

assert.match(normalizeSource, /tab === "orders" \? "orders"/, "the main profile tab state must preserve the Orders tab");
assert.match(setTabSource, /nextTab === "orders"[\s\S]*profileActions\.loadProfileOrders\(\{\s*force:\s*true\s*\}\)/, "switching to Orders must load provider order history");
assert.match(openProfileSource, /appState\.profile\.tab === "orders"[\s\S]*profileActions\.loadProfileOrders\(\{\s*force:\s*true\s*\}\)/, "opening the profile directly on Orders must load provider order history");
assert.match(stateSource, /profile:[\s\S]*orders:\s*\{[\s\S]*data:\s*null[\s\S]*detailError:\s*""/, "profile state must initialize the Orders state used by profile actions");
assert.match(authStateSource, /resetProfileState[\s\S]*profile\.orders\s*=\s*\{[\s\S]*data:\s*null[\s\S]*detailError:\s*""/, "auth reset must clear Orders state when a session ends");
assert.match(setTabSource, /loadProfileOrders\(\{\s*force:\s*true\s*\}\)/, "switching to Orders must bypass stale cached history");
assert.match(openProfileSource, /loadProfileOrders\(\{\s*force:\s*true\s*\}\)/, "opening Orders must bypass stale cached history");

console.log("profile orders tab self-check passed");

function extractFunction(sourceText, name) {
  const pattern = new RegExp(`function ${name}\\([^)]*\\) \\{`);
  const match = sourceText.match(pattern);
  assert.ok(match, `${name} function should exist`);
  const start = match.index;
  let depth = 0;
  for (let index = start; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  assert.fail(`${name} function should be parseable`);
}
