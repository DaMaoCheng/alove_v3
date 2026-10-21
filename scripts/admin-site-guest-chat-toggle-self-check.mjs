import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [template, styles, editor] = await Promise.all([
  readFile("src/features/admin-console/admin-console-sites-template.js", "utf8"),
  readFile("src/features/app-shell/styles/admin-console.css", "utf8"),
  readFile("src/features/admin-console/admin-sites-editor.js", "utf8"),
]);

assert.match(template, /class="site-toggle-input" name="guestChatEnabled" type="checkbox"/);
assert.match(template, /class="site-toggle-track" aria-hidden="true"/);
assert.match(template, /enabled \? "checked" : ""/);
assert.doesNotMatch(template, /renderField\("游客聊天", `<label>/, "the switch must not use nested labels");

assert.match(styles, /\.site-toggle-input:checked \+ \.site-toggle-track\{ background:var\(--accent\); border-color:var\(--accent\); \}/);
assert.match(styles, /\.site-toggle-input:checked \+ \.site-toggle-track \.site-toggle-thumb\{ background:#f4f8f6; transform:translateX\(18px\); \}/);
assert.match(styles, /\.site-toggle-input:focus-visible \+ \.site-toggle-track/);
assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
assert.match(editor, /guestChatEnabled: data\.get\("guestChatEnabled"\) === "on"/);

console.log("admin site guest chat toggle self-check passed");
