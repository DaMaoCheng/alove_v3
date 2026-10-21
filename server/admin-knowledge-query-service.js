import { getDbPool } from "./db.js";
import { mapKnowledgeBaseRow, mapKnowledgeSectionRow } from "./admin-knowledge-mapper.js";
import { safeString, throwNotFound } from "./admin-knowledge-normalizers.js";
import { groupKnowledgeBindingRows } from "./knowledge-scope-service.js";

export async function listAdminKnowledgeBases() {
  const [rows] = await getDbPool().execute(
    `SELECT kb.*,
            COUNT(ks.id) AS section_count,
            COALESCE(SUM(CHAR_LENGTH(ks.content)), 0) AS content_chars,
            COALESCE(bindings.binding_count, 0) AS binding_count,
            MAX(bindings.site_ids_csv) AS site_ids_csv,
            MAX(bindings.character_ids_csv) AS character_ids_csv,
            MAX(bindings.legacy_target_ids_csv) AS legacy_target_ids_csv
     FROM knowledge_bases kb
     LEFT JOIN knowledge_sections ks ON ks.knowledge_base_id = kb.id
     LEFT JOIN (
       SELECT
         knowledge_base_id,
         COUNT(*) AS binding_count,
         GROUP_CONCAT(CASE WHEN target_type = 'site' THEN target_id END) AS site_ids_csv,
         GROUP_CONCAT(CASE WHEN target_type = 'character' THEN target_id END) AS character_ids_csv,
         GROUP_CONCAT(CASE WHEN target_type NOT IN ('site', 'character') THEN target_id END) AS legacy_target_ids_csv
       FROM knowledge_base_bindings
       WHERE binding_status = 'active'
         AND target_type IN ('site', 'character')
       GROUP BY knowledge_base_id
     ) bindings ON bindings.knowledge_base_id = kb.id
     GROUP BY kb.id
     ORDER BY kb.priority DESC, kb.updated_at DESC, kb.label ASC`
  );

  return {
    ok: true,
    items: rows.map(mapKnowledgeBaseRow),
  };
}

export async function getAdminKnowledgeBase(knowledgeBaseId) {
  const id = safeString(knowledgeBaseId);
  if (!id) throwNotFound();

  const [[base]] = await getDbPool().execute(
    `SELECT kb.*,
            COUNT(ks.id) AS section_count,
            COALESCE(SUM(CHAR_LENGTH(ks.content)), 0) AS content_chars,
            COALESCE(bindings.binding_count, 0) AS binding_count
     FROM knowledge_bases kb
     LEFT JOIN knowledge_sections ks ON ks.knowledge_base_id = kb.id
     LEFT JOIN (
       SELECT knowledge_base_id, COUNT(*) AS binding_count
       FROM knowledge_base_bindings
       WHERE binding_status = 'active'
         AND target_type IN ('site', 'character')
       GROUP BY knowledge_base_id
     ) bindings ON bindings.knowledge_base_id = kb.id
     WHERE kb.id = ?
     GROUP BY kb.id
     LIMIT 1`,
    [id]
  );
  if (!base) throwNotFound();

  const [sections] = await getDbPool().execute(
    `SELECT *
     FROM knowledge_sections
     WHERE knowledge_base_id = ?
     ORDER BY display_order ASC, title ASC`,
    [id]
  );
  const [bindings] = await getDbPool().execute(
    `SELECT target_type, target_id
     FROM knowledge_base_bindings
     WHERE knowledge_base_id = ?
       AND binding_status = 'active'
     ORDER BY target_type ASC, target_id ASC`,
    [id]
  );
  const groupedBindings = groupKnowledgeBindingRows(bindings);

  return {
    ok: true,
    item: {
      ...mapKnowledgeBaseRow({ ...base, ...groupedBindings }),
      sections: sections.map(mapKnowledgeSectionRow),
    },
  };
}
