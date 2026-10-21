import { createId } from "./security.js";
import { KNOWLEDGE_SCOPES, normalizeKnowledgeBindings, normalizeKnowledgeScope } from "./knowledge-scope-service.js";
import { createPublicError } from "./public-error-utils.js";

export function normalizeKnowledgeBasePayload(payload = {}) {
  const id = normalizeId(payload.id);
  if (!id) throwUserError("知识库 ID 不能为空");
  const label = safeString(payload.label || payload.name).slice(0, 128);
  if (!label) throwUserError("知识库名称不能为空");

  return {
    id,
    label,
    summary: nullableText(payload.summary, 65535),
    category: safeString(payload.category || "general").slice(0, 64) || "general",
    scope: normalizeKnowledgeScope(payload.scope, KNOWLEDGE_SCOPES.TARGETED),
    siteId: nullableText(payload.siteId || payload.site_id, 64),
    status: normalizeOneOf(payload.status || payload.knowledgeStatus || payload.knowledge_status, ["active", "draft", "inactive"], "active"),
    language: nullableText(payload.language, 64),
    priority: normalizeInt(payload.priority, 50),
    maxSections: Math.max(1, normalizeInt(payload.maxSections || payload.max_sections, 6)),
    maxCharsPerSection: Math.max(200, normalizeInt(payload.maxCharsPerSection || payload.max_chars_per_section, 1200)),
    keywords: normalizeStringArray(payload.keywords),
    fuzzyKeywords: normalizeStringArray(payload.fuzzyKeywords || payload.fuzzy_keywords),
    sourceType: safeString(payload.sourceType || payload.source_type || "manual").slice(0, 32) || "manual",
    sourceRef: nullableText(payload.sourceRef || payload.source_ref, 512),
    bindings: normalizeKnowledgeBindings(payload, payload.scope),
  };
}

export function normalizeKnowledgeCreatePayload(payload = {}) {
  const label = safeString(payload.label || payload.name).slice(0, 128);
  if (!label) throwUserError("知识库名称不能为空");
  const sourceText = safeString(payload.sourceText || payload.content || payload.sections);
  if (!sourceText || sourceText.length < 20) throwUserError("知识内容太短，至少补充到 20 个字");
  return {
    id: normalizeId(payload.id) || createId("kb"),
    label,
    category: safeString(payload.category || "general").slice(0, 64) || "general",
    scope: normalizeKnowledgeScope(payload.scope, KNOWLEDGE_SCOPES.TARGETED),
    priority: normalizeInt(payload.priority, 40),
    keywords: normalizeStringArray(payload.keywords),
    fuzzyKeywords: normalizeStringArray(payload.fuzzyKeywords || payload.fuzzy_keywords),
    bindings: normalizeKnowledgeBindings(payload, payload.scope),
    sourceText,
  };
}

export function normalizeKnowledgeUpdatePayload(payload = {}) {
  const label = safeString(payload.label || payload.name).slice(0, 128);
  if (!label) throwUserError("知识库名称不能为空");
  const sourceText = safeString(payload.sourceText || payload.content || payload.sections);
  if (!sourceText || sourceText.length < 20) throwUserError("知识内容太短，至少补充到 20 个字");
  const hasAccessPayload = hasKnowledgeAccessPayload(payload);
  const scope = hasAccessPayload ? normalizeKnowledgeScope(payload.scope, KNOWLEDGE_SCOPES.TARGETED) : "";
  return {
    label,
    category: safeString(payload.category || "general").slice(0, 64) || "general",
    scope,
    priority: normalizeInt(payload.priority, 40),
    keywords: normalizeStringArray(payload.keywords),
    fuzzyKeywords: normalizeStringArray(payload.fuzzyKeywords || payload.fuzzy_keywords),
    bindings: hasAccessPayload ? normalizeKnowledgeBindings(payload, scope) : null,
    sourceText,
  };
}

export function normalizeManualSections(sourceText, existingSections = []) {
  const chunks = splitManualSourceText(sourceText, existingSections);
  const parts = chunks.length ? chunks : [safeString(sourceText)];
  return ensureUniqueSectionKeys(parts.map((content, index) => {
    const existing = existingSections[index] || {};
    const title = safeString(existing.title || inferSectionTitle(content, index)).slice(0, 255);
    return {
      key: normalizeSectionKey(existing.key || title, index),
      title,
      summary: existing.summary || nullableText(content.slice(0, 180), 65535),
      content,
      keywords: existing.keywords || [],
      fuzzyKeywords: existing.fuzzyKeywords || [],
      order: (index + 1) * 10,
      status: "active",
      sourceHeading: title,
    };
  }));
}

export function normalizeAiSections(sections, fallbackContent) {
  const normalized = Array.isArray(sections)
    ? sections.map((section, index) => {
        const title = safeString(section.title || `知识片段 ${index + 1}`).slice(0, 255);
        const content = safeString(section.content);
        if (!title || !content) return null;
        return {
          key: normalizeSectionKey(section.key || title, index),
          title,
          summary: nullableText(section.summary, 65535),
          content,
          keywords: normalizeStringArray(section.exactKeywords || section.keywords),
          fuzzyKeywords: normalizeStringArray(section.fuzzyKeywords || section.fuzzy_keywords),
          order: normalizeInt(section.order, (index + 1) * 10),
          status: "active",
          sourceHeading: nullableText(section.title || title, 255),
        };
      }).filter(Boolean)
    : [];
  if (normalized.length) return ensureUniqueSectionKeys(normalized);
  return [{
    key: "section_1",
    title: "知识内容",
    summary: "自动生成知识片段失败时保留的原始正文。",
    content: safeString(fallbackContent),
    keywords: [],
    fuzzyKeywords: [],
    order: 10,
    status: "active",
    sourceHeading: "知识内容",
  }];
}

export function normalizeSections(sections) {
  if (!Array.isArray(sections)) return [];
  return ensureUniqueSectionKeys(sections
    .map((section, index) => {
      const title = safeString(section.title).slice(0, 255);
      const content = safeString(section.content);
      if (!title || !content) return null;
      return {
        id: normalizeId(section.id),
        key: normalizeSectionKey(section.key || section.sectionKey || title, index),
        title,
        summary: nullableText(section.summary, 65535),
        content,
        keywords: normalizeStringArray(section.keywords),
        fuzzyKeywords: normalizeStringArray(section.fuzzyKeywords || section.fuzzy_keywords),
        order: normalizeInt(section.order || section.displayOrder || section.display_order, (index + 1) * 10),
        status: normalizeOneOf(section.status || section.sectionStatus || section.section_status, ["active", "draft", "inactive"], "active"),
        sourceHeading: nullableText(section.sourceHeading || section.source_heading || title, 255),
      };
    })
    .filter(Boolean));
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map(safeString).filter(Boolean).slice(0, 80);
  return safeString(value)
    .split(/[,，\n]/)
    .map(safeString)
    .filter(Boolean)
    .slice(0, 80);
}

export function normalizeId(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export function normalizeSectionKey(value, index) {
  const key = normalizeId(value).slice(0, 96);
  return isSeparatorOnlyKey(key) ? `section_${index + 1}` : key || `section_${index + 1}`;
}

export function normalizeOneOf(value, allowed, fallback) {
  const normalized = safeString(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function normalizeInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(number);
}

export function nullableText(value, maxLength) {
  const normalized = safeString(value).slice(0, maxLength);
  return normalized || null;
}

export function safeString(value) {
  return String(value == null ? "" : value).trim();
}

export function throwUserError(message) {
  throw createPublicError(message, 400);
}

export function throwNotFound() {
  throw createPublicError("知识库不存在", 404);
}

function inferSectionTitle(content, index) {
  const firstLine = safeString(content).split("\n").map(safeString).find(Boolean) || "";
  return firstLine.replace(/^\d+[.、]\s*/, "").slice(0, 40) || `知识片段 ${index + 1}`;
}

function splitManualSourceText(sourceText, existingSections = []) {
  const source = safeString(sourceText);
  const existing = Array.isArray(existingSections) ? existingSections : [];
  const markerChunks = splitByExistingSectionMarkers(source, existing);
  if (markerChunks.length) return markerChunks;
  return source
    .split(/\n{2,}/)
    .map(safeString)
    .filter(isMeaningfulManualChunk);
}

function splitByExistingSectionMarkers(sourceText, existingSections = []) {
  const source = safeString(sourceText);
  if (!source || !existingSections.length) return [];
  const lines = source.split(/\r?\n/);
  const markerIndexes = [];

  existingSections.forEach((section, index) => {
    const marker = `${index + 1}. ${safeString(section.title || section.key || `知识片段 ${index + 1}`)}`;
    const lineIndex = lines.findIndex((line, currentIndex) => currentIndex >= (markerIndexes.at(-1)?.lineIndex ?? -1) && safeString(line) === marker);
    if (lineIndex >= 0) markerIndexes.push({ sectionIndex: index, lineIndex });
  });

  if (markerIndexes.length < 2) return [];

  return markerIndexes.map((marker, index) => {
    const next = markerIndexes[index + 1];
    return lines.slice(marker.lineIndex, next ? next.lineIndex : lines.length).join("\n").trim();
  }).filter(isMeaningfulManualChunk);
}

function ensureUniqueSectionKeys(sections = []) {
  const seen = new Set();
  return sections.map((section, index) => {
    const baseKey = normalizeSectionKey(section.key || section.title, index).slice(0, 96);
    let key = baseKey;
    let suffix = 2;
    while (seen.has(key)) {
      const suffixText = `_${suffix}`;
      key = `${baseKey.slice(0, Math.max(1, 96 - suffixText.length))}${suffixText}`;
      suffix += 1;
    }
    seen.add(key);
    return { ...section, key };
  });
}

function isMeaningfulManualChunk(value) {
  const text = safeString(value);
  if (!text) return false;
  return !/^[-_=*#\s]+$/.test(text);
}

function isSeparatorOnlyKey(value) {
  return /^[-_]+$/.test(safeString(value));
}

function hasKnowledgeAccessPayload(payload = {}) {
  return [
    "scope",
    "siteId",
    "site_id",
    "siteIds",
    "site_ids",
    "bindingSiteIds",
    "binding_site_ids",
    "targetIds",
    "target_ids",
    "characterIds",
    "character_ids",
    "bindingCharacterIds",
    "binding_character_ids",
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}
