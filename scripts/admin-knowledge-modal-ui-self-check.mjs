import { readFileSync } from "node:fs";
import { adminKnowledgeBaseHtml, adminKnowledgeEditorHtml, adminKnowledgeTableHtml } from "../src/features/admin-console/admin-knowledge-template.js";

const tableHtml = adminKnowledgeBaseHtml();
const rowsHtml = adminKnowledgeTableHtml({ items: [{ id: "kb_test", label: "Test KB", category: "customer_service", priority: 85, bindingCount: 3, updatedAt: "2026-06-14T12:00:00.000Z" }] });
const modalHtml = adminKnowledgeEditorHtml({
  id: "kb_test",
  label: "Test KB",
  category: "customer_service",
  bindingCount: 3,
  summary: "AI generated summary",
  keywords: ["客服", "物流"],
  fuzzyKeywords: ["售后", "退款"],
  sections: [{ title: "Test section", summary: "Section summary", content: "Full knowledge content line 1\nFull knowledge content line 2" }],
}, { categories: ["customer_service", "football", "VIP客户"] });
const highPriorityModalHtml = adminKnowledgeEditorHtml({ id: "kb_priority", label: "Priority KB", priority: 85 });
const createModalHtml = adminKnowledgeEditorHtml({ id: "", label: "", category: "general", priority: 40, sections: [] }, { categories: ["customer_service", "football"], mode: "create" });
const adminCss = [
  readFileSync("src/features/app-shell/styles/admin-console.css", "utf8"),
  readFileSync("src/features/app-shell/styles/admin-knowledge.css", "utf8"),
].join("\n");
const controllerSource = readFileSync("src/features/admin-console/admin-knowledge-controller.js", "utf8");
const editorSource = readFileSync("src/features/admin-console/admin-knowledge-editor.js", "utf8");

const mustInclude = (html, text, label = text) => {
  if (!html.includes(text)) {
    throw new Error(`Missing ${label}`);
  }
};

mustInclude(tableHtml, "data-table kb", "knowledge table");
mustInclude(tableHtml, "data-kb-table", "knowledge table host");
mustInclude(tableHtml, "data-kb-search", "knowledge search input");
mustInclude(tableHtml, "data-kb-category-filter", "knowledge category filter host");
mustInclude(tableHtml, "data-kb-new", "new knowledge button binding");
mustInclude(tableHtml, "新建知识文档", "new knowledge button label");
if (tableHtml.includes("上传文档")) throw new Error("Knowledge button should be 新建知识文档, not 上传文档");
if (tableHtml.includes("data-kb-workspace") || tableHtml.includes("kb-workbench")) {
  throw new Error("Knowledge page must keep the original table layout, not the workbench layout");
}

mustInclude(rowsHtml, "data-kb-edit", "edit action binding");
mustInclude(rowsHtml, ">编辑<", "edit action label");
mustInclude(rowsHtml, "data-kb-delete", "delete action binding");
mustInclude(rowsHtml, ">删除<", "delete action label");
mustInclude(rowsHtml, "class=\"danger\" data-kb-delete", "delete action danger style");
mustInclude(rowsHtml, "文档", "table document column");
mustInclude(rowsHtml, "分类", "table category column");
mustInclude(rowsHtml, "优先级", "table priority column");
mustInclude(rowsHtml, "绑定数", "table binding count column");
mustInclude(rowsHtml, "knowledge-category-pill", "category color tag");
mustInclude(rowsHtml, "P1 · 高", "priority column value");
mustInclude(rowsHtml, ">3<", "binding count value");
if (rowsHtml.includes(">打开<")) {
  throw new Error("Knowledge row action should be 编辑, not 打开");
}
["片段", "状态"].forEach((field) => {
  if (rowsHtml.includes(`<span>${field}</span>`)) throw new Error(`Knowledge table should not include ${field} column`);
});

[
  "知识库名称",
  "分类",
  "简介",
  "精准关键词",
  "模糊关键词",
  "优先级",
  "适用范围",
  "知识内容",
].forEach((field) => mustInclude(modalHtml, field));

["绑定对象", "选择绑定对象", "片段预览", "适用站点", "状态", "最大召回段数", "单段最大字数"].forEach((field) => {
  if (modalHtml.includes(field)) throw new Error(`${field} should be hidden from the main editor`);
});
["修改后会同步保存到知识库设置。", "填写后保存为新的知识库文档。", "<b>Test KB</b>", "<small>客服话术</small>"].forEach((text) => {
  if (modalHtml.includes(text) || createModalHtml.includes(text)) throw new Error(`Knowledge editor header should not include ${text}`);
});

mustInclude(modalHtml, "data-kb-editor-close", "modal close binding");
mustInclude(modalHtml, "data-kb-editor-form", "modal form binding");
mustInclude(modalHtml, "knowledge-editor-head-row", "knowledge editor head row");
mustInclude(modalHtml, "character-id-tag", "knowledge id tag");
mustInclude(modalHtml, "<span class=\"character-id-tag\">kb_test</span>", "knowledge id tag value");
mustInclude(modalHtml, "绑定 3 个对象", "modal binding count tag");
mustInclude(modalHtml, "type=\"hidden\" name=\"id\" value=\"kb_test\"", "hidden knowledge id input");
mustInclude(modalHtml, "data-kb-category-combo", "category combo wrapper");
mustInclude(modalHtml, "data-kb-category-input", "category editable input");
mustInclude(modalHtml, "data-kb-category-value", "category hidden value");
mustInclude(modalHtml, "name=\"categoryLabel\" value=\"客服话术\"", "translated category visible value");
mustInclude(modalHtml, "name=\"category\" value=\"customer_service\"", "raw category hidden value");
mustInclude(modalHtml, "客服话术", "translated customer service category");
mustInclude(modalHtml, "足球", "translated football category");
mustInclude(modalHtml, "name=\"label\" value=\"Test KB\"", "editable knowledge name");
mustInclude(modalHtml, "name=\"keywords\" value=\"客服, 物流\"", "editable keywords");
mustInclude(modalHtml, "name=\"fuzzyKeywords\" value=\"售后, 退款\"", "editable fuzzy keywords");
mustInclude(modalHtml, "knowledge-summary-text", "plain AI summary text block");
mustInclude(modalHtml, "AI generated summary", "AI summary text content");
if (modalHtml.includes('name="summary"')) {
  throw new Error("Edit knowledge summary should be plain text, not a textarea/input field");
}
if (modalHtml.includes('name="label" value="Test KB" readonly') || modalHtml.includes('name="keywords" value="客服, 物流" readonly') || modalHtml.includes('name="fuzzyKeywords" value="售后, 退款" readonly')) {
  throw new Error("Knowledge name and keyword fields should be editable");
}
if (!highPriorityModalHtml.includes("dd-select") || highPriorityModalHtml.includes("<select name=\"priority\"")) {
  throw new Error("Priority should use the shared dropdown style");
}
mustInclude(modalHtml, "Full knowledge content line 1", "full knowledge content first line");
mustInclude(modalHtml, "Full knowledge content line 2", "full knowledge content second line");
if (modalHtml.includes('value="customer_service" placeholder="输入或选择分类"')) {
  throw new Error("Visible category input should show translated category label, not raw key");
}
mustInclude(highPriorityModalHtml, "name=\"priority\"", "priority select name");
mustInclude(highPriorityModalHtml, "P0 · 最高", "P0 priority option");
mustInclude(highPriorityModalHtml, "P5 · 最低", "P5 priority option");
mustInclude(highPriorityModalHtml, "name=\"priority\" value=\"80\"", "priority hidden value maps to P1");
mustInclude(highPriorityModalHtml, "P1 · 高", "P1 priority current label");
if (highPriorityModalHtml.includes('name="priority" type="number"')) {
  throw new Error("Priority should use P0-P5 select, not a raw number input");
}
mustInclude(createModalHtml, "新建知识文档", "create modal title");
mustInclude(createModalHtml, "<button class=\"btn btn-primary sm\" type=\"submit\">保存</button>", "create modal save button");
if (createModalHtml.includes("<span>简介</span>") || createModalHtml.includes('name="summary"')) {
  throw new Error("Create knowledge modal should not show the AI-generated summary field");
}
if (modalHtml.includes("停用") || createModalHtml.includes("停用") || createModalHtml.includes("取消</button>")) {
  throw new Error("Create knowledge modal should only show the save action at the bottom");
}
mustInclude(createModalHtml, '<textarea name="sections" rows="14"></textarea>', "create knowledge content should start empty");
if (modalHtml.includes('name="sections" rows="14" readonly')) {
  throw new Error("Edit knowledge content should be editable when the save API is connected");
}
mustInclude(adminCss, ".data-table.kb .dt-head,.data-table.kb .dt-row{ grid-template-columns:minmax(180px,1.6fr) minmax(92px,.66fr) minmax(108px,.74fr) minmax(76px,.5fr) minmax(62px,.42fr) minmax(78px,.5fr) minmax(68px,.4fr); }", "seven-column knowledge table layout");
mustInclude(adminCss, ".data-table.kb .dt-row{ padding-top:14px; padding-bottom:14px; min-height:52px; }", "knowledge table row height");
mustInclude(adminCss, ".data-table.kb .dt-act{ justify-content:flex-start; }", "knowledge edit action left aligned");
mustInclude(adminCss, ".data-table.kb .dt-row>span:nth-child(2),.data-table.kb .dt-row>span:nth-child(3){ overflow:visible; }", "knowledge category and scope tag visible overflow");
mustInclude(adminCss, ".data-table.kb .knowledge-category-pill{ display:inline-flex; align-items:center; max-width:100%; min-height:24px; line-height:1; box-sizing:border-box; }", "knowledge category pill full height");
mustInclude(adminCss, ".data-table.kb .knowledge-scope-pill{ display:inline-flex; align-items:center; justify-content:center; min-width:74px; min-height:24px; box-sizing:border-box; padding:5px 10px; border:0; border-radius:7px; font-style:normal; font-size:11px; line-height:1; color:#fff; font-weight:700; white-space:nowrap; }", "knowledge scope pill solid full height");
mustInclude(adminCss, ".knowledge-summary-text{ min-height:42px; box-sizing:border-box; margin:0; padding:10px 12px; border-radius:10px; background:var(--tile); color:var(--ink-2); font-size:13.5px; line-height:1.55; white-space:pre-wrap; }", "plain summary text styling");
mustInclude(adminCss, ".kb-filter-dd .dd-select-trigger", "knowledge filter height override");
mustInclude(adminCss, ".knowledge-ai-wait-host{ z-index:10020 !important; }", "knowledge AI waiting modal z-index");
mustInclude(controllerSource, "createAdminKnowledgeBase(readCreatePayload(form))", "create knowledge API call");
mustInclude(controllerSource, "updateAdminKnowledgeBase(knowledgeBaseId, readKnowledgePayload(form))", "update knowledge API call");
mustInclude(controllerSource, "deleteAdminKnowledgeBase(knowledgeBaseId)", "delete knowledge API call");
mustInclude(controllerSource, "确认删除知识库", "delete knowledge confirmation dialog");
if (controllerSource.includes("知识库编辑保存接口稍后接入")) {
  throw new Error("Edit knowledge save should call the real update API, not the placeholder toast");
}
mustInclude(controllerSource, "openKnowledgeAiWaitModal", "knowledge AI wait modal binding");
mustInclude(editorSource, "AI 正在生成简介、目录和知识片段...", "knowledge AI wait modal text");
mustInclude(editorSource, "knowledge-ai-wait-host", "knowledge AI wait host class");

console.log("admin knowledge modal ui self-check passed");
