import { createHash } from "node:crypto";

const DAILY_REQUIRED_START_HOUR = 8;
const DAILY_REQUIRED_WINDOW_MINUTES = 12 * 60;

export const PROACTIVE_DELIVERY_STATUSES = Object.freeze({
  RESERVED: "reserved",
  SENT: "sent",
});

export const PROACTIVE_DELIVERY_SOURCE_TYPES = Object.freeze({
  PROACTIVE_NUDGE: "proactive_nudge",
  PROMOTION_CAMPAIGN: "promotion_campaign",
});

export const PROACTIVE_DELIVERY_MODES = Object.freeze({
  DAILY_REQUIRED: "daily_required",
  IDLE_FOLLOWUP: "idle_followup",
});

// A retry of one job must reuse its existing slot, including after an uncertain commit.
export function getProactiveJobDeliveryId(jobId = "", kind = "proactive") {
  const id = normalizeId(jobId);
  if (!id) return "";
  return `${kind === "campaign" ? "campaign_job" : "proactive_job"}_${createHash("sha256").update(id).digest("hex").slice(0, 48)}`;
}

export function selectProactiveDeliveryCandidate({
  userId = "",
  deliveryDate = "",
  slotIndex = 1,
  candidates = [],
  eligibleCharacterIds = null,
  lastCharacterId = "",
  historicalCounts = {},
} = {}) {
  const normalizedCandidates = dedupeCandidates(candidates);
  if (!normalizedCandidates.length) return null;

  const normalizedLastCharacterId = normalizeId(lastCharacterId);
  const eligibleSet = Array.isArray(eligibleCharacterIds)
    ? new Set(eligibleCharacterIds.map((value) => normalizeId(value)).filter(Boolean))
    : null;
  const isEligible = (candidate) => !eligibleSet || eligibleSet.has(candidate.characterId);
  const totalCandidateCount = normalizedCandidates.length;

  if (totalCandidateCount === 1) {
    return isEligible(normalizedCandidates[0]) ? normalizedCandidates[0] : null;
  }

  if (totalCandidateCount === 2 && normalizedLastCharacterId) {
    const alternateCandidates = normalizedCandidates.filter((candidate) => candidate.characterId !== normalizedLastCharacterId);
    if (alternateCandidates.length === 1) {
      return isEligible(alternateCandidates[0]) ? alternateCandidates[0] : null;
    }
  }

  let pool = normalizedCandidates;
  if (totalCandidateCount >= 3 && normalizedLastCharacterId) {
    const filteredPool = normalizedCandidates.filter((candidate) => candidate.characterId !== normalizedLastCharacterId);
    if (filteredPool.length) {
      pool = filteredPool;
    }
  }

  const eligiblePool = pool.filter(isEligible);
  if (!eligiblePool.length) return null;

  return eligiblePool.sort((left, right) => compareCandidatePriority({
    left,
    right,
    userId,
    deliveryDate,
    slotIndex,
    historicalCounts,
  }))[0] || null;
}

export function resolveDailyRequiredAvailableAt({ userId, deliveryDate, timeZone = "UTC" } = {}) {
  const normalizedDeliveryDate = normalizeDeliveryDate(deliveryDate);
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  if (!normalizedDeliveryDate) return new Date();

  const [year, month, day] = normalizedDeliveryDate.split("-");
  const minuteOffset = deterministicNumber(
    `${normalizeId(userId)}|${normalizedDeliveryDate}|daily_required`,
    DAILY_REQUIRED_WINDOW_MINUTES
  );
  const totalMinutes = DAILY_REQUIRED_START_HOUR * 60 + minuteOffset;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return zonedLocalTimeToDate({
    year,
    month,
    day,
    hour: String(hour).padStart(2, "0"),
    minute: String(minute).padStart(2, "0"),
    second: "00",
  }, normalizedTimeZone);
}

export function getDeliveryDateForTimeZone(date, timeZone = "UTC") {
  const parts = getLocalParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getLocalParts(date, timeZone = "UTC") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === "24" ? "00" : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function zonedLocalTimeToDate(parts, timeZone = "UTC") {
  const guess = new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  ));
  const actualParts = getLocalParts(guess, timeZone);
  const actualAsUtc = Date.UTC(
    Number(actualParts.year),
    Number(actualParts.month) - 1,
    Number(actualParts.day),
    Number(actualParts.hour),
    Number(actualParts.minute),
    Number(actualParts.second)
  );
  const targetAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return new Date(guess.getTime() + targetAsUtc - actualAsUtc);
}

export function deterministicNumber(seed, modulo) {
  const hash = createHash("sha256").update(String(seed || "")).digest("hex");
  return Number.parseInt(hash.slice(0, 8), 16) % Math.max(1, Number(modulo || 1));
}

export function normalizeTimeZone(value) {
  const normalized = String(value || "UTC").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
    return normalized;
  } catch {
    return "UTC";
  }
}

export function dedupeCandidates(candidates = []) {
  const unique = new Map();
  for (const candidate of candidates) {
    const characterId = normalizeId(candidate?.characterId);
    if (!characterId || unique.has(characterId)) continue;
    unique.set(characterId, {
      ...candidate,
      characterId,
      sessionId: normalizeId(candidate?.sessionId),
    });
  }
  return Array.from(unique.values());
}

export function normalizeDeliveryMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(PROACTIVE_DELIVERY_MODES).includes(normalized) ? normalized : "";
}

export function normalizeSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(PROACTIVE_DELIVERY_SOURCE_TYPES).includes(normalized) ? normalized : "";
}

export function normalizeDeliveryDate(value) {
  const normalized = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

export function normalizeSlotIndex(value) {
  const number = Number(value || 0);
  return number === 1 || number === 2 ? number : 0;
}

export function normalizeId(value) {
  return String(value || "").trim();
}

function compareCandidatePriority({
  left,
  right,
  userId,
  deliveryDate,
  slotIndex,
  historicalCounts,
} = {}) {
  const counts = normalizeHistoricalCounts(historicalCounts);
  const leftCount = counts[left.characterId] || 0;
  const rightCount = counts[right.characterId] || 0;
  if (leftCount !== rightCount) return leftCount - rightCount;

  const leftSeed = deterministicNumber(`${normalizeId(userId)}|${normalizeDeliveryDate(deliveryDate)}|${normalizeSlotIndex(slotIndex) || 1}|${left.characterId}`, 1_000_000);
  const rightSeed = deterministicNumber(`${normalizeId(userId)}|${normalizeDeliveryDate(deliveryDate)}|${normalizeSlotIndex(slotIndex) || 1}|${right.characterId}`, 1_000_000);
  if (leftSeed !== rightSeed) return leftSeed - rightSeed;

  return left.characterId.localeCompare(right.characterId);
}

function normalizeHistoricalCounts(value = {}) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [normalizeId(key), Math.max(0, Number(count || 0))])
  );
}
