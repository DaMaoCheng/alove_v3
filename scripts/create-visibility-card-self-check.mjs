import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = readFileSync(new URL("../src/features/create-character/create-character-template.js", import.meta.url), "utf8");
const visibility = readFileSync(new URL("../src/features/create-character/create-character-visibility.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/features/create-character/create-character-page.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/features/app-shell/styles/create-character.css", import.meta.url), "utf8");

assert.match(template, /renderVisibilityOptions\(isPublic, copy\)/, "create page should render localized visibility option cards through the visibility renderer");
assert.match(template, /createState\.isPublic === true/, "visibility should default to private unless public is explicitly selected");
assert.match(visibility, /data-visibility-option/, "visibility renderer should render selectable option cards");
assert.match(visibility, /data-visibility-value="\$\{option\.value\}"/, "visibility renderer should set option values");
assert.match(visibility, /value: "private"/, "private option should be explicit");
assert.match(visibility, /value: "public"/, "public option should be explicit");
assert.doesNotMatch(template, /data-visibility-toggle/, "visibility should no longer be a single toggle button");
assert.doesNotMatch(template, /vis-switch/, "visibility UI should not render a switch");
assert.match(page, /querySelectorAll\("\[data-visibility-option\]"\)/, "create page should bind all visibility option cards");
assert.match(css, /\.vis-options/, "visibility option card grid should be styled");
assert.match(css, /\.vis-card\.is-selected::after/, "selected card should show a corner check marker");

console.log("Create visibility card self-check passed");
