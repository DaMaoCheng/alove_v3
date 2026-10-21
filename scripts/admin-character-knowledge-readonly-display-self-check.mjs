import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminCommonCharactersHtml } from "../src/features/admin-console/admin-console-common-characters-template.js";
import { adminCreatorCharactersHtml } from "../src/features/admin-console/admin-console-creator-characters-template.js";
import { adminMascotBodyHtml, mascotEditorModalHtml } from "../src/features/admin-console/admin-console-mascot-template.js";

const knowledgeBases = [
  { id: "kb_global", label: "Global football", scope: "global" },
  { id: "kb_global_2", label: "Global tactics", scope: "global" },
  { id: "kb_global_3", label: "Global culture", scope: "global" },
  { id: "kb_global_4", label: "Global awards", scope: "global" },
  { id: "kb_site_fkk", label: "FKK site football", scope: "site", siteIds: ["site_fkk"] },
  { id: "kb_common_direct", label: "Common direct", scope: "targeted", characterIds: ["char_common"] },
  { id: "kb_creator_direct", label: "Creator direct", scope: "targeted", characterIds: ["char_creator"] },
  { id: "kb_mascot_direct", label: "Mascot direct", scope: "targeted", characterIds: ["mascot_millie"] },
  { id: "kb_other_direct", label: "Other direct", scope: "targeted", characterIds: ["char_other"] },
];

const commonCharacter = {
  id: "char_common",
  name: "Bro",
  category: "Companion",
  categoryId: "companion",
  creator: { nickname: "System", account: "system" },
  visibility: "public",
  status: "published",
  chats: "0",
};

const creatorCharacter = {
  id: "char_creator",
  name: "Creator Ace",
  categoryId: "creator",
  ownerAccount: "creator@aiove.local",
  siteId: "site_fkk",
  siteName: "FKK",
  status: "published",
  chats: "0",
  revenue: "-",
};

const commonHtml = adminCommonCharactersHtml({
  items: [commonCharacter],
  knowledgeBases,
  loading: false,
});
assert.ok(commonHtml.includes("知识库管理"), "common page should link to knowledge management");
assert.ok(commonHtml.includes("知识库绑定统一在知识库页面管理"), "common page should explain centralized binding");
assert.ok(commonHtml.includes("直接绑定"), "common page should label direct knowledge");
assert.ok(commonHtml.includes("全局通用"), "common page should label global knowledge");
assert.ok(commonHtml.includes("Common direct"), "common page should show direct knowledge");
assert.ok(commonHtml.includes("Global football"), "common page should show global knowledge");
assert.ok(commonHtml.includes("Global tactics"), "common page should show the second global knowledge");
assert.ok(commonHtml.includes("+2"), "common page should collapse extra global knowledge into +N");
assert.ok(commonHtml.includes('data-kb-more-tooltip="Global culture\nGlobal awards"'), "common +N tag should expose hidden knowledge names in a single-column tooltip");
assert.ok(commonHtml.includes('title="Global culture\nGlobal awards"'), "common +N tag should keep a native tooltip fallback");
assert.ok(commonHtml.includes('data-kb-tag-tooltip="Global football"'), "visible truncated knowledge tags should expose full names on hover");
assert.ok(commonHtml.includes('<span>Global football</span>'), "visible knowledge names should render inside a text span for ellipsis");
assert.ok(!commonHtml.includes("<span>Global culture</span>"), "common page should hide global knowledge beyond the visible limit");
assert.ok(!commonHtml.includes("FKK site football"), "common page should not inherit site knowledge without a site");
assert.ok(!commonHtml.includes("Other direct"), "common page should not show unrelated targeted knowledge");

const creatorHtml = adminCreatorCharactersHtml({
  items: [creatorCharacter],
  sites: [{ id: "site_fkk", name: "FKK" }],
  knowledgeBases,
  loading: false,
});
assert.ok(creatorHtml.includes("知识库管理"), "creator page should link to knowledge management");
assert.ok(creatorHtml.includes("直接绑定"), "creator page should label direct knowledge");
assert.ok(creatorHtml.includes("站点继承"), "creator page should label site knowledge");
assert.ok(creatorHtml.includes("全局通用"), "creator page should label global knowledge");
assert.ok(creatorHtml.includes("Creator direct"), "creator page should show direct knowledge");
assert.ok(creatorHtml.includes("FKK site football"), "creator page should show inherited site knowledge");
assert.ok(creatorHtml.includes("Global football"), "creator page should show global knowledge");
assert.ok(creatorHtml.includes("+2"), "creator page should collapse extra global knowledge into +N");
assert.ok(!creatorHtml.includes("Other direct"), "creator page should not show unrelated targeted knowledge");

const mascot = { id: "mascot_millie", name: "Millie", greeting: "Hi", source: "本站专属" };
const site = {
  id: "site_fkk",
  name: "FKK",
  slug: "footballkituk",
  defaultLanguage: "English",
  mascotCharacterId: "mascot_millie",
  mascot,
};
const mascotHtml = adminMascotBodyHtml({
  template: { id: "mascot_template", name: "Kit", greeting: "Hello", source: "通用模板" },
  sites: [site],
  knowledgeBases,
  loading: false,
});
assert.ok(mascotHtml.includes("直接绑定"), "mascot page should label direct knowledge");
assert.ok(mascotHtml.includes("站点继承"), "mascot page should label site knowledge");
assert.ok(mascotHtml.includes("全局通用"), "mascot page should label global knowledge");
assert.ok(mascotHtml.includes("Mascot direct"), "mascot page should show direct mascot knowledge");
assert.ok(mascotHtml.includes("FKK site football"), "mascot page should show inherited site knowledge");
assert.ok(mascotHtml.includes("Global football"), "mascot page should show global knowledge");
assert.ok(mascotHtml.includes("+2"), "mascot page should collapse extra global knowledge into +N");

const mascotModalHtml = mascotEditorModalHtml({ mascot, site, sites: [site], mode: "site", knowledgeBases });
assert.ok(mascotModalHtml.includes("mascot-kb-readonly"), "mascot editor should keep readonly knowledge display");
assert.ok(mascotModalHtml.includes("直接绑定"), "mascot editor should label direct knowledge");
assert.ok(mascotModalHtml.includes("站点继承"), "mascot editor should label site knowledge");
assert.ok(!mascotModalHtml.includes("data-mascot-kb-select"), "mascot editor should not restore selectable knowledge binding");

const adminConsoleCss = [
  readFileSync(new URL("../src/features/app-shell/styles/admin-console.css", import.meta.url), "utf8"),
  readFileSync(new URL("../src/features/app-shell/styles/admin-knowledge.css", import.meta.url), "utf8"),
].join("\n");
const sourceGroupsRule = adminConsoleCss.match(/\.kb-source-groups\{[^}]+\}/)?.[0] || "";
assert.ok(sourceGroupsRule.includes("overflow:visible"), "knowledge source groups should not clip folded tags");
assert.ok(!sourceGroupsRule.includes("overflow:hidden"), "knowledge source groups should not hide tag overflow");
assert.ok(!sourceGroupsRule.includes("max-height"), "knowledge source groups should not use a clipping max-height");
const commonKnowledgeCellRule = adminConsoleCss.match(/\.data-table\.admin-common-table \.dt-row>span:nth-child\(7\),[\s\S]+?white-space:normal; \}/)?.[0] || "";
assert.ok(commonKnowledgeCellRule.includes("admin-creator-table"), "creator knowledge table cell should share wrapping rule");
assert.ok(commonKnowledgeCellRule.includes("admin-mascot-table"), "mascot knowledge table cell should share wrapping rule");
assert.ok(commonKnowledgeCellRule.includes("white-space:normal"), "knowledge table cells should allow wrapping");
const sourceGroupTagsRule = adminConsoleCss.match(/\.kb-source-group \.kb-tags\{[^}]+\}/)?.[0] || "";
assert.ok(sourceGroupTagsRule.includes("align-items:center"), "knowledge tags should not stretch folded count tags vertically");
assert.ok(sourceGroupTagsRule.includes("flex-wrap:wrap"), "knowledge tags should wrap inside table cells");
const tagTextRule = adminConsoleCss.match(/\.kb-source-group \.kb-tag span\{[^}]+\}/)?.[0] || "";
assert.ok(tagTextRule.includes("text-overflow:ellipsis"), "knowledge tag text should use ellipsis for long labels");
assert.ok(tagTextRule.includes("white-space:nowrap"), "knowledge tag text should stay on one line inside the tag");
const tagRule = adminConsoleCss.match(/\.kb-source-group \.kb-tag\{[^}]+\}/)?.[0] || "";
assert.ok(tagRule.includes("overflow:visible"), "knowledge tags should allow hover tooltips to show");
const tagTooltipRule = adminConsoleCss.match(/\.kb-source-group \.kb-tag\[data-kb-tag-tooltip\]::after,[\s\S]+?visibility:hidden; \}/)?.[0] || "";
assert.ok(tagTooltipRule.includes("max-width:260px"), "knowledge tag tooltip should have a readable max width");
assert.ok(adminConsoleCss.includes(".kb-source-group .kb-tag[data-kb-tag-tooltip]:hover::after"), "knowledge tag tooltip should appear on hover");
const moreTagRule = adminConsoleCss.match(/\.kb-source-group \.kb-tag-more\{[^}]+\}/)?.[0] || "";
assert.ok(moreTagRule.includes("justify-content:center"), "folded knowledge count should be centered inside the tag");
assert.ok(moreTagRule.includes("text-align:center"), "folded knowledge count should align centered as text");
assert.ok(moreTagRule.includes("flex:0 0 34px"), "folded knowledge count should keep compact tag width");
assert.ok(moreTagRule.includes("font-weight:600"), "folded knowledge count should use a lighter font weight");
assert.ok(moreTagRule.includes("overflow:visible"), "folded knowledge count should allow its tooltip to show");
const moreTooltipRule =
  adminConsoleCss
    .match(/\.kb-source-group \.kb-tag-more::after\{[^}]+\}/g)
    ?.find((rule) => rule.includes("content:attr(data-kb-more-tooltip)")) || "";
assert.ok(moreTooltipRule.includes("content:attr(data-kb-more-tooltip)"), "folded knowledge tooltip should list hidden knowledge names");
assert.ok(moreTooltipRule.includes("white-space:pre-line"), "folded knowledge tooltip should show one knowledge base per line");
assert.ok(moreTooltipRule.includes("text-align:left"), "folded knowledge tooltip should align single-column names clearly");
assert.ok(adminConsoleCss.includes(".kb-source-group .kb-tag-more:hover::after"), "folded knowledge tooltip should appear on hover");

console.log("admin character knowledge readonly display self-check passed");
