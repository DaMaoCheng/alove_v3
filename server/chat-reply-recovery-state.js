import { REVIEW_STATUSES, RECOVERY_FAILURE_CODES, RECOVERY_KINDS } from "./chat-reply-review-outcome.js";
// Server-owned failure provenance; never infer it from a user's words or old assistant text.
const NAMESPACE = "_replyRecovery";
const object = value => value && typeof value === "object" && !Array.isArray(value);

export function normalizeReplyRecoveryState(value) {
  if (!object(value) || value.version !== 1 || value.guardApplied !== true || !RECOVERY_KINDS.has(value.kind)
    || !REVIEW_STATUSES.has(value.reviewStatus) || !Array.isArray(value.failedContracts)
    || value.failedContracts.length > RECOVERY_FAILURE_CODES.size || value.failedContracts.some(contract => !RECOVERY_FAILURE_CODES.has(contract))) return null;
  return { version: 1, kind: value.kind, reviewStatus: value.reviewStatus,
    failedContracts: [...new Set(value.failedContracts)], guardApplied: true,
    ...(value.productClarification === true && value.kind === 'boundary' && value.reviewStatus === 'valid' ? { productClarification: true } : {}) };
}

export function readReplyRecoveryState(payload) {
  return object(payload) ? normalizeReplyRecoveryState(payload[NAMESPACE]) : null;
}

export function stripReplyRecoveryPayload(payload) {
  if (!object(payload) || !Object.hasOwn(payload, NAMESPACE)) return payload;
  const result = { ...payload };
  delete result[NAMESPACE];
  return Object.keys(result).length ? result : null;
}

export function mergeReplyRecoveryPayload(payload, state) {
  const result = stripReplyRecoveryPayload(payload);
  const normalized = normalizeReplyRecoveryState(state);
  return normalized ? { ...(object(result) ? result : {}), [NAMESPACE]: normalized } : result;
}

export function normalizeUnansweredUserQuestion(value) {
  if (!object(value) || typeof value.text !== "string") return null;
  const text = value.text.trim();
  return text && text.length <= 1200 ? { text } : null;
}

// The caller supplies ordered, same-session history. Only the immediately
// preceding failed answer can nominate its user's question; an ordinary answer,
// another unpaired user message or product card ends this association.
export function buildUnansweredUserQuestionContext(messages = [], { characterId = "" } = {}) {
  const [question, answer] = messages.slice(-2);
  const sender = row => row?.senderType || row?.sender_type;
  const textMessage = row => !row?.contentType && !row?.content_type || (row.contentType || row.content_type) === "text";
  if (sender(question) !== "user" || sender(answer) !== "character" || !textMessage(question) || !textMessage(answer)
    || !normalizeReplyRecoveryState(answer?.replyRecoveryState)
    || characterId && [question, answer].some(row => (row.characterId || row.character_id) && (row.characterId || row.character_id) !== characterId)) return null;
  return normalizeUnansweredUserQuestion({ text: question.text || question.text_content || "" });
}

export function buildReplyRecoveryContextLayer(messages = []) {
  const positions = messages.flatMap((message, index) => (message?.senderType || message?.sender_type) === "character"
    && normalizeReplyRecoveryState(message.replyRecoveryState) ? [index + 1] : []);
  if (!positions.length) return null;
  return { id: "reply_recovery", title: "Prior Reply Recovery", content: [
    `Prior conversation message positions ${positions.join(", ")} (1-based) contain server-marked degraded replies.`,
    "Those assistant replies are failure output, not ordinary conversation style, verified facts, or successful answers. Do not repeat their limitation solely because it occurred in history.",
    "Respond naturally to the current user message in the active conversation language while following every existing persona, evidence, factual and reply boundary rule. Do not treat these markers or user frustration as evidence of a technical or checkout problem.",
    "Preserve the user's actual meaning and relevant conversation context. Do not invent successful verification, promise recovery, relax a guard, or refer to internal markers.",
  ].join("\n") };
}
