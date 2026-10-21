import assert from "node:assert/strict";
import {
  adminMascotBodyHtml,
  mascotEditorModalHtml,
} from "../src/features/admin-console/admin-console-mascot-template.js";

const knowledgeBases = [
  { id: "kb_global", label: "Global football", scope: "global" },
  { id: "kb_site_gg", label: "GG site football", scope: "site", siteIds: ["site_gg"] },
  { id: "kb_site_fkk", label: "FKK site football", scope: "site", siteIds: ["site_fkk"] },
  { id: "kb_template", label: "Template-only football", scope: "targeted", characterIds: ["mascot_template"] },
  { id: "kb_millie", label: "Millie-only football", scope: "targeted", characterIds: ["mascot_millie"] },
];

const template = {
  id: "mascot_template",
  name: "Kit",
  greeting: "Hello",
  knowledge: ["kb_legacy_missing"],
  source: "通用模板",
};

const sites = [
  {
    id: "site_gg",
    name: "GG",
    slug: "gogoalshop",
    defaultLanguage: "English",
    mascotCharacterId: "mascot_template",
    mascot: { ...template, source: "通用模板" },
  },
  {
    id: "site_fkk",
    name: "FKK",
    slug: "footballkituk",
    defaultLanguage: "English",
    mascotCharacterId: "mascot_millie",
    productApiUrl: "shopify-admin://fbed87-94.myshopify.com",
    userCount: 3,
    sentAdCount: 1,
    mascot: {
      id: "mascot_millie",
      name: "Millie",
      greeting: "Hi",
      knowledge: [],
      source: "本站专属",
    },
  },
];

const pageHtml = adminMascotBodyHtml({ template, sites, knowledgeBases, loading: false });
assert.ok(pageHtml.includes("知识库绑定统一在知识库页面管理"), "mascot page should state knowledge binding is centralized");
assert.ok(pageHtml.includes("Global football"), "global knowledge should display for template and mascot rows");
assert.ok(pageHtml.includes("Template-only football"), "targeted template knowledge should display for template");
assert.ok(pageHtml.includes("FKK site football"), "site-scoped knowledge should display for matching site row");
assert.ok(pageHtml.includes("Millie-only football"), "targeted mascot knowledge should display for matching mascot row");
assert.ok(!pageHtml.includes("GG site football"), "inherited template site should not render as separate site row");

const templateModalHtml = mascotEditorModalHtml({ mascot: template, mode: "template", knowledgeBases });
assert.ok(templateModalHtml.includes("mascot-kb-readonly"), "editor should render readonly knowledge block");
assert.ok(templateModalHtml.includes("绑定/解绑请到知识库页面修改"), "editor should point edits to knowledge page");
assert.ok(templateModalHtml.includes('type="hidden" name="knowledgeText"'), "editor should keep hidden knowledgeText for compatibility");
assert.ok(!templateModalHtml.includes("data-mascot-kb-select"), "editor should not render knowledge selector");
assert.ok(!templateModalHtml.includes("data-mascot-kb-option"), "editor should not render selectable knowledge options");

const siteModalHtml = mascotEditorModalHtml({ mascot: sites[1].mascot, site: sites[1], sites, mode: "site", knowledgeBases });
assert.ok(siteModalHtml.includes("FKK site football"), "site editor should show matching site knowledge");
assert.ok(siteModalHtml.includes("Millie-only football"), "site editor should show matching mascot knowledge");
assert.ok(!siteModalHtml.includes("Template-only football"), "site editor should not show unrelated targeted knowledge");

console.log(JSON.stringify({
  ok: true,
  checked: "admin mascot readonly knowledge display",
}, null, 2));
