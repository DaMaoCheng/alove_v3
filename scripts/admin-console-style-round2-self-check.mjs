import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const files = {
  app: "src/features/app-shell/app.css",
  console: "src/features/app-shell/styles/admin-console.css",
  overview: "src/features/app-shell/styles/admin-overview.css",
  accounts: "src/features/app-shell/styles/admin-accounts.css",
  mascot: "src/features/app-shell/styles/admin-mascot.css",
  promotion: "src/features/app-shell/styles/admin-promotion-campaigns.css",
  logs: "src/features/app-shell/styles/admin-logs.css",
  editor: "src/features/app-shell/styles/admin-character-editor.css",
};

for (const path of Object.values(files)) {
  assert.ok(existsSync(path), `admin style file should exist: ${path}`);
}

const css = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);

const importOrder = [
  "admin-console.css",
  "admin-overview.css",
  "admin-accounts.css",
  "admin-mascot.css",
  "admin-promotion-campaigns.css",
  "admin-logs.css",
  "admin-character-editor.css",
].map((file) => css.app.indexOf(`@import "./styles/${file}";`));

for (const index of importOrder) {
  assert.notEqual(index, -1, "app css should import every admin style split file");
}
for (let index = 1; index < importOrder.length; index += 1) {
  assert.ok(importOrder[index] > importOrder[index - 1], "admin style imports should stay in split order");
}

const movedOutOfConsole = [
  /\.product-funnel-panel/,
  /\.admin-product-rank-panel/,
  /\.promotion-product-picker/,
  /\.promotion-campaign-stats/,
  /\.account-bulk-row/,
  /\.account-convo-host/,
  /\.mas-row/,
  /\.mtpl-grid/,
  /\.logs-page/,
  /\.log-head,\.log-row/,
];

for (const pattern of movedOutOfConsole) {
  assert.doesNotMatch(css.console, pattern, `admin-console.css should not keep moved selector: ${pattern}`);
}

assert.match(css.overview, /\.product-funnel-panel/, "overview css should own product funnel panel styles");
assert.match(css.overview, /\.admin-product-rank-panel/, "overview css should own product rank panel styles");
assert.match(css.accounts, /\.account-bulk-row/, "accounts css should own bulk row styles");
assert.match(css.accounts, /\.account-convo-host/, "accounts css should own conversation modal styles");
assert.match(css.mascot, /\.mas-row/, "mascot css should own mascot row styles");
assert.match(css.mascot, /\.mtpl-grid/, "mascot css should own template grid styles");
assert.match(css.promotion, /\.promotion-product-picker/, "promotion css should own product picker styles");
assert.match(css.promotion, /\.promotion-campaign-stats/, "promotion css should own campaign stats styles");
assert.match(css.logs, /\.logs-page/, "logs css should own logs page styles");
assert.match(css.logs, /\.log-head,\.log-row/, "logs css should own log row grid styles");

assert.match(css.console, /\.creator-account-picker\.is-open\{ z-index:10030; \}/, "admin console css should keep creator account picker stacking rule");
assert.match(css.console, /\.data-table\.admin-common-table/, "admin console css should keep common character table rules");
assert.match(css.console, /\.site-region-picker/, "admin console css should keep site region picker rules until a site style split exists");

console.log("admin console style round2 self-check passed");
