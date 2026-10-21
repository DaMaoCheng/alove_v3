import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminSiteEditorHtml, adminSitesTableHtml } from "../src/features/admin-console/admin-console-sites-template.js";

const REGIONS = [
  { id: "geo_europe", parentId: "", level: "continent", code: "EU", nameZh: "欧洲", nameEn: "Europe", aliases: [] },
  { id: "geo_uk_country", parentId: "geo_europe", level: "country", code: "GB", nameZh: "英国", nameEn: "United Kingdom", aliases: ["UK"] },
  { id: "geo_london", parentId: "geo_uk_country", level: "subdivision", code: "GB-LND", nameZh: "伦敦", nameEn: "London", aliases: ["Greater London"] },
];

const html = adminSiteEditorHtml({
  id: "site_fkk",
  name: "FKK",
  slug: "footballkituk",
  siteUrl: "",
  defaultLanguage: "English",
  mascotCharacterId: "mascot_template",
  mascotName: "Kit",
  productApiUrl: "",
  description: "",
  regionIds: ["geo_uk_country", "geo_london"],
}, { regions: REGIONS });

assert.match(html, /<div class="site-region-trigger" role="button" tabindex="0" data-site-region-trigger aria-expanded="false">/, "region trigger should be a full-row div button, not a native button");
assert.doesNotMatch(html, /<button class="site-region-trigger"/, "region trigger must not be a native button because selected tags contain remove buttons");
assert.match(html, /<div class="site-region-menu" data-site-region-menu hidden>/, "region dropdown menu should be hidden before click");
assert.match(html, /data-site-region-remove="geo_uk_country"/, "selected region remove action should render for country tag");
assert.match(html, /data-site-region-remove="geo_london"/, "selected region remove action should render for subdivision tag");
assert.match(html, /<span class="site-region-caret" aria-hidden="true"><svg/, "region trigger should render a real chevron icon, not undefined text");
assert.match(html, /data-site-region-search/, "region picker should render a search input");
assert.match(html, /placeholder="搜索中文 \/ 英文 \/ 代码，例如 英国、UK、北京"/, "region search input should explain supported search terms");
assert.match(html, /data-site-region-option="geo_uk_country"/, "region options should render selectable rows");
assert.match(html, /欧洲 \/ 英国/, "region option should show country hierarchy labels");
assert.match(html, /欧洲 \/ 英国 \/ 伦敦/, "region option should show subdivision hierarchy labels");
assert.doesNotMatch(html, /undefined|chevronDown/, "region picker should not render missing icon text");

const triggerBlock = html.match(/<div class="site-region-trigger"[\s\S]*?<\/div>\s*<div class="site-region-menu"/)?.[0] || "";
assert.ok(triggerBlock.includes("data-site-region-tags"), "full-row trigger should include selected tag area");
assert.ok(triggerBlock.includes("site-region-caret"), "full-row trigger should include caret area");
const nestedButtons = Array.from(triggerBlock.matchAll(/<button\b([^>]*)>/g)).map((match) => match[1]);
assert.ok(nestedButtons.length >= 1, "selected tags should still render removable buttons inside the full-row trigger");
assert.ok(nestedButtons.every((attrs) => attrs.includes("data-site-region-remove=")), "only selected tag remove buttons may appear inside the full-row trigger");

const emptyHtml = adminSiteEditorHtml(null, { regions: [] });
assert.match(emptyHtml, /未指定，使用默认站点兜底/, "empty target regions should explain default-site fallback");
assert.match(emptyHtml, /<div class="site-region-menu" data-site-region-menu hidden>/, "new-site region dropdown should also start closed");

const tableHtml = adminSitesTableHtml({
  items: [{
    id: "site_fkk",
    name: "FKK",
    slug: "footballkituk",
    siteUrl: "",
    isDefault: false,
    regions: REGIONS.slice(1),
    userCount: 0,
    mascotCharacterId: "mascot_template",
    mascotName: "Kit",
    creatorCount: 0,
  }],
});
assert.match(tableHtml, /site-region-table-tags/, "site table should render selected regions as tags");
assert.match(tableHtml, /<i>英国<\/i>/, "site table should show selected country tag");
assert.match(tableHtml, /<i>伦敦<\/i>/, "site table should show selected subdivision tag");
assert.match(tableHtml, /site-mascot-cell/, "site table should render mascot name and id in a constrained cell");
assert.match(tableHtml, /<b>Kit<\/b>/, "site table should show mascot name in the mascot column");
assert.match(tableHtml, /<small>mascot_template<\/small>/, "site table should show mascot id below the mascot name");
assert.doesNotMatch(tableHtml, /<span>mascot_template<\/span>/, "site table should not render mascot id as the only mascot column content");

const regionPickerSource = readSource("src/features/admin-console/admin-sites-region-picker.js");
assert.match(regionPickerSource, /trigger\?\.addEventListener\("click"/, "full trigger row should toggle the dropdown on click");
assert.match(regionPickerSource, /search\?\.addEventListener\("input"/, "search input should filter options while typing");
assert.match(regionPickerSource, /data-site-region-online/, "online search action should be handled by the region picker helper");
assert.match(regionPickerSource, /selected\.delete\(remove\.dataset\.siteRegionRemove/, "selected region tags should be removable");
assert.match(regionPickerSource, /input\.value = Array\.from\(selected\)\.join\(","\)/, "selected regions should sync into the hidden form field before save");

const styleSource = readSource("src/features/app-shell/styles/admin-console.css");
assert.match(styleSource, /\.site-region-trigger\{[^}]*width:100%/, "region trigger should fill the row click target");
assert.match(styleSource, /\.site-region-menu\[hidden\]\{ display:none; \}/, "hidden region menu should not remain visible");
assert.match(styleSource, /\.site-region-table-tags/, "site table should render selected regions as tags");
assert.match(styleSource, /\.site-mascot-cell\{[^}]*max-width:180px/, "site mascot table cell should cap long names and ids");
assert.match(styleSource, /\.site-mascot-cell b,\.site-mascot-cell small\{[^}]*text-overflow:ellipsis/, "site mascot name and id should ellipsize instead of wrapping");

console.log("admin site region picker UI self-check passed");

function readSource(path) {
  return readFileSync(path, "utf8");
}
