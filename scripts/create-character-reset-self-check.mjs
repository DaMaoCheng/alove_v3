import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = [
  "../src/app/main.js",
  "../src/app/app-create-actions.js",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
const avatarActionsSource = readFileSync(new URL("../src/app/character-avatar-actions.js", import.meta.url), "utf8");

assert.match(avatarActionsSource, /function resetCreateDraftState/, "create draft reset helper should exist");
assert.match(avatarActionsSource, /resetCreateDraftState\(\)/, "cleanup should reuse create draft reset helper");
assert.match(appSource, /characterActions\.resetCreateDraftState\(\)/, "successful creation should reset the create form state");
assert.doesNotMatch(appSource, /if \(character\?\.id\) \{\s*appState\.create\.dirty = false;\s*navigationActions\.navigateApp/s, "successful creation should not only clear the dirty flag");

console.log("Create character reset self-check passed");
