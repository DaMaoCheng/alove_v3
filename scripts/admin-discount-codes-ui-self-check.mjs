import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = read("src/features/admin-console/admin-console-data.js");
const content = read("src/features/admin-console/admin-console-content.js");
const page = read("src/features/admin-console/admin-console-page.js");
const staticTabs = read("src/features/admin-console/admin-console-static-tabs.js");
const template = read("src/features/admin-console/admin-discount-codes-template.js");
const controller = read("src/features/admin-console/admin-discount-codes-controller.js");
const editor = read("src/features/admin-console/admin-discount-code-editor.js");
const service = read("src/services/discount-code-service.js");
const style = read("src/features/app-shell/styles/admin-discount-codes.css");

assert.match(data, /\["codes", ICONS\.ticket, "折扣码"\]/, "admin navigation should expose the real discount-code page");
assert.doesNotMatch(data, /折扣码（待）/, "discount-code navigation should no longer be marked pending");
assert.match(content, /adminDiscountCodesHtml/, "admin content should render the real discount-code template");
assert.match(page, /bindAdminDiscountCodes/, "admin page should bind the discount-code controller");
assert.doesNotMatch(staticTabs, /adminCodesHtml|LEO33|已使用/, "static tabs must not retain fake discount-code data");

assert.match(template, /data-discount-code-query/, "discount-code page should expose search");
assert.match(template, /data-discount-code-site-filter/, "discount-code page should expose site filtering");
assert.match(template, /data-discount-code-owner-filter/, "discount-code page should expose ownership filtering");
assert.match(template, /data-discount-code-status-filter/, "discount-code page should expose status filtering");
assert.match(template, /\["site", "前台"\].*\["creator", "网红"\]/s, "editor should use the approved owner labels");
assert.match(template, /data-discount-code-shopify-query/, "editor should search Shopify discount codes");
assert.match(template, /data-discount-code-shopify-results/, "editor should render Shopify search results");
assert.match(template, /data-discount-code-rule-card/, "editor should show the selected Shopify rule as readonly content");
assert.match(template, /role="combobox"[^>]+aria-controls="discountCodeShopifyResults"/, "Shopify search should expose combobox semantics");
assert.match(template, /role="listbox"/, "Shopify search results should expose listbox semantics");
assert.doesNotMatch(template, /name="offerDescription"|name="validityMode"|name="startsAt"|name="endsAt"/, "Shopify-owned rule fields must not remain editable");
assert.doesNotMatch(template, /已使用|redeem|usage count/i, "page must not show usage numbers before trusted order attribution exists");

assert.match(controller, /getAdminDiscountCodeOptions/, "controller should load trusted site and creator options");
assert.match(controller, /listAdminDiscountCodes/, "controller should load the real list API");
assert.doesNotMatch(controller, /createAdminDiscountCode|updateAdminDiscountCode|FormData/, "list controller should not own editor writes");
assert.match(editor, /createAdminDiscountCode/, "editor should own create requests");
assert.match(editor, /updateAdminDiscountCode/, "editor should own update requests");
assert.match(editor, /siteId.*addEventListener\("change", syncCreators\)/s, "changing site should reset the creator picker");
assert.match(editor, /searchAdminShopifyDiscountCodes/, "editor should use the Shopify discount search service");
assert.match(editor, /setTimeout\(async \(\) =>/, "Shopify search should be debounced");
assert.match(editor, /event\.key === "ArrowDown"/, "Shopify search should support keyboard result navigation");
assert.match(editor, /event\.key === "Escape"/, "Shopify search should support keyboard dismissal");
assert.match(editor, /请从 Shopify 搜索结果中选择折扣码/, "manual unmatched code input must be rejected");
assert.match(service, /API_ENDPOINTS\.admin\.discountCodes/, "service should use the centralized API endpoint");
assert.match(service, /discountCodeShopifySearch/, "service should use the centralized Shopify search endpoint");
assert.match(style, /\.discount-code-choice::before[^}]+background:var\(--accent\)/, "segmented controls should use the theme accent for the selected slider");
assert.match(style, /\.discount-code-choice:has\(input\[value="creator"\]:checked\)/, "ownership slider should move when the second option is selected");
assert.match(style, /transition:transform \.2s var\(--ease\)/, "segmented control slider should animate between options");
assert.match(style, /\.discount-code-shopify-results\{[^}]+position:absolute/, "Shopify matches should use a floating dropdown");

console.log("admin discount codes UI self-check passed");

function read(path) {
  return readFileSync(path, "utf8");
}
