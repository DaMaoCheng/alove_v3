import { normalizeKnowledgeScope } from "./knowledge-scope-service.js";

export function mapKnowledgeBaseRow(row) {
  return {
    id: row.id,
    label: row.label || "",
    summary: row.summary || "",
    category: row.category || "general",
    scope: normalizeKnowledgeScope(row.scope, "targeted"),
    siteId: row.site_id || "",
    status: row.knowledge_status || "active",
    language: row.language || "",
    priority: Number(row.priority || 0),
    maxSections: Number(row.max_sections || 0),
    maxCharsPerSection: Number(row.max_chars_per_section || 0),
    keywords: parseJsonArray(row.keywords_json),
    fuzzyKeywords: parseJsonArray(row.fuzzy_keywords_json),
    sectionCount: Number(row.section_count || 0),
    contentChars: Number(row.content_chars || 0),
    bindingCount: Number(row.binding_count || 0),
    siteIds: Array.isArray(row.siteIds) ? row.siteIds : (Array.isArray(row.site_ids) ? row.site_ids : parseCsv(row.site_ids_csv)),
    characterIds: Array.isArray(row.characterIds) ? row.characterIds : (Array.isArray(row.character_ids) ? row.character_ids : parseCsv(row.character_ids_csv)),
    legacyTargetIds: Array.isArray(row.legacyTargetIds) ? row.legacyTargetIds : (Array.isArray(row.legacy_target_ids) ? row.legacy_target_ids : parseCsv(row.legacy_target_ids_csv)),
    sourceType: row.source_type || "",
    sourceRef: row.source_ref || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapKnowledgeSectionRow(row) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    key: row.section_key || "",
    title: row.title || "",
    summary: row.summary || "",
    content: row.content || "",
    keywords: parseJsonArray(row.keywords_json),
    fuzzyKeywords: parseJsonArray(row.fuzzy_keywords_json),
    order: Number(row.display_order || 0),
    status: row.section_status || "active",
    sourceHeading: row.source_heading || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseJsonArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
