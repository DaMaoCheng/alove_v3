import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  escapeAdminTableAttr,
  escapeAdminTableHtml,
  escapeAttr,
  escapeHtml,
  formatNumber,
  paginationButtonsHtml,
} from "../src/features/admin-console/admin-console-utils.js";

assert.equal(escapeHtml(`<a title="x">Tom & Jerry's</a>`), "&lt;a title=&quot;x&quot;&gt;Tom &amp; Jerry&#039;s&lt;/a&gt;");
assert.equal(escapeAttr(`say "hello"`), "say &quot;hello&quot;");
assert.equal(escapeAdminTableHtml(`Tom & Jerry's`), "Tom &amp; Jerry&#39;s", "admin table escaping should preserve its historical apostrophe entity");
assert.equal(escapeAdminTableHtml(null), "null", "admin table escaping should preserve explicit null stringification");
assert.equal(escapeAdminTableAttr(`say "hello"`), "say &quot;hello&quot;");
assert.equal(formatNumber(1234567), "1,234,567");
assert.equal(
  paginationButtonsHtml(2, 4, "data-test-page"),
  '<button class="pg-btn " type="button" data-test-page="1">1</button><button class="pg-btn active" type="button" data-test-page="2">2</button><button class="pg-btn " type="button" data-test-page="3">3</button><button class="pg-btn " type="button" data-test-page="4">4</button>',
  "short pagination output should remain exact"
);
assert.equal(
  paginationButtonsHtml(5, 10, "data-test-page"),
  '<button class="pg-btn " type="button" data-test-page="1">1</button><span class="pg-ellipsis">...</span><button class="pg-btn " type="button" data-test-page="4">4</button><button class="pg-btn active" type="button" data-test-page="5">5</button><button class="pg-btn " type="button" data-test-page="6">6</button><span class="pg-ellipsis">...</span><button class="pg-btn " type="button" data-test-page="10">10</button>',
  "long pagination output should preserve deterministic gaps"
);
assert.equal((paginationButtonsHtml(1, 7, "data-test-page").match(/<button/g) || []).length, 7, "seven pages should render every number");
assert.equal((paginationButtonsHtml(1, 8, "data-test-page").match(/<button/g) || []).length, 3, "eight pages at the start should render first, next and last");
assert.match(paginationButtonsHtml(1, 8, "data-test-page"), /data-test-page="1"[\s\S]*data-test-page="2"[\s\S]*data-test-page="8"/, "first-page pagination should preserve its candidates");
assert.match(paginationButtonsHtml(8, 8, "data-test-page"), /data-test-page="1"[\s\S]*data-test-page="7"[\s\S]*data-test-page="8"/, "last-page pagination should preserve its candidates");

const paginationTemplates = [
  ["accounts", "src/features/admin-console/admin-console-accounts-template.js", "data-account-page"],
  ["logs", "src/features/admin-console/admin-console-logs-template.js", "data-log-page"],
  ["overview", "src/features/admin-console/admin-console-overview-template.js", "data-product-rank-page"],
  ["feedback", "src/features/admin-console/admin-feedback-template.js", "data-feedback-page"],
];
for (const [label, file, dataAttribute] of paginationTemplates) {
  const source = readFileSync(file, "utf8");
  assert.match(source, new RegExp(`paginationButtonsHtml\\([^\\n]+"${dataAttribute}"\\)`), `${label} template should pass its page data attribute to shared pagination`);
  assert.doesNotMatch(source, /function pageButtonHtml/, `${label} template should not keep a local page button renderer`);
}

for (const file of [
  "src/features/admin-console/admin-console-accounts-template.js",
  "src/features/admin-console/admin-guest-sessions-template.js",
]) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /admin-console-utils\.js/, `${file} should use shared escaping and number formatting`);
  assert.doesNotMatch(source, /function escapeHtml|function escapeAttr|function formatNumber/, `${file} should not keep duplicate shared formatters`);
}

console.log("admin console shared UI rules self-check passed");
