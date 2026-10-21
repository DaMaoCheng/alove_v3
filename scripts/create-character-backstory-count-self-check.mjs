import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const templateSource = readFileSync("src/features/create-character/create-character-template.js", "utf8");
const pageSource = readFileSync("src/features/create-character/create-character-page.js", "utf8");
const styleSource = readFileSync("src/features/app-shell/styles/create-character.css", "utf8");

assert.match(templateSource, /textarea name="backstory" rows="4" maxlength="4000"/, "Backstory input must enforce the 4,000-character limit.");
assert.match(templateSource, /data-backstory-count/, "Backstory input must render a character count.");
assert.match(pageSource, /updateBackstoryCount\(page, event\.target\)/, "Typing must update the character count.");
assert.match(pageSource, /updateBackstoryCount\(page, textarea\)/, "AI polish must refresh the character count.");
assert.match(styleSource, /\.cf-backstory-count/, "The character count needs its field-local style.");

console.log("create-character-backstory-count-self-check: passed");
