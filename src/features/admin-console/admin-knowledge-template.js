import { ICONS } from "../../icons/icons.js";
import { escapeAttr, escapeHtml, formatNumber } from "./admin-console-utils.js";
export { adminKnowledgeEditorHtml } from "./admin-knowledge-editor-template.js";

export function adminKnowledgeBaseHtml() {
  return `
    <div class="admin-body">
      <div class="admin-actions"><button class="btn btn-primary sm" type="button" data-kb-new>${ICONS.plus} 新建知识文档</button><div class="admin-search">${ICONS.search}<input data-kb-search placeholder="搜索知识库 / 分类 / 关键词..." /></div><div data-kb-category-filter></div></div>
      <div class="panel"><div class="data-table kb" data-kb-table>${adminKnowledgeTableHtml({ loading: true })}</div></div>
    </div>
  `;
}

export function adminKnowledgeTableHtml({ items = [], loading = false, error = "", query = "", category = "all", categories = [] } = {}) {
  if (loading) return `<div class="log-empty">正在加载知识库...</div>`;
  if (error) return `<div class="log-empty">${escapeHtml(error)}</div>`;
  const filteredItems = filterKnowledgeItems(items, { query, category });
  return `
    <div class="dt-head"><span>文档</span><span>分类</span><span>范围</span><span>优先级</span><span>绑定数</span><span>更新时间</span><span></span></div>
    ${filteredItems.length ? filteredItems.map(knowledgeRowHtml).join("") : `<div class="log-empty">暂无知识库</div>`}
  `;
}

const KNOWLEDGE_CATEGORY_LABELS = {
  customer_service: "客服话术",
  football: "足球",
  general: "通用",
};

const KNOWLEDGE_PRIORITY_OPTIONS = [
  { value: 100, label: "P0 · 最高" },
  { value: 80, label: "P1 · 高" },
  { value: 60, label: "P2 · 中高" },
  { value: 40, label: "P3 · 中" },
  { value: 20, label: "P4 · 低" },
  { value: 0, label: "P5 · 最低" },
];

function categoryLabel(category) {
  const value = String(category || "").trim();
  return KNOWLEDGE_CATEGORY_LABELS[value] || value || "通用";
}

function knowledgeRowHtml(item) {
  const doc = normalizeKnowledgeItem(item);
  return `<div class="dt-row" data-kb-id="${escapeAttr(doc.id)}"><span class="dt-cell name">${ICONS.chat}${escapeHtml(doc.label)}</span><span>${categoryTagHtml(doc.category)}</span><span>${scopeTagHtml(doc.scope)}</span><span>${escapeHtml(priorityLabel(doc.priority))}</span><span>${knowledgeBindingCountText(doc)}</span><span>${escapeHtml(formatDate(doc.updatedAt))}</span><span class="dt-act"><a data-kb-edit="${escapeAttr(doc.id)}">编辑</a><a class="danger" data-kb-delete="${escapeAttr(doc.id)}">删除</a></span></div>`;
}

function normalizeKnowledgeItem(item = {}) {
  return {
    id: item.id || "",
    label: item.label || item.name || "",
    category: item.category || "general",
    scope: normalizeKnowledgeScope(item.scope),
    status: item.status || item.knowledgeStatus || item.knowledge_status || "active",
    summary: item.summary || "",
    keywords: Array.isArray(item.keywords) ? item.keywords : [],
    fuzzyKeywords: Array.isArray(item.fuzzyKeywords) ? item.fuzzyKeywords : [],
    priority: Number(item.priority || 0),
    maxSections: Number(item.maxSections || 0),
    maxCharsPerSection: Number(item.maxCharsPerSection || 0),
    bindingCount: Number(item.bindingCount || 0),
    sections: Array.isArray(item.sections) ? item.sections : [],
    updatedAt: item.updatedAt || item.updated_at || "",
  };
}

function normalizeKnowledgeScope(scope) {
  const value = String(scope || "").trim();
  if (value === "global" || value === "site") return value;
  return "targeted";
}

function scopeLabel(scope) {
  const value = normalizeKnowledgeScope(scope);
  if (value === "global") return "全局通用";
  if (value === "site") return "指定站点";
  return "指定对象";
}

function scopeTagHtml(scope) {
  const value = normalizeKnowledgeScope(scope);
  return `<i class="knowledge-scope-pill is-${escapeAttr(value)}">${escapeHtml(scopeLabel(value))}</i>`;
}

function knowledgeBindingCountText(doc) {
  return normalizeKnowledgeScope(doc.scope) === "global" ? "-" : formatNumber(doc.bindingCount);
}

function categoryTagHtml(category) {
  const label = categoryLabel(category);
  const hue = categoryHue(category);
  return `<i class="pill knowledge-category-pill" style="--kb-cat-hue:${hue}">${escapeHtml(label)}</i>`;
}

function categoryHue(category) {
  const text = String(category || "general");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 360;
  return hash;
}

function priorityLabel(priority) {
  const value = closestKnowledgePriorityValue(priority);
  return KNOWLEDGE_PRIORITY_OPTIONS.find((item) => item.value === value)?.label || "P3 · 中";
}

function closestKnowledgePriorityValue(priority) {
  const value = Number(priority || 0);
  return KNOWLEDGE_PRIORITY_OPTIONS.reduce((closest, option) => {
    return Math.abs(option.value - value) < Math.abs(closest.value - value) ? option : closest;
  }, KNOWLEDGE_PRIORITY_OPTIONS[0]).value;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || "-";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function filterKnowledgeItems(items, { query, category }) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedCategory = String(category || "all");
  return items.filter((item) => {
    const doc = normalizeKnowledgeItem(item);
    if (normalizedCategory !== "all" && doc.category !== normalizedCategory) return false;
    if (!normalizedQuery) return true;
    const haystack = [doc.id, doc.label, doc.category, categoryLabel(doc.category), doc.summary, ...doc.keywords, ...doc.fuzzyKeywords].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
