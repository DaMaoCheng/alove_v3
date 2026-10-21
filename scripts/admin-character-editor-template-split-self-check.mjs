import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const entryPath = "src/features/admin-console/admin-character-editor-template.js";
const commonPath = "src/features/admin-console/admin-character-editor-common-template.js";
const creatorPath = "src/features/admin-console/admin-character-editor-creator-template.js";
const fieldsPath = "src/features/admin-console/admin-character-editor-fields.js";

for (const path of [entryPath, commonPath, creatorPath, fieldsPath]) {
  assert.ok(existsSync(path), `admin character editor split file should exist: ${path}`);
}

const entry = readFileSync(entryPath, "utf8");
assert.match(entry, /adminCommonCharacterCreateHtml/, "entry should dispatch common create rendering");
assert.match(entry, /adminCreatorCharacterCreateHtml/, "entry should dispatch creator create rendering");
assert.doesNotMatch(entry, /function adminCommonCharacterCreateHtml/, "entry should not own common create template implementation");
assert.doesNotMatch(entry, /function adminCreatorCharacterCreateHtml/, "entry should not own creator create template implementation");
assert.ok(entry.split(/\r?\n/).length <= 90, "entry template dispatcher should stay small");

const common = readFileSync(commonPath, "utf8");
assert.match(common, /export function adminCommonCharacterCreateHtml/, "common template module should export common create renderer");
assert.match(common, /export function adminCommonCharacterEditHtml/, "common template module should export common edit renderer");
assert.doesNotMatch(common, /adminCreatorCharacterCreateHtml/, "common template module should not include creator forms");

const creator = readFileSync(creatorPath, "utf8");
assert.match(creator, /export function adminCreatorCharacterCreateHtml/, "creator template module should export creator create renderer");
assert.match(creator, /export function adminCreatorCharacterEditHtml/, "creator template module should export creator edit renderer");
assert.doesNotMatch(creator, /adminCommonCharacterCreateHtml/, "creator template module should not include common forms");

const fields = readFileSync(fieldsPath, "utf8");
for (const exportName of [
  "adminPick",
  "languageDropdownHtml",
  "renderAdminVisibilityOptions",
  "renderCommonStatusField",
  "renderCreatorAccountPicker",
  "renderCreatorReadonlyInput",
  "buildAdminVoiceOptions",
  "resolveAdminVoicePreset",
]) {
  assert.match(fields, new RegExp(`export function ${exportName}`), `fields module should export ${exportName}`);
}

console.log("admin character editor template split self-check passed");
