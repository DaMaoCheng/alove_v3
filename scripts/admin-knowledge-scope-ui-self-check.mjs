import { readFile } from "node:fs/promises";
import { adminKnowledgeEditorHtml, adminKnowledgeTableHtml } from "../src/features/admin-console/admin-knowledge-template.js";

const templateSource = await readFile(new URL("../src/features/admin-console/admin-knowledge-template.js", import.meta.url), "utf8");
const editorTemplateSource = await readFile(new URL("../src/features/admin-console/admin-knowledge-editor-template.js", import.meta.url), "utf8");
const controllerSource = await readFile(new URL("../src/features/admin-console/admin-knowledge-controller.js", import.meta.url), "utf8");
const editorSource = await readFile(new URL("../src/features/admin-console/admin-knowledge-editor.js", import.meta.url), "utf8");
const targetPickerSource = await readFile(new URL("../src/features/admin-console/admin-knowledge-target-picker.js", import.meta.url), "utf8");
const adminConsoleCss = [
  await readFile(new URL("../src/features/app-shell/styles/admin-console.css", import.meta.url), "utf8"),
  await readFile(new URL("../src/features/app-shell/styles/admin-knowledge.css", import.meta.url), "utf8"),
].join("\n");

const createHtml = adminKnowledgeEditorHtml({
  id: "",
  label: "",
  category: "football",
  scope: "targeted",
  keywords: [],
  fuzzyKeywords: [],
  priority: 40,
  sections: [],
  siteIds: [],
  characterIds: [],
}, {
  mode: "create",
  categories: ["football"],
  sites: [{ id: "site_gg", name: "GG", slug: "gogoalshop" }],
  characters: [
    { id: "mascot_template", name: "Kit", roleTitle: "Mascot", avatarUrl: "/assets/char_coach.png", category: { id: "mascot", label: "前台" } },
    { id: "char_tactic", name: "Tactic Joe", roleTitle: "Analyst", category: { id: "pundit", label: "解说" } },
  ],
});

assert(createHtml.includes('name="scope"'), "scope field should render");
assert(createHtml.includes('value="targeted"'), "create modal should default to targeted scope");
assert(/data-kb-scope-panel="targeted"[^>]*>/.test(createHtml), "targeted panel should render");
assert(/data-kb-scope-panel="site"[^>]*hidden/.test(createHtml), "site panel should be hidden for targeted scope");
assert(/data-kb-scope-panel="global"[^>]*hidden/.test(createHtml), "global panel should be hidden for targeted scope");
assert(createHtml.includes('data-kb-target-picker="character"'), "character binding should render searchable picker");
assert(createHtml.includes('data-kb-target-search'), "character picker should render search input");
assert(createHtml.includes('data-kb-target-type="mascot"'), "character picker should mark mascot options");
assert(createHtml.includes('data-kb-target-type="character"'), "character picker should include searchable non-mascot options");
assert(createHtml.includes('data-kb-target-picker="site"'), "site binding should render dropdown picker");
assert(createHtml.includes('data-kb-target-trigger'), "site picker should open on click");
assert(createHtml.includes("mascot_template"), "character option should include id");
assert(createHtml.includes("char_tactic"), "searchable character option should include id");
assert(createHtml.includes("site_gg"), "site option should include id");

const siteScopeHtml = adminKnowledgeEditorHtml({
  id: "kb_site",
  label: "Site KB",
  category: "football",
  scope: "site",
  siteIds: ["site_gg"],
  characterIds: [],
  keywords: [],
  fuzzyKeywords: [],
  priority: 40,
  sections: [],
}, {
  mode: "edit",
  categories: ["football"],
  sites: [{ id: "site_gg", name: "GG", slug: "gogoalshop" }],
  characters: [{ id: "mascot_template", name: "Kit", roleTitle: "Mascot", category: { id: "mascot", label: "前台" } }],
});
assert(/data-kb-scope-panel="targeted"[^>]*hidden/.test(siteScopeHtml), "targeted panel should be hidden for site scope");
assert(/data-kb-scope-panel="site"[^>]*>/.test(siteScopeHtml), "site panel should be visible for site scope");
assert(/data-kb-scope-panel="global"[^>]*hidden/.test(siteScopeHtml), "global panel should be hidden for site scope");
assert(siteScopeHtml.includes('name="siteIds" value="site_gg"'), "site picker should submit selected site hidden input");

const tableHtml = adminKnowledgeTableHtml({
  items: [{
    id: "kb_football",
    label: "Football KB",
    category: "football",
    scope: "global",
    priority: 80,
    bindingCount: 0,
  }],
});
assert(tableHtml.includes("范围"), "knowledge table should include scope header");
assert(tableHtml.includes("全局通用"), "knowledge table should render global scope label");
assert(tableHtml.includes("knowledge-scope-pill is-global"), "knowledge table should render colored global scope pill");
assert(!tableHtml.includes("pill knowledge-scope-pill"), "knowledge scope pill should not use the generic pill class");
assert(/<span>-<\/span>/.test(tableHtml), "global knowledge row should show dash in binding count column");

const targetedTableHtml = adminKnowledgeTableHtml({
  items: [{
    id: "kb_targeted",
    label: "Targeted KB",
    category: "football",
    scope: "targeted",
    priority: 80,
    bindingCount: 2,
  }],
});
assert(targetedTableHtml.includes("knowledge-scope-pill is-targeted"), "knowledge table should render colored targeted scope pill");
assert(!targetedTableHtml.includes("pill knowledge-scope-pill"), "targeted scope pill should not use the generic pill class");
assert(targetedTableHtml.includes("<span>2</span>"), "targeted knowledge row should show binding count");

assert(controllerSource.includes("listAdminSites"), "knowledge controller should load sites for bindings");
assert(controllerSource.includes("listAdminCharacters"), "knowledge controller should load characters for bindings");
assert(editorSource.includes("data-kb-scope-value"), "knowledge editor should bind scope switching");
assert(editorSource.includes("bindKnowledgeTargetPickers"), "knowledge editor should bind target pickers");
assert(targetPickerSource.includes("escapeAttr, escapeHtml"), "knowledge target picker should import both attr and html escaping helpers");
assert(targetPickerSource.includes("selectOption(option);"), "target picker should select on mousedown before focusout closes the menu");
assert(targetPickerSource.includes('option.dataset.kbTargetType === "mascot"'), "empty character picker should default to mascot options");
assert(templateSource.includes('export { adminKnowledgeEditorHtml } from "./admin-knowledge-editor-template.js";'), "table template should re-export editor template");
assert(editorTemplateSource.includes("knowledgeCharacterPickerHtml"), "editor template should use character picker helper");
assert(!templateSource.includes("knowledgeTargetChecklistHtml"), "template should not use old checkbox checklist helper");
assert(adminConsoleCss.includes(".knowledge-scope-panel[hidden]{ display:none !important; }"), "hidden scope panels should override agent-field display flex");
assert(adminConsoleCss.includes(".knowledge-target-option[hidden]{ display:none !important; }"), "hidden target options should override option display grid");
assert(adminConsoleCss.includes(".knowledge-target-site-dot{ width:7px; height:7px;"), "site option dot should stay compact");
assert(adminConsoleCss.includes(".data-table.kb .dt-row>span:nth-child(2),.data-table.kb .dt-row>span:nth-child(3){ overflow:visible; }"), "knowledge scope column should not clip scope pills");
assert(adminConsoleCss.includes(".data-table.kb .knowledge-scope-pill{ display:inline-flex; align-items:center; justify-content:center; min-width:74px;"), "knowledge scope pills should have stable full-width layout");
assert(adminConsoleCss.includes("font-style:normal; font-size:11px;"), "knowledge scope pill text should keep the original non-italic small label typography");
assert(adminConsoleCss.includes(".data-table.kb .knowledge-scope-pill.is-targeted{ background:#158c46; color:#fff; }"), "targeted scope pill should use solid background");
assert(adminConsoleCss.includes(".data-table.kb .knowledge-scope-pill.is-site{ background:#b58113; color:#fff; }"), "site scope pill should use solid background");
assert(adminConsoleCss.includes(".data-table.kb .knowledge-scope-pill.is-global{ background:#4264c7; color:#fff; }"), "global scope pill should use solid background");
assert(adminConsoleCss.includes(".knowledge-category-pill{ color:hsl(var(--kb-cat-hue),72%,62%);"), "category pill style should remain separate from scope pills");

console.log("admin knowledge scope UI self-check passed");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
