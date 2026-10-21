import { ICONS } from "../../icons/icons.js";
import { selectDropdownHtml } from "../shared-ui/dropdown.js";
import { escapeAttr, escapeHtml, formatNumber } from "./admin-console-utils.js";

const KNOWLEDGE_PRIORITY_OPTIONS = [
  { value: 100, label: "P0 · 最高" },
  { value: 80, label: "P1 · 高" },
  { value: 60, label: "P2 · 中高" },
  { value: 40, label: "P3 · 中" },
  { value: 20, label: "P4 · 低" },
  { value: 0, label: "P5 · 最低" },
];

const KNOWLEDGE_CATEGORY_LABELS = {
  customer_service: "客服话术",
  football: "足球",
  general: "通用",
};

export function adminKnowledgeEditorHtml(doc = {}, { categories = [], mode = "edit", sites = [], characters = [] } = {}) {
  const item = normalizeKnowledgeItem(doc);
  const categoryOptions = normalizeKnowledgeCategories([item.category, ...categories]);
  const isCreate = mode === "create";
  return `
    <div class="dialog-scrim" data-kb-editor-close></div>
    <div class="dlg common-character-modal knowledge-editor-modal" role="dialog" aria-modal="true">
      <button class="dlg-x" type="button" aria-label="Close" data-kb-editor-close>${ICONS.close}</button>
      <div class="dlg-body"><h3>${isCreate ? "新建知识文档" : "编辑知识库"}</h3></div>
      <form class="agent-form" data-kb-editor-form data-kb-id="${escapeAttr(item.id)}">
        <div class="knowledge-editor-head-row">
          <div></div>
          <div class="knowledge-editor-tags">${isCreate ? "" : `<span class="character-id-tag">${escapeHtml(item.id || "")}</span><span class="knowledge-binding-tag">绑定 ${formatNumber(item.bindingCount)} 个对象</span>`}</div>
        </div>
        <div class="agent-form-grid">
          <input type="hidden" name="id" value="${escapeAttr(item.id)}" />
          ${renderKnowledgeField("知识库名称", `<input name="label" value="${escapeAttr(item.label)}" />`)}
          ${renderKnowledgeField("分类", categoryComboHtml(item.category, categoryOptions))}
          ${renderKnowledgeField("精准关键词", `<input name="keywords" value="${escapeAttr(item.keywords.join(", "))}" />`)}
          ${renderKnowledgeField("模糊关键词", `<input name="fuzzyKeywords" value="${escapeAttr(item.fuzzyKeywords.join(", "))}" />`)}
          ${renderKnowledgeField("优先级", prioritySelectHtml(item.priority))}
          ${renderKnowledgeField("适用范围", knowledgeScopeSelectHtml(item.scope))}
          <div class="agent-field knowledge-scope-panel" data-kb-scope-panel="targeted" style="grid-column:1 / -1;"${item.scope === "targeted" ? "" : " hidden"}>
            <span>指定对象</span>
            ${knowledgeCharacterPickerHtml(characters, item.characterIds)}
          </div>
          <div class="agent-field knowledge-scope-panel" data-kb-scope-panel="site" style="grid-column:1 / -1;"${item.scope === "site" ? "" : " hidden"}>
            <span>指定站点</span>
            ${knowledgeSitePickerHtml(sites, item.siteIds)}
          </div>
          <div class="agent-field knowledge-scope-panel" data-kb-scope-panel="global" style="grid-column:1 / -1;"${item.scope === "global" ? "" : " hidden"}>
            <span>全局通用</span>
            <p class="knowledge-summary-text">保存后所有对象都可以在命中关键词时检索这个知识库。</p>
          </div>
          ${isCreate ? "" : `<div class="agent-field" style="grid-column:1 / -1;"><span>简介</span><p class="knowledge-summary-text">${escapeHtml(item.summary || "（空）")}</p></div>`}
          <label class="agent-field" style="grid-column:1 / -1;"><span>知识内容</span><textarea name="sections" rows="14">${escapeHtml(isCreate ? "" : fullKnowledgeContent(item.sections))}</textarea></label>
        </div>
        <div class="agent-form-actions"><button class="btn btn-primary sm" type="submit">保存</button>${isCreate ? "" : `<button class="btn btn-ghost sm" type="button" data-kb-editor-close>取消</button><span class="hint" data-kb-editor-tip>保存后更新知识库设置。</span>`}</div>
      </form>
    </div>
  `;
}

function renderKnowledgeField(label, control) {
  return `<label class="agent-field"><span>${escapeHtml(label)}</span>${control}</label>`;
}

function prioritySelectHtml(priority) {
  const selectedValue = closestKnowledgePriorityValue(priority);
  return selectDropdownHtml({
    name: "priority",
    value: String(selectedValue),
    items: KNOWLEDGE_PRIORITY_OPTIONS.map((option) => [String(option.value), option.label]),
    className: "agent-dd",
  });
}

function knowledgeScopeSelectHtml(scope) {
  return selectDropdownHtml({
    name: "scope",
    value: normalizeKnowledgeScope(scope),
    items: [
      ["targeted", "指定对象"],
      ["site", "指定站点"],
      ["global", "全局通用"],
    ],
    className: "agent-dd kb-scope-dd",
  }).replace("data-dd-input", "data-dd-input data-kb-scope-value");
}

function knowledgeCharacterPickerHtml(items = [], selectedIds = []) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  const normalizedItems = items.map(normalizeKnowledgeCharacterOption).filter((item) => item.id);
  return knowledgeMultiPickerHtml({
    type: "character",
    name: "characterIds",
    placeholder: "搜索对象名称或 ID",
    emptyText: "暂无可选对象",
    items: normalizedItems,
    selected,
  });
}

function knowledgeSitePickerHtml(items = [], selectedIds = []) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
  const normalizedItems = items.map((item) => ({
    id: String(item.id || item.characterId || item.siteId || "").trim(),
    label: item.name || item.label || item.slug || item.email || item.id || "",
    meta: item.slug ? `/${item.slug}` : item.type || "",
  })).filter((item) => item.id);
  return knowledgeMultiPickerHtml({
    type: "site",
    name: "siteIds",
    placeholder: "选择站点",
    emptyText: "暂无可选站点",
    items: normalizedItems,
    selected,
  });
}

function normalizeKnowledgeCharacterOption(item = {}) {
  const id = String(item.id || item.characterId || "").trim();
  const label = item.name || item.label || id;
  const categoryId = item.category?.id || item.categoryId || "";
  const categoryLabel = item.category?.label || item.categoryLabel || "";
  return {
    id,
    label,
    meta: [item.roleTitle || categoryLabel, id].filter(Boolean).join(" · "),
    avatarUrl: item.avatarUrl || item.avatar_url || "",
    type: categoryId === "mascot" ? "mascot" : "character",
    search: `${label} ${id} ${item.roleTitle || ""} ${categoryLabel}`.toLowerCase(),
  };
}

function knowledgeMultiPickerHtml({ type, name, placeholder, emptyText, items, selected }) {
  if (!items.length) return `<div class="knowledge-target-picker is-empty">${escapeHtml(emptyText)}</div>`;
  const selectedItems = items.filter((item) => selected.has(item.id));
  const hiddenInputs = selectedItems.map((item) => `<input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(item.id)}" data-kb-target-value />`).join("");
  const selectedTags = selectedItems.length
    ? selectedItems.map((item) => `<i class="knowledge-target-chip" data-kb-target-chip="${escapeAttr(item.id)}">${escapeHtml(item.label || item.id)}</i>`).join("")
    : `<span class="muted-dash" data-kb-target-empty>未选择</span>`;
  return `
    <div class="knowledge-target-picker" data-kb-target-picker="${escapeAttr(type)}" data-kb-target-name="${escapeAttr(name)}">
      <div data-kb-target-values>${hiddenInputs}</div>
      <div class="knowledge-target-current" data-kb-target-current>${selectedTags}</div>
      ${type === "character"
        ? `<input class="knowledge-target-search" type="search" placeholder="${escapeAttr(placeholder)}" autocomplete="off" data-kb-target-search />`
        : `<button class="knowledge-target-trigger" type="button" data-kb-target-trigger>${escapeHtml(placeholder)}</button>`}
      <div class="knowledge-target-menu" data-kb-target-menu>
        ${items.map((item) => knowledgeTargetOptionHtml(item, selected.has(item.id), type)).join("")}
      </div>
    </div>
  `;
}

function knowledgeTargetOptionHtml(item, active, type) {
  const avatar = type === "character"
    ? knowledgeTargetAvatarHtml(item)
    : `<span class="knowledge-target-site-dot"></span>`;
  return `
    <button class="knowledge-target-option ${active ? "is-active" : ""}" type="button" data-kb-target-option="${escapeAttr(item.id)}" data-kb-target-label="${escapeAttr(item.label || item.id)}" data-kb-target-search="${escapeAttr(item.search || `${item.label} ${item.id}`.toLowerCase())}" data-kb-target-type="${escapeAttr(item.type || type)}">
      ${avatar}
      <span><b>${escapeHtml(item.label || item.id)}</b><small>${escapeHtml(item.meta || item.id)}</small></span>
      ${active ? `<em>${ICONS.check || ""}</em>` : ""}
    </button>
  `;
}

function knowledgeTargetAvatarHtml(item) {
  if (item.avatarUrl) return `<img src="${escapeAttr(item.avatarUrl)}" alt="" />`;
  return `<span class="knowledge-target-avatar-letter">${escapeHtml(String(item.label || item.id || "K").slice(0, 1).toUpperCase())}</span>`;
}

function closestKnowledgePriorityValue(priority) {
  const value = Number(priority || 0);
  return KNOWLEDGE_PRIORITY_OPTIONS.reduce((closest, option) => {
    return Math.abs(option.value - value) < Math.abs(closest.value - value) ? option : closest;
  }, KNOWLEDGE_PRIORITY_OPTIONS[0]).value;
}

function categoryComboHtml(category, categories) {
  const visibleLabel = categoryLabel(category);
  const options = categories.map((item) => `<button class="dd-item" type="button" role="menuitem" data-kb-category-option="${escapeAttr(item.value)}" data-kb-category-label="${escapeAttr(item.label)}"><span class="dd-label">${escapeHtml(item.label)}</span></button>`).join("");
  return `
    <div class="knowledge-category-combo dd" data-kb-category-combo>
      <input type="hidden" name="category" value="${escapeAttr(category)}" data-kb-category-value />
      <input name="categoryLabel" value="${escapeAttr(visibleLabel)}" placeholder="输入或选择分类" autocomplete="off" data-kb-category-input />
      <div class="dd-menu dd-left" role="menu">${options}</div>
    </div>
  `;
}

function normalizeKnowledgeCategories(categories) {
  const seen = new Set();
  return categories.map((category) => String(category || "").trim()).filter(Boolean).map((value) => ({ value, label: categoryLabel(value) })).filter((item) => {
    const key = item.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categoryLabel(category) {
  const value = String(category || "").trim();
  return KNOWLEDGE_CATEGORY_LABELS[value] || value || "通用";
}

function normalizeKnowledgeItem(item = {}) {
  return {
    id: item.id || "",
    label: item.label || item.name || "",
    category: item.category || "general",
    scope: normalizeKnowledgeScope(item.scope),
    siteIds: Array.isArray(item.siteIds) ? item.siteIds : [],
    characterIds: Array.isArray(item.characterIds) ? item.characterIds : [],
    summary: item.summary || "",
    keywords: Array.isArray(item.keywords) ? item.keywords : [],
    fuzzyKeywords: Array.isArray(item.fuzzyKeywords) ? item.fuzzyKeywords : [],
    priority: Number(item.priority || 0),
    bindingCount: Number(item.bindingCount || 0),
    sections: Array.isArray(item.sections) ? item.sections : [],
  };
}

function normalizeKnowledgeScope(scope) {
  const value = String(scope || "").trim();
  if (value === "global" || value === "site") return value;
  return "targeted";
}

function fullKnowledgeContent(sections) {
  if (!sections.length) return "（空）";
  return sections.map((section, index) => {
    const title = section.title || section.key || `知识片段 ${index + 1}`;
    const content = String(section.content || section.summary || "").trim() || "（空）";
    return `${index + 1}. ${title}\n${content}`;
  }).join("\n\n");
}
