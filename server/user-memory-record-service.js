import {
  MEMORY_LINK_RELATIONS,
  normalizeMemoryScope,
  normalizeMemorySourceKind,
  normalizeMemoryStatus,
  normalizeMemoryType,
  normalizePrivacyLevel,
  resolveMemoryExpiresAt,
} from "./chat-memory-taxonomy.js";
import { normalizeScore } from "./chat-memory-analysis.js";
import { nullableText } from "./chat-memory-utils.js";

export async function createUserMemoryRecord(db, input = {}) {
  const normalizedUserId = String(input.userId || input.internalUid || "").trim();
  if (!normalizedUserId) {
    const error = new Error("用户不存在");
    error.statusCode = 400;
    throw error;
  }

  const normalizedCharacterId = String(input.characterId || "").trim();
  const normalizedSummary = nullableText(input.summary);
  const normalizedContent = String(input.content || "").trim();
  const normalizedMemoryType = normalizeMemoryType(input.memoryType);
  const existingMemoryId = await findExistingActiveMemory(db, {
    userId: normalizedUserId,
    characterId: normalizedCharacterId,
    memoryType: normalizedMemoryType,
    summary: normalizedSummary,
    content: normalizedContent,
  });
  if (existingMemoryId) {
    await db.execute(
      `UPDATE user_memory_records
       SET confidence_score = GREATEST(confidence_score, ?),
           importance_score = GREATEST(importance_score, ?),
           freshness_score = GREATEST(freshness_score, ?),
           last_confirmed_at = ?,
           updated_at = NOW(3)
       WHERE id = ?`,
      [
        normalizeScore(input.confidenceScore, 50),
        normalizeScore(input.importanceScore, 50),
        normalizeScore(input.freshnessScore, 50),
        input.lastConfirmedAt || new Date(),
        existingMemoryId,
      ]
    );
    if (input.sourceMessageId || input.sourceSessionId) {
      await linkUserMemorySource(db, {
        memoryId: existingMemoryId,
        sourceMessageId: input.sourceMessageId,
        sourceSessionId: input.sourceSessionId,
        relationType: input.relationType || MEMORY_LINK_RELATIONS.UPDATED_BY,
      });
    }
    return existingMemoryId;
  }

  const [result] = await db.execute(
    `INSERT INTO user_memory_records (
       internal_uid, character_id, scope, memory_type, title, content, summary,
       confidence_score, importance_score, freshness_score, privacy_level, memory_status,
       source_kind, effective_at, expires_at, last_confirmed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizedUserId,
      normalizedCharacterId || null,
      normalizeMemoryScope(input.scope),
      normalizedMemoryType,
      nullableText(input.title, 255),
      normalizedContent,
      normalizedSummary,
      normalizeScore(input.confidenceScore, 50),
      normalizeScore(input.importanceScore, 50),
      normalizeScore(input.freshnessScore, 50),
      normalizePrivacyLevel(input.privacyLevel),
      normalizeMemoryStatus(input.status),
      normalizeMemorySourceKind(input.sourceKind),
      input.effectiveAt || null,
      resolveMemoryExpiresAt({
        memoryType: normalizedMemoryType,
        explicitExpiresAt: input.expiresAt || null,
      }),
      input.lastConfirmedAt || new Date(),
    ]
  );

  const memoryId = Number(result.insertId || 0);
  if (memoryId && (input.sourceMessageId || input.sourceSessionId)) {
    await linkUserMemorySource(db, {
      memoryId,
      sourceMessageId: input.sourceMessageId,
      sourceSessionId: input.sourceSessionId,
      relationType: input.relationType,
    });
  }
  return memoryId;
}

async function findExistingActiveMemory(db, {
  userId,
  characterId,
  memoryType,
  summary,
  content,
} = {}) {
  const params = [
    String(userId || "").trim(),
    String(memoryType || "").trim(),
    String(summary || content || "").trim(),
  ];
  const characterClause = characterId
    ? "character_id = ?"
    : "character_id IS NULL";
  if (characterId) params.splice(2, 0, String(characterId || "").trim());

  const [rows] = await db.execute(
    `SELECT id
     FROM user_memory_records
     WHERE internal_uid = ?
       AND memory_type = ?
       AND ${characterClause}
       AND memory_status = 'active'
       AND COALESCE(summary, content) = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    params
  );
  return Number(rows[0]?.id || 0);
}

export async function linkUserMemorySource(db, {
  memoryId,
  sourceMessageId = "",
  sourceSessionId = "",
  relationType = MEMORY_LINK_RELATIONS.DERIVED_FROM,
} = {}) {
  const normalizedMemoryId = Number(memoryId || 0);
  if (!normalizedMemoryId) return null;
  await db.execute(
    `INSERT INTO user_memory_links (
       memory_id, source_message_id, source_session_id, relation_type
     ) VALUES (?, ?, ?, ?)`,
    [
      normalizedMemoryId,
      String(sourceMessageId || "").trim() || null,
      String(sourceSessionId || "").trim() || null,
      String(relationType || MEMORY_LINK_RELATIONS.DERIVED_FROM).trim() || MEMORY_LINK_RELATIONS.DERIVED_FROM,
    ]
  );
  return normalizedMemoryId;
}

export async function listPromptMemoryRecords(db, {
  userId,
  characterId = "",
  limit = 12,
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return [];

  const [rows] = await db.execute(
    `SELECT *
     FROM user_memory_records
     WHERE internal_uid = ?
       AND memory_status = 'active'
       AND (character_id IS NULL OR character_id = ?)
       AND (expires_at IS NULL OR expires_at > NOW(3))
     ORDER BY importance_score DESC, freshness_score DESC, updated_at DESC
     LIMIT ${Math.max(1, Math.min(50, Number(limit || 12)))}`,
    [normalizedUserId, String(characterId || "").trim()]
  );
  return rows;
}

export async function markExpiredPromptMemories(db, {
  userId,
  characterId = "",
  now = new Date(),
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return 0;
  const [result] = await db.execute(
    `UPDATE user_memory_records
     SET memory_status = 'expired',
         updated_at = NOW(3)
     WHERE internal_uid = ?
       AND memory_status = 'active'
       AND (character_id IS NULL OR character_id = ?)
       AND expires_at IS NOT NULL
       AND expires_at <= ?`,
    [
      normalizedUserId,
      String(characterId || "").trim(),
      now,
    ]
  );
  return Number(result.affectedRows || 0);
}

export function buildPromptMemoryBlock(rows = []) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (!normalizedRows.length) return "";

  const grouped = new Map();
  for (const row of normalizedRows) {
    const type = String(row?.memory_type || "").trim();
    const value = String(row?.summary || row?.content || "").trim();
    if (!type || !value) continue;
    if (!grouped.has(type)) grouped.set(type, []);
    const current = grouped.get(type);
    if (!current.includes(value)) current.push(value);
  }

  const lines = [];
  if (grouped.has("identity")) {
    lines.push(`User identity: ${grouped.get("identity").join(" ; ")}`);
  }
  if (grouped.has("favorite_club")) {
    lines.push(`Favorite clubs: ${grouped.get("favorite_club").join(" ; ")}`);
  }
  if (grouped.has("favorite_player")) {
    lines.push(`Favorite players: ${grouped.get("favorite_player").join(" ; ")}`);
  }
  if (grouped.has("favorite_league")) {
    lines.push(`Favorite leagues: ${grouped.get("favorite_league").join(" ; ")}`);
  }
  if (grouped.has("favorite_team_entity")) {
    lines.push(`Likely football interests: ${grouped.get("favorite_team_entity").join(" ; ")}`);
  }
  if (grouped.has("purchased_product")) {
    lines.push(`Purchased products: ${grouped.get("purchased_product").join(" ; ")}`);
  }
  if (grouped.has("watching_habit")) {
    lines.push(`Watching habits: ${grouped.get("watching_habit").join(" ; ")}`);
  }
  if (grouped.has("interaction_preference")) {
    lines.push(`Interaction preferences: ${grouped.get("interaction_preference").join(" ; ")}`);
  }
  if (grouped.has("football_emotion_trigger")) {
    lines.push(`Football emotion triggers: ${grouped.get("football_emotion_trigger").join(" ; ")}`);
  }
  if (grouped.has("ongoing_topic")) {
    lines.push(`Ongoing topics: ${grouped.get("ongoing_topic").join(" ; ")}`);
  }
  if (grouped.has("raw_episode")) {
    lines.push(`Key raw episodes: ${grouped.get("raw_episode").join(" ; ")}`);
  }
  return lines.join("\n");
}
