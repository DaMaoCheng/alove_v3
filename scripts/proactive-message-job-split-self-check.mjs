import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jobSource = readFileSync("server/proactive-message-job-service.js", "utf8");
const sendSource = readFileSync("server/chat-proactive-message-service.js", "utf8");
const contextSource = readFileSync("server/proactive-message-context-service.js", "utf8");
const gateSource = readFileSync("server/proactive-message-gate-service.js", "utf8");
const deliverySource = readFileSync("server/proactive-message-delivery-service.js", "utf8");
const deliveryPolicySource = readFileSync("server/proactive-delivery-policy.js", "utf8");

assert.match(jobSource, /sendProactiveMessageFromJob/, "job service should keep public job entry point");
assert.match(jobSource, /resolvePromotionCampaignForProactive/, "job service should orchestrate campaign matching");
assert.match(jobSource, /createProactivePromotionCampaignMessages/, "job service should orchestrate campaign message writes");
assert.match(jobSource, /buildChatWakeUpContext/, "job service should still build wake-up context before AI fallback");
assert.match(jobSource, /inspectProactiveGate/, "job service should delegate gate checks");
assert.match(jobSource, /inspectAccountProactiveDeliveryGate/, "job service should re-check account-level quota before sending");
assert.match(jobSource, /reserveProactiveMessageDelivery/, "job service should reserve account-level delivery slots");
assert.match(sendSource, /completeProactiveMessageDelivery[\s\S]*}, db\)/, "send transaction should atomically complete account-level delivery records");
assert.match(jobSource, /loadActiveUserSession/, "job service should delegate session lookup");
assert.match(jobSource, /loadProactiveCharacter/, "job service should delegate character lookup");
assert.match(jobSource, /listRecentMessagesForPrompt/, "job service should delegate prompt message loading");
assert.doesNotMatch(jobSource, /function\s+countUnansweredProactiveMessages|function\s+normalizeQuietHours|function\s+buildProactivePrompt/, "job service should not keep gate or prompt helper implementations");

assert.match(contextSource, /export async function loadActiveUserSession/, "context service should own active session lookup");
assert.match(contextSource, /export async function loadProactiveCharacter/, "context service should own proactive character lookup");
assert.match(contextSource, /export async function listRecentMessagesForPrompt/, "context service should own prompt message loading");
assert.match(contextSource, /export function buildProactivePrompt/, "context service should own proactive prompt layer");
assert.match(contextSource, /buildChatReplyPrompt/, "context service should compose the shared chat prompt");

assert.match(gateSource, /export async function inspectProactiveGate/, "gate service should own proactive gate checks");
assert.match(gateSource, /DEFAULT_MIN_IDLE_MINUTES = 240/, "gate service should preserve idle default");
assert.match(gateSource, /DEFAULT_MAX_UNANSWERED_PROACTIVE = 1/, "gate service should preserve unanswered proactive limit");
assert.match(gateSource, /DEFAULT_QUIET_HOURS = "1-8"/, "gate service should preserve quiet-hour default");
assert.match(gateSource, /countUnansweredProactiveMessages/, "gate service should own unanswered proactive counting");

assert.match(deliverySource, /export async function resolveAccountProactiveDeliveryPlan/, "delivery service should own account-level proactive planning");
assert.match(deliverySource, /export async function inspectAccountProactiveDeliveryGate/, "delivery service should own account-level delivery gate checks");
assert.match(deliverySource, /export async function reserveProactiveMessageDelivery/, "delivery service should own proactive delivery reservation");
assert.match(deliverySource, /selectProactiveDeliveryCandidate[\s\S]*from "\.\/proactive-delivery-policy\.js"/, "delivery service should preserve the public character rotation export");
assert.match(deliveryPolicySource, /export function selectProactiveDeliveryCandidate/, "delivery policy should own character rotation selection");
assert.doesNotMatch(deliveryPolicySource, /getDbPool|\.execute\(/, "delivery policy should remain independent from database access");

console.log("proactive message job split self-check passed");
