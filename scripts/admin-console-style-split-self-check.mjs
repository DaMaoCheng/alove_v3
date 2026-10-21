import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const appCssPath = "src/features/app-shell/app.css";
const adminCssPath = "src/features/app-shell/styles/admin-console.css";
const editorCssPath = "src/features/app-shell/styles/admin-character-editor.css";

for (const path of [appCssPath, adminCssPath, editorCssPath]) {
  assert.ok(existsSync(path), `admin style split file should exist: ${path}`);
}

const appCss = readFileSync(appCssPath, "utf8");
const adminCss = readFileSync(adminCssPath, "utf8");
const editorCss = readFileSync(editorCssPath, "utf8");

const adminImportIndex = appCss.indexOf('@import "./styles/admin-console.css";');
const editorImportIndex = appCss.indexOf('@import "./styles/admin-character-editor.css";');
assert.ok(adminImportIndex >= 0, "app css should import admin console styles");
assert.ok(editorImportIndex > adminImportIndex, "app css should import editor styles after admin console styles");
for (const path of [
  "admin-overview.css",
  "admin-accounts.css",
  "admin-mascot.css",
  "admin-promotion-campaigns.css",
  "admin-logs.css",
]) {
  const importIndex = appCss.indexOf(`@import "./styles/${path}";`);
  assert.ok(importIndex > adminImportIndex, `app css should import ${path} after admin console styles`);
  assert.ok(importIndex < editorImportIndex, `app css should import ${path} before character editor styles`);
}
assert.doesNotMatch(adminCss, /\.character-editor-head-row/, "admin console css should not keep character editor modal rules");
assert.doesNotMatch(adminCss, /\.admin-common-create-form \.cf-field input/, "admin console css should not keep common character form field rules");
assert.doesNotMatch(adminCss, /\.admin-creator-create-form \.agent-status-dd \.dd-select-trigger/, "admin console css should not keep creator character form dropdown rules");
assert.match(adminCss, /\.creator-account-picker\.is-open\{ z-index:10030; \}/, "admin console css should keep creator account picker list rules");
assert.match(adminCss, /\.data-table\.admin-common-table/, "admin console css should keep common character table rules");

assert.match(editorCss, /\.character-editor-head-row/, "editor css should own character editor head layout");
assert.match(editorCss, /\.character-avatar-actions \.btn/, "editor css should own avatar action button wrapping");
assert.match(editorCss, /\.admin-common-edit-form \.cf-avatar-row/, "editor css should own common edit avatar row layout");
assert.match(editorCss, /\.admin-creator-create-form \.cf-field input,[\s\S]*\.admin-creator-edit-form \.cf-field input\{[^}]*height:48px;[^}]*\}/, "editor css should own creator modal input height");
assert.match(editorCss, /\.admin-creator-create-form \.agent-status-dd \.dd-select-trigger,[\s\S]*\.admin-creator-edit-form \.agent-status-dd \.dd-select-trigger\{(?=[^}]*height:48px;)(?=[^}]*min-height:48px;)(?=[^}]*padding:0 15px;)[^}]*\}/, "editor css should own creator dropdown height");

console.log("admin console style split self-check passed");
