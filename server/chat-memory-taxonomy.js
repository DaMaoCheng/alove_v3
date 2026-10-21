export const MEMORY_SCOPES = Object.freeze({
  GLOBAL: "global",
  CHARACTER_PRIVATE: "character_private",
});

export const MEMORY_TYPES = Object.freeze({
  IDENTITY: "identity",
  FAVORITE_CLUB: "favorite_club",
  FAVORITE_PLAYER: "favorite_player",
  FAVORITE_LEAGUE: "favorite_league",
  FAVORITE_TEAM_ENTITY: "favorite_team_entity",
  PURCHASED_PRODUCT: "purchased_product",
  WATCHING_HABIT: "watching_habit",
  INTERACTION_PREFERENCE: "interaction_preference",
  FOOTBALL_EMOTION_TRIGGER: "football_emotion_trigger",
  ONGOING_TOPIC: "ongoing_topic",
  RAW_EPISODE: "raw_episode",
});

export const PRODUCT_PREFERENCE_MEMORY_TYPES = Object.freeze([
  MEMORY_TYPES.FAVORITE_CLUB,
  MEMORY_TYPES.FAVORITE_TEAM_ENTITY,
  MEMORY_TYPES.FAVORITE_PLAYER,
  MEMORY_TYPES.PURCHASED_PRODUCT,
]);

export const MEMORY_STATUSES = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  EXPIRED: "expired",
  REJECTED: "rejected",
});

export const MEMORY_SOURCE_KINDS = Object.freeze({
  CHAT_TEXT: "chat_text",
  CHAT_ATTACHMENT: "chat_attachment",
  DAILY_SUMMARY: "daily_summary",
  MANUAL: "manual",
  SYSTEM_DISTILL: "system_distill",
});

export const MEMORY_PRIVACY_LEVELS = Object.freeze({
  NORMAL: "normal",
  SENSITIVE: "sensitive",
  STRICT: "strict",
});

export const MEMORY_LINK_RELATIONS = Object.freeze({
  DERIVED_FROM: "derived_from",
  UPDATED_BY: "updated_by",
  CONFLICTS_WITH: "conflicts_with",
  SUPERSEDES: "supersedes",
});

export const SUMMARY_PERIOD_TYPES = Object.freeze({
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
});

export function normalizeEnum(value, allowedValues, fallback) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

export function normalizeMemoryScope(value) {
  return normalizeEnum(value, Object.values(MEMORY_SCOPES), MEMORY_SCOPES.GLOBAL);
}

export function normalizeMemoryType(value) {
  return normalizeEnum(value, Object.values(MEMORY_TYPES), MEMORY_TYPES.ONGOING_TOPIC);
}

export function normalizeMemoryStatus(value) {
  return normalizeEnum(value, Object.values(MEMORY_STATUSES), MEMORY_STATUSES.ACTIVE);
}

export function normalizeMemorySourceKind(value) {
  return normalizeEnum(value, Object.values(MEMORY_SOURCE_KINDS), MEMORY_SOURCE_KINDS.CHAT_TEXT);
}

export function normalizePrivacyLevel(value) {
  return normalizeEnum(value, Object.values(MEMORY_PRIVACY_LEVELS), MEMORY_PRIVACY_LEVELS.NORMAL);
}

export function normalizeSummaryPeriodType(value) {
  return normalizeEnum(value, Object.values(SUMMARY_PERIOD_TYPES), SUMMARY_PERIOD_TYPES.DAY);
}

export function getDefaultMemoryTtlDays(memoryType) {
  const normalizedType = normalizeMemoryType(memoryType);
  if (normalizedType === MEMORY_TYPES.ONGOING_TOPIC) return 14;
  if (normalizedType === MEMORY_TYPES.FOOTBALL_EMOTION_TRIGGER) return 90;
  if (normalizedType === MEMORY_TYPES.RAW_EPISODE) return 60;
  return null;
}

export function resolveMemoryExpiresAt({ memoryType, now = new Date(), explicitExpiresAt = null } = {}) {
  if (explicitExpiresAt) return explicitExpiresAt;
  const ttlDays = getDefaultMemoryTtlDays(memoryType);
  if (!ttlDays) return null;
  const baseTime = now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime();
  const safeBaseTime = Number.isFinite(baseTime) ? baseTime : Date.now();
  return new Date(safeBaseTime + ttlDays * 24 * 60 * 60 * 1000);
}
