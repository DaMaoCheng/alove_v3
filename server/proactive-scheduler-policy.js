import { createHash } from "node:crypto";
import { deterministicNumber, getLocalParts, normalizeTimeZone, zonedLocalTimeToDate } from "./proactive-delivery-policy.js";

export const PROACTIVE_SCHEDULER_POLICY = Object.freeze({
  minIdleMinutes: 240,
  maxIdleMinutes: 360,
  maxUnansweredProactive: 1,
  quietStartHour: 1,
  quietEndHour: 8,
  morningDelayMaxMinutes: 30,
});

export function groupProactiveCandidatesByUser(candidates = []) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const userId = String(candidate.userId || "").trim();
    if (!userId) continue;
    if (!grouped.has(userId)) {
      grouped.set(userId, {
        userId,
        siteId: candidate.siteId || "",
        timeZone: candidate.timeZone || "UTC",
        candidates: [],
      });
    }
    grouped.get(userId).candidates.push(candidate);
  }
  return Array.from(grouped.values());
}

export function evaluateProactiveCandidate(candidate, now) {
  if (!candidate.latestAt) {
    return { allowed: false, reason: "missing_latest_message" };
  }

  const latestAt = new Date(candidate.latestAt);
  const requiredIdleMinutes = computeDeterministicIdleMinutes(candidate);
  const elapsedMinutes = Math.floor((now.getTime() - latestAt.getTime()) / 60000);
  if (elapsedMinutes < requiredIdleMinutes) {
    return { allowed: false, reason: "idle_too_short", requiredIdleMinutes, elapsedMinutes };
  }

  const quietState = resolveQuietHoursAvailability(candidate, now);
  if (quietState.inQuietHours) {
    return {
      allowed: true,
      reason: "quiet_hours_deferred",
      requiredIdleMinutes,
      deferTo: quietState.deferTo,
    };
  }

  return {
    allowed: true,
    reason: "eligible_now",
    requiredIdleMinutes,
    deferTo: now,
  };
}

function computeDeterministicIdleMinutes(candidate) {
  const hash = createHash("sha256")
    .update(String(candidate.sessionId || ""))
    .update("|")
    .update(String(candidate.latestMessageId || candidate.latestAt || ""))
    .digest("hex");
  const sample = Number.parseInt(hash.slice(0, 8), 16);
  const spread = PROACTIVE_SCHEDULER_POLICY.maxIdleMinutes - PROACTIVE_SCHEDULER_POLICY.minIdleMinutes;
  return PROACTIVE_SCHEDULER_POLICY.minIdleMinutes + (sample % (spread + 1));
}

function resolveQuietHoursAvailability(candidate, now) {
  const timeZone = normalizeTimeZone(candidate.timeZone);
  const localParts = getLocalParts(now, timeZone);
  const localHour = Number(localParts.hour);
  const inQuietHours = localHour >= PROACTIVE_SCHEDULER_POLICY.quietStartHour
    && localHour < PROACTIVE_SCHEDULER_POLICY.quietEndHour;
  if (!inQuietHours) return { inQuietHours: false, deferTo: now };

  const delayMinutes = deterministicNumber(
    `${candidate.sessionId}|morning`,
    PROACTIVE_SCHEDULER_POLICY.morningDelayMaxMinutes + 1
  );
  const deferTo = zonedLocalTimeToDate({
    ...localParts,
    hour: String(PROACTIVE_SCHEDULER_POLICY.quietEndHour).padStart(2, "0"),
    minute: String(delayMinutes).padStart(2, "0"),
    second: "00",
  }, timeZone);
  return {
    inQuietHours: true,
    deferTo,
  };
}
