import { getDbPool, withTransaction } from "./db.js";
import { generateKnowledgeOutline, splitKnowledgeSections } from "./knowledge-ai-service.js";
import { createId } from "./security.js";
import { getAdminKnowledgeBase } from "./admin-knowledge-query-service.js";
import { replaceKnowledgeAccessBindings } from "./knowledge-scope-service.js";
import {
  normalizeAiSections,
  normalizeId,
  normalizeKnowledgeBasePayload,
  normalizeKnowledgeCreatePayload,
  normalizeKnowledgeUpdatePayload,
  normalizeManualSections,
  normalizeSections,
  safeString,
  throwNotFound,
} from "./admin-knowledge-normalizers.js";

export async function createKnowledgeBaseFromAi(payload = {}, { ai = defaultKnowledgeAiProcessor } = {}) {
  const draft = normalizeKnowledgeCreatePayload(payload);
  const aiResult = await ai(draft);
  const summary = safeString(aiResult.summary || aiResult.outline?.summary || "").slice(0, 65535);
  const sections = normalizeAiSections(aiResult.sections || [], draft.sourceText);
  return upsertKnowledgeBaseWithSections({
    id: draft.id,
    label: draft.label,
    category: draft.category,
    scope: draft.scope,
    status: "active",
    language: "简体中文",
    priority: draft.priority,
    maxSections: 6,
    maxCharsPerSection: 1800,
    summary: summary || draft.label,
    keywords: draft.keywords,
    fuzzyKeywords: draft.fuzzyKeywords,
    sourceType: "admin_ai",
    sourceRef: "admin-create-knowledge",
    bindings: draft.bindings,
    sections,
  });
}

export async function updateAdminKnowledgeBase(knowledgeBaseId, payload = {}) {
  const id = normalizeId(knowledgeBaseId);
  if (!id) throwNotFound();
  const current = await getAdminKnowledgeBase(id);
  const draft = normalizeKnowledgeUpdatePayload(payload);
  return upsertKnowledgeBaseWithSections({
    id,
    label: draft.label,
    category: draft.category,
    scope: draft.scope || current.item.scope || "targeted",
    status: current.item.status || "active",
    language: current.item.language || "简体中文",
    priority: draft.priority,
    maxSections: current.item.maxSections || 6,
    maxCharsPerSection: current.item.maxCharsPerSection || 1800,
    summary: current.item.summary || draft.label,
    keywords: draft.keywords,
    fuzzyKeywords: draft.fuzzyKeywords,
    sourceType: current.item.sourceType || "manual",
    sourceRef: current.item.sourceRef || "admin-edit-knowledge",
    bindings: draft.bindings,
    sections: normalizeManualSections(draft.sourceText, current.item.sections),
  });
}

export async function deleteAdminKnowledgeBase(knowledgeBaseId) {
  const id = normalizeId(knowledgeBaseId);
  if (!id) throwNotFound();
  await getAdminKnowledgeBase(id);

  await withTransaction(async (db) => {
    await db.execute("DELETE FROM knowledge_base_bindings WHERE knowledge_base_id = ?", [id]);
    await db.execute("DELETE FROM knowledge_sections WHERE knowledge_base_id = ?", [id]);
    await db.execute("DELETE FROM knowledge_bases WHERE id = ?", [id]);
  });

  return { ok: true, deletedId: id };
}

export async function upsertKnowledgeBaseWithSections(payload = {}) {
  const base = normalizeKnowledgeBasePayload(payload);
  const sections = normalizeSections(payload.sections || []);

  await withTransaction(async (db) => {
    await db.execute(
      `INSERT INTO knowledge_bases (
         id, label, summary, category, scope, site_id, knowledge_status, language,
         priority, max_sections, max_chars_per_section, keywords_json, fuzzy_keywords_json,
         source_type, source_ref
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         summary = VALUES(summary),
         category = VALUES(category),
         scope = VALUES(scope),
         site_id = VALUES(site_id),
         knowledge_status = VALUES(knowledge_status),
         language = VALUES(language),
         priority = VALUES(priority),
         max_sections = VALUES(max_sections),
         max_chars_per_section = VALUES(max_chars_per_section),
         keywords_json = VALUES(keywords_json),
         fuzzy_keywords_json = VALUES(fuzzy_keywords_json),
         source_type = VALUES(source_type),
         source_ref = VALUES(source_ref),
         updated_at = NOW(3)`,
      [
        base.id,
        base.label,
        base.summary,
        base.category,
        base.scope,
        base.siteId,
        base.status,
        base.language,
        base.priority,
        base.maxSections,
        base.maxCharsPerSection,
        JSON.stringify(base.keywords),
        JSON.stringify(base.fuzzyKeywords),
        base.sourceType,
        base.sourceRef,
      ]
    );

    await db.execute("DELETE FROM knowledge_sections WHERE knowledge_base_id = ?", [base.id]);

    for (const section of sections) {
      await db.execute(
        `INSERT INTO knowledge_sections (
           id, knowledge_base_id, section_key, title, summary, content,
           keywords_json, fuzzy_keywords_json, display_order, section_status, source_heading
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          section.id || createId("kb_sec"),
          base.id,
          section.key,
          section.title,
          section.summary,
          section.content,
          JSON.stringify(section.keywords),
          JSON.stringify(section.fuzzyKeywords),
          section.order,
          section.status,
          section.sourceHeading,
        ]
      );
    }

    if (payload.bindings) {
      await replaceKnowledgeAccessBindings(db, {
        knowledgeBaseId: base.id,
        scope: base.scope,
        siteIds: payload.bindings.siteIds,
        characterIds: payload.bindings.characterIds,
      });
    }
  });

  return getAdminKnowledgeBase(base.id);
}

async function defaultKnowledgeAiProcessor(draft) {
  const outline = await generateKnowledgeOutline({ title: draft.label, sourceText: draft.sourceText });
  const split = await splitKnowledgeSections({ title: draft.label, sourceText: draft.sourceText, outline: outline.data?.outline || [] });
  return {
    summary: outline.data?.summary || "",
    outline: outline.data || {},
    sections: split.data?.sections || [],
  };
}
