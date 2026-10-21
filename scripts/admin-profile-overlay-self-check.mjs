import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const viewFactorySource = readFileSync("src/app/app-view-factory.js", "utf8");
const adminPageSource = readFileSync("src/features/admin-console/admin-console-page.js", "utf8");
const adminLayoutSource = readFileSync("src/features/admin-console/admin-console-layout.js", "utf8");
const adminCss = readFileSync("src/features/app-shell/styles/admin-console.css", "utf8");

assert.match(viewFactorySource, /onOpenProfile:\s*actions\.openProfile/, "admin page should receive openProfile action");
assert.match(viewFactorySource, /appendOverlayContent\(adminPage,\s*appState,\s*actions\)/, "admin page should render shared overlays");
assert.match(adminPageSource, /onOpenProfile/, "admin console page should accept onOpenProfile");
assert.match(adminPageSource, /createAdminShell\(\{[\s\S]*onOpenProfile/, "admin console page should pass onOpenProfile into shell");
assert.match(adminLayoutSource, /<button class="admin-user" type="button"/, "admin topbar account block should be a clickable button");
assert.match(adminLayoutSource, /onOpenProfile\?\.\("profile"\)/, "admin topbar account button should open profile modal");
assert.match(adminCss, /\.admin-user\{[^}]*background:\s*transparent/, "admin user button should keep existing visual style");
assert.match(adminCss, /\.admin-user\{[^}]*cursor:\s*pointer/, "admin user button should show it is clickable");

console.log("admin profile overlay self-check passed");
