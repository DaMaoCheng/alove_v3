import assert from "node:assert/strict";
import { assertSiteCommerceEnabled, isSiteCommerceEnabled } from "../server/site-commerce-policy.js";
import fs from "node:fs";

assert.equal(isSiteCommerceEnabled({}), true, "legacy site rows remain enabled");
assert.equal(isSiteCommerceEnabled({ commerce_enabled: 1 }), true);
assert.equal(isSiteCommerceEnabled({ commerce_enabled: 0 }), false);
assert.equal(isSiteCommerceEnabled({ commerceEnabled: false }), false);
assert.throws(() => assertSiteCommerceEnabled({ commerce_enabled: 0 }), /Online purchase/);

const files = {
  migration: fs.readFileSync(new URL("../server/db-column-migrations.js", import.meta.url), "utf8"),
  adminTemplate: fs.readFileSync(new URL("../src/features/admin-console/admin-console-sites-template.js", import.meta.url), "utf8"),
  adminEditor: fs.readFileSync(new URL("../src/features/admin-console/admin-sites-editor.js", import.meta.url), "utf8"),
  panel: fs.readFileSync(new URL("../src/features/chat/chat-product-panel-renderer.js", import.meta.url), "utf8"),
  panelController: fs.readFileSync(new URL("../src/features/chat/chat-product-panel.js", import.meta.url), "utf8"),
  siteSearch: fs.readFileSync(new URL("../server/product-search-site-service.js", import.meta.url), "utf8"),
};
assert.match(files.migration, /commerce_enabled.*DEFAULT 1/);
assert.match(files.adminTemplate, /name="commerceEnabled"/);
assert.match(files.adminEditor, /commerceEnabled: data\.get\("commerceEnabled"\) === "on"/);
assert.match(files.panel, /product\.commerceEnabled === false/);
assert.match(files.panel, /copy\.viewMore/);
assert.match(files.panelController, /product\.commerceEnabled === false/);
assert.match(files.siteSearch, /commerce_enabled/);
console.log("site commerce toggle self-check passed");
