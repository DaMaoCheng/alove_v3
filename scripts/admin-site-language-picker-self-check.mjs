import assert from "node:assert/strict";
import { adminSiteEditorHtml } from "../src/features/admin-console/admin-console-sites-template.js";
import { readFile } from "node:fs/promises";

const html = adminSiteEditorHtml({
  id: "site_language_picker_check",
  name: "Language Picker Check",
  slug: "language-picker-check",
  defaultLanguage: "Chinese (Mandarin)",
  regionIds: [],
});

assert.match(html, /data-admin-language-picker/, "site editor should reuse the shared searchable language picker");
assert.match(html, /name="defaultLanguage" value="Chinese \(Mandarin\)"/, "site language picker should submit the site field name");
assert.match(html, /data-admin-language-search/, "site language picker should expose the shared language search input");
assert.match(html, /data-language-code-value="zh"/, "site language picker should resolve and select Chinese");

const editorSource = await readFile(new URL("../src/features/admin-console/admin-sites-editor.js", import.meta.url), "utf8");
assert.match(editorSource, /bindAdminLanguagePicker\(form, \{ signal: host\.siteEditorAbortController\.signal \}\)/, "site editor should reuse the shared language picker controller with lifecycle cleanup");

console.log("admin site language picker self-check passed");
