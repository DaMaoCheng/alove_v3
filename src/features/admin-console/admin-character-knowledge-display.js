import { escapeAttr, escapeHtml } from "./admin-console-utils.js";

const MAX_VISIBLE_KNOWLEDGE_PER_GROUP = 2;

export function characterKnowledgeTagsHtml({ character = {}, knowledgeBases = [] } = {}) {
  const groups = getAvailableCharacterKnowledgeGroups({ character, knowledgeBases });
  const hasAny = groups.some((group) => group.items.length);
  if (!hasAny) return `<span class="muted-dash">-</span>`;
  return `
    <div class="kb-source-groups">
      ${groups.map((group) => knowledgeGroupHtml(group)).join("")}
    </div>
  `;
}

export function goKnowledgeButtonHtml(kind = "character") {
  return `<button class="btn btn-ghost sm admin-kb-link" type="button" data-admin-kb-link="${escapeAttr(kind)}">知识库管理</button>`;
}

export function bindKnowledgeManagementLinks(root) {
  root.querySelectorAll("[data-admin-kb-link]").forEach((button) => {
    button.addEventListener("click", () => {
      root.closest(".admin-shell")?.querySelector('[data-admin-view="kb"]')?.click();
    });
  });
}

export function getAvailableCharacterKnowledgeBases({ character = {}, knowledgeBases = [] } = {}) {
  return getAvailableCharacterKnowledgeGroups({ character, knowledgeBases }).flatMap((group) => group.items);
}

export function getAvailableCharacterKnowledgeGroups({ character = {}, knowledgeBases = [] } = {}) {
  const characterId = normalizeId(character.id);
  const siteId = normalizeId(character.siteId || character.site_id);
  const groups = [
    { key: "direct", label: "直接绑定", items: [] },
    { key: "site", label: "站点继承", items: [] },
    { key: "global", label: "全局通用", items: [] },
  ];
  for (const item of knowledgeBases) {
    const scope = normalizeScope(item.scope);
    if (scope === "global") {
      groups[2].items.push(item);
      continue;
    }
    if (scope === "site") {
      if (siteId && normalizeIdList([item.siteId, ...(item.siteIds || [])]).includes(siteId)) groups[1].items.push(item);
      continue;
    }
    if (characterId && normalizeIdList([...(item.characterIds || [])]).includes(characterId)) groups[0].items.push(item);
  }
  return groups;
}

function knowledgeGroupHtml(group) {
  if (!group.items.length) return "";
  const visibleItems = group.items.slice(0, MAX_VISIBLE_KNOWLEDGE_PER_GROUP);
  const hiddenItems = group.items.slice(visibleItems.length);
  const hiddenLabels = hiddenItems.map((item) => item.label || item.id).filter(Boolean);
  const tags = visibleItems
    .map((item) => item.label || item.id)
    .filter(Boolean)
    .map((label) => `<i class="kb-tag" title="${escapeAttr(label)}" data-kb-tag-tooltip="${escapeAttr(label)}"><span>${escapeHtml(label)}</span></i>`)
    .join("");
  const tooltip = hiddenLabels.join("\n");
  const more = hiddenLabels.length
    ? `<i class="kb-tag kb-tag-more" title="${escapeAttr(tooltip)}" data-kb-more-tooltip="${escapeAttr(tooltip)}"><span>+${hiddenLabels.length}</span></i>`
    : "";
  return `<div class="kb-source-group kb-source-${escapeAttr(group.key)}"><small>${escapeHtml(group.label)}</small><div class="kb-tags">${tags}${more}</div></div>`;
}

function normalizeScope(scope = "") {
  const value = String(scope || "").trim().toLowerCase();
  if (value === "global" || value === "site" || value === "targeted") return value;
  if (value === "role" || value === "character" || value === "object") return "targeted";
  return "targeted";
}

function normalizeIdList(values = []) {
  return Array.from(new Set((values || []).map(normalizeId).filter(Boolean)));
}

function normalizeId(value = "") {
  return String(value || "").trim();
}
