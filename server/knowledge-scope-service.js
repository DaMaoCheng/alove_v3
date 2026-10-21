import { createId } from "./security.js";

export const KNOWLEDGE_SCOPES = Object.freeze({
  TARGETED: "targeted",
  SITE: "site",
  GLOBAL: "global",
});

export const KNOWLEDGE_BINDING_TARGETS = Object.freeze({
  CHARACTER: "character",
  SITE: "site",
  MASCOT_LEGACY: "mascot",
});

export function normalizeKnowledgeScope(value, fallback = KNOWLEDGE_SCOPES.TARGETED) {
  const normalized = safeString(value).toLowerCase();
  if (normalized === "global") return KNOWLEDGE_SCOPES.GLOBAL;
  if (normalized === "site") return KNOWLEDGE_SCOPES.SITE;
  if (normalized === "role" || normalized === "targeted" || normalized === "character" || normalized === "object") {
    return KNOWLEDGE_SCOPES.TARGETED;
  }
  return fallback;
}

export function normalizeKnowledgeBindings(payload = {}, scope = KNOWLEDGE_SCOPES.TARGETED) {
  const normalizedScope = normalizeKnowledgeScope(scope);
  if (normalizedScope === KNOWLEDGE_SCOPES.GLOBAL) return { siteIds: [], characterIds: [] };

  const siteIds = uniqueIds([
    payload.siteId,
    payload.site_id,
    payload.siteIds,
    payload.site_ids,
    payload.bindingSiteIds,
    payload.binding_site_ids,
  ]);
  const characterIds = uniqueIds([
    payload.targetIds,
    payload.target_ids,
    payload.characterIds,
    payload.character_ids,
    payload.bindingCharacterIds,
    payload.binding_character_ids,
  ]);

  if (normalizedScope === KNOWLEDGE_SCOPES.SITE) return { siteIds, characterIds: [] };
  return { siteIds: [], characterIds };
}

export async function replaceKnowledgeAccessBindings(db, { knowledgeBaseId, scope, siteIds = [], characterIds = [] } = {}) {
  const id = safeString(knowledgeBaseId);
  if (!id) return;

  await db.execute(
    `DELETE FROM knowledge_base_bindings
     WHERE knowledge_base_id = ?
       AND target_type IN (?, ?, ?)`,
    [id, KNOWLEDGE_BINDING_TARGETS.SITE, KNOWLEDGE_BINDING_TARGETS.CHARACTER, KNOWLEDGE_BINDING_TARGETS.MASCOT_LEGACY]
  );

  const normalizedScope = normalizeKnowledgeScope(scope);
  if (normalizedScope === KNOWLEDGE_SCOPES.GLOBAL) return;

  const bindings = normalizedScope === KNOWLEDGE_SCOPES.SITE
    ? uniqueIds(siteIds).map((targetId) => ({ targetType: KNOWLEDGE_BINDING_TARGETS.SITE, targetId }))
    : uniqueIds(characterIds).map((targetId) => ({ targetType: KNOWLEDGE_BINDING_TARGETS.CHARACTER, targetId }));

  for (const binding of bindings) {
    await db.execute(
      `INSERT INTO knowledge_base_bindings (
         id, knowledge_base_id, target_type, target_id, binding_status
       ) VALUES (?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE
         binding_status = VALUES(binding_status),
         updated_at = CURRENT_TIMESTAMP(3)`,
      [createId("kb_bind"), id, binding.targetType, binding.targetId]
    );
  }
}

export function groupKnowledgeBindingRows(rows = []) {
  const siteIds = [];
  const characterIds = [];
  const legacyTargetIds = [];

  for (const row of rows) {
    const targetType = safeString(row.target_type);
    const targetId = safeString(row.target_id);
    if (!targetId) continue;
    if (targetType === KNOWLEDGE_BINDING_TARGETS.SITE) {
      siteIds.push(targetId);
    } else if (targetType === KNOWLEDGE_BINDING_TARGETS.CHARACTER) {
      characterIds.push(targetId);
    } else {
      legacyTargetIds.push(targetId);
    }
  }

  return {
    siteIds: uniqueIds(siteIds),
    characterIds: uniqueIds(characterIds),
    legacyTargetIds: uniqueIds(legacyTargetIds),
  };
}

function uniqueIds(values) {
  const flattened = values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    return safeString(value).split(/[,，\n]/);
  });
  return [...new Set(flattened.map((value) => safeString(value).slice(0, 64)).filter(Boolean))];
}

function safeString(value) {
  return String(value == null ? "" : value).trim();
}
