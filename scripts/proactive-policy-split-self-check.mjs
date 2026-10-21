import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deterministicNumber,
  getDeliveryDateForTimeZone,
  getProactiveJobDeliveryId,
  getLocalParts,
  normalizeTimeZone,
  resolveDailyRequiredAvailableAt,
  selectProactiveDeliveryCandidate,
} from "../server/proactive-delivery-policy.js";
import {
  evaluateProactiveCandidate,
  groupProactiveCandidatesByUser,
  PROACTIVE_SCHEDULER_POLICY,
} from "../server/proactive-scheduler-policy.js";

const deliveryServiceSource = readFileSync("server/proactive-message-delivery-service.js", "utf8");
const schedulerServiceSource = readFileSync("server/proactive-message-scheduler-service.js", "utf8");
const deliveryPolicySource = readFileSync("server/proactive-delivery-policy.js", "utf8");
const schedulerPolicySource = readFileSync("server/proactive-scheduler-policy.js", "utf8");

assert.match(deliveryServiceSource, /from "\.\/proactive-delivery-policy\.js"/, "delivery service should delegate pure rules to its policy");
assert.doesNotMatch(deliveryServiceSource, /createHash|function compareCandidatePriority|function normalizeHistoricalCounts/, "delivery service should not keep deterministic policy internals");
assert.match(schedulerServiceSource, /from "\.\/proactive-scheduler-policy\.js"/, "scheduler service should delegate pure rules to its policy");
assert.doesNotMatch(schedulerServiceSource, /createHash|function computeDeterministicIdleMinutes|function resolveQuietHoursAvailability/, "scheduler service should not keep deterministic policy internals");
assert.doesNotMatch(deliveryPolicySource, /getDbPool|\.execute\(/, "delivery policy should not access the database");
assert.doesNotMatch(schedulerPolicySource, /getDbPool|\.execute\(/, "scheduler policy should not access the database");

assert.equal(getProactiveJobDeliveryId(""), "", "direct calls must retain generated reservation IDs");
const stableJobDeliveryId = getProactiveJobDeliveryId("mem_job_immutable");
assert.equal(stableJobDeliveryId, getProactiveJobDeliveryId(" mem_job_immutable "), "retry identity ignores surrounding whitespace");
assert.match(stableJobDeliveryId, /^proactive_job_[a-f0-9]{48}$/);
assert.notEqual(stableJobDeliveryId, getProactiveJobDeliveryId("mem_job_different"), "different jobs must not share a slot identity");
assert.notEqual(stableJobDeliveryId, getProactiveJobDeliveryId("mem_job_immutable", "campaign"), "campaign and proactive reservations use distinct namespaces");
assert.ok(getProactiveJobDeliveryId("a".repeat(128), "campaign").length <= 64, "stable identities fit the existing primary key");

const candidateA = { characterId: "char-a", sessionId: "session-a" };
const candidateB = { characterId: "char-b", sessionId: "session-b" };
const candidateC = { characterId: "char-c", sessionId: "session-c" };

assert.deepEqual(selectProactiveDeliveryCandidate({ candidates: [candidateA] }), candidateA, "single candidate should be selected");
assert.equal(selectProactiveDeliveryCandidate({
  candidates: [candidateA, candidateB],
  lastCharacterId: "char-a",
})?.characterId, "char-b", "two candidates should rotate away from the last character");
assert.equal(selectProactiveDeliveryCandidate({
  userId: "user-1",
  deliveryDate: "2026-07-13",
  slotIndex: 2,
  candidates: [candidateA, candidateB, candidateC],
  lastCharacterId: "char-a",
  historicalCounts: { "char-b": 4, "char-c": 1 },
})?.characterId, "char-c", "three candidates should exclude the last character and prefer lower historical usage");
assert.equal(selectProactiveDeliveryCandidate({
  userId: "user-1",
  deliveryDate: "2026-07-13",
  slotIndex: 2,
  candidates: [candidateA, candidateB, candidateC],
  lastCharacterId: "char-a",
  historicalCounts: { "char-b": 1, "char-c": 1 },
})?.characterId, "char-c", "equal historical usage should preserve the deterministic tie-break result");
assert.equal(selectProactiveDeliveryCandidate({
  candidates: [candidateA, candidateB],
  eligibleCharacterIds: ["char-a"],
  lastCharacterId: "char-a",
}), null, "rotation should not bypass current eligibility");

assert.equal(normalizeTimeZone("Not/A-Timezone"), "UTC", "invalid time zones should safely fall back to UTC");
assert.equal(getDeliveryDateForTimeZone(new Date("2026-07-13T23:30:00.000Z"), "Asia/Shanghai"), "2026-07-14", "delivery date should use site local time");
assert.equal(deterministicNumber("same-seed", 1000), 541, "deterministic hash output should remain stable");
const dailyAvailableAt = resolveDailyRequiredAvailableAt({
  userId: "user-1",
  deliveryDate: "2026-07-13",
  timeZone: "Asia/Shanghai",
});
assert.equal(dailyAvailableAt.toISOString(), "2026-07-13T01:36:00.000Z", "daily-required deterministic offset should remain stable");
const dailyLocalParts = getLocalParts(dailyAvailableAt, "Asia/Shanghai");
assert.equal(dailyLocalParts.year, "2026");
assert.equal(dailyLocalParts.month, "07");
assert.equal(dailyLocalParts.day, "13");
assert.ok(Number(dailyLocalParts.hour) >= 8 && Number(dailyLocalParts.hour) < 20, "daily-required delivery should remain inside the 08:00-20:00 local window");

const grouped = groupProactiveCandidatesByUser([
  { userId: "user-a", siteId: "site-a", timeZone: "Asia/Shanghai", sessionId: "one" },
  { userId: "user-a", siteId: "site-a", timeZone: "Asia/Shanghai", sessionId: "two" },
  { userId: "user-b", siteId: "site-b", timeZone: "UTC", sessionId: "three" },
  { userId: "", siteId: "ignored", sessionId: "ignored" },
]);
assert.equal(grouped.length, 2, "scheduler candidates should group by valid user ID");
assert.equal(grouped[0].candidates.length, 2, "one account should retain all of its candidates");
assert.equal(grouped[0].siteId, "site-a", "grouped account should preserve site context");

const now = new Date("2026-07-13T10:00:00.000Z");
assert.deepEqual(evaluateProactiveCandidate({ latestAt: "" }, now), {
  allowed: false,
  reason: "missing_latest_message",
}, "missing last-message timestamps should be rejected");
const recent = evaluateProactiveCandidate({
  sessionId: "recent-session",
  latestMessageId: "recent-message",
  latestAt: new Date(now.getTime() - 60 * 60 * 1000),
  timeZone: "UTC",
}, now);
assert.equal(recent.allowed, false, "recent conversations should not trigger proactive messages");
assert.equal(recent.reason, "idle_too_short");
assert.equal(recent.requiredIdleMinutes, 344, "idle selection should preserve its deterministic result");

const eligible = evaluateProactiveCandidate({
  sessionId: "eligible-session",
  latestMessageId: "eligible-message",
  latestAt: new Date(now.getTime() - 8 * 60 * 60 * 1000),
  timeZone: "UTC",
}, now);
assert.equal(eligible.allowed, true);
assert.equal(eligible.reason, "eligible_now");
assert.equal(eligible.deferTo.getTime(), now.getTime());

const quietNow = new Date("2026-07-13T02:15:00.000Z");
const quiet = evaluateProactiveCandidate({
  sessionId: "quiet-session",
  latestMessageId: "quiet-message",
  latestAt: new Date(quietNow.getTime() - 8 * 60 * 60 * 1000),
  timeZone: "UTC",
}, quietNow);
assert.equal(quiet.allowed, true);
assert.equal(quiet.reason, "quiet_hours_deferred");
assert.equal(quiet.requiredIdleMinutes, 356, "quiet candidate idle selection should preserve its deterministic result");
assert.equal(quiet.deferTo.toISOString(), "2026-07-13T08:17:00.000Z", "quiet-hours morning delay should preserve its deterministic result");
const quietLocalParts = getLocalParts(quiet.deferTo, "UTC");
assert.equal(quietLocalParts.hour, "08");
assert.ok(Number(quietLocalParts.minute) >= 0 && Number(quietLocalParts.minute) <= PROACTIVE_SCHEDULER_POLICY.morningDelayMaxMinutes);

console.log("proactive policy split self-check passed");
