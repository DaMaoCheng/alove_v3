import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Real local MySQL service-function check; upstream HTTP is controlled, no paid calls.
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("External requests forbidden in local recovery check"); };
const { SERVER_CONFIG } = await import("../server/config.js");
assert.ok(["127.0.0.1", "localhost", "::1"].includes(SERVER_CONFIG.db.host) && SERVER_CONFIG.db.port === 3307,
  "This check is restricted to the local loopback MySQL on port 3307");
assert.equal(SERVER_CONFIG.db.database, "aiove_app", "Unexpected local database");
assert.equal(SERVER_CONFIG.runtime.providerLogWriteEnabled, false);
const { getDbPool, closeDbPool } = await import("../server/db-core.js");
const { insertMessage, listRecentMessagesBeforeOrder, listMessagesForSessionWithDb } = await import("../server/chat-message-store.js");
const { enforceReplyBoundary, assessReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { buildChatReplyPrompt } = await import("../server/chat-prompt-service.js");
const { buildFactualUnavailableCopy } = await import("../server/chat-factual-policy.js");
const { buildReplyReviewLogEvent } = await import("../server/ai-reply-log-service.js");
const pool = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const sessionId = `check_recovery_session_${suffix}`;
const guestId = `check_recovery_guest_${suffix}`;
const config = { id: "fixture", apiMode: "chat_completions", apiKey: "controlled-placeholder",
  baseUrl: "https://fixture.invalid/v1", model: "controlled-review" };
const verdict = { allowed: true, confidence: .99, languageQualitySupported: true, factualSupported: true,
  evidenceSupported: true, guidanceSupported: true };
let connection, transactionStarted = false, passed = false, assessmentCalls = 0;
try {
  connection = await pool.getConnection();
  const [characters] = await connection.execute("SELECT id FROM ai_characters ORDER BY id LIMIT 1");
  const [sites] = await connection.execute("SELECT id FROM sites ORDER BY id LIMIT 1");
  assert.ok(characters[0] && sites[0], "Existing local character/site required; no seed will run");
  const characterId = characters[0].id;
  const siteId = sites[0].id;
  const character = { id: characterId, name: "Local recovery fixture", personaPrompt: "Preserve warm relationship continuity.", profile: { language: "hu" } };
  const productRequestState = { version: 1, status: "cleared", siteId, characterId,
    items: [], selectedIndex: null, clarificationCount: 0 };
  await connection.beginTransaction();
  transactionStarted = true;
  await connection.execute("INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, session_status, expires_at) VALUES (?, ?, ?, ?, ?, 'active', DATE_ADD(NOW(3), INTERVAL 1 HOUR))",
    [guestId, suffix, siteId, characterId, sessionId]);
  await connection.execute("INSERT INTO chat_sessions (id, guest_session_id, character_id, session_title, source_type, source_ref, preferred_language) VALUES (?, ?, ?, 'Isolated recovery check', 'system', 'local-recovery-check', 'hu')",
    [sessionId, guestId, characterId]);
  const base = { sessionId, guestSessionId: guestId, characterId, senderLabel: "Fixture", contentType: "text" };
  const input1 = await insertMessage(connection, { ...base, senderType: "user", text: "Nem sajnos mert el utasított", displayOrder: 10, sourceType: "user", sourceRef: "user-input" });
  const diagnostics = [], providerEvents = [];
  async function checkReply(input, reviewVerdict) {
    return enforceReplyBoundary({ ...input, character, language: "hu", languageQualityRequired: true,
      factualContext: { required: false, status: "not_required", searched: false, asOfUtc: "2026-10-11T11:24:29.000Z", items: [] },
      searchIntent: { commerceRoute: "chat", answerRequired: false, shouldLoadProductContext: false },
      recordReview: async event => diagnostics.push(buildReplyReviewLogEvent(event)),
      assess: async options => assessReplyBoundary({ ...options, config, recordLog: async event => providerEvents.push(event),
        fetchImpl: async (_url, request) => {
          assessmentCalls++;
          const requestBody = JSON.parse(request.body);
          const reviewInput = JSON.parse(requestBody.messages.findLast(message => message.role === "user").content);
          assert.equal(reviewInput.proposedResponse, input.replyResult.text);
          assert.equal(reviewInput.latestUserMessage, input.userText);
          assert.equal(reviewInput.factualContext.required, false, "ordinary conversation keeps non-search context");
          return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(reviewVerdict) } }] }) };
        } }),
    });
  }
  const original = "Sajnálom, hogy visszautasított. Itt vagyok, meghallgatlak.";
  const reply1 = await checkReply({ userText: input1.text, replyResult: { text: original, speechText: original, sourceType: "ai", sourceRef: "ai" },
    logContext: { requestId: input1.id, sessionId, characterId } }, { ...verdict, allowed: false, languageQualitySupported: false });
  assert.equal(reply1.replyRecoveryState?.kind, "language");
  assert.equal(reply1.text.includes(buildFactualUnavailableCopy("hu")), false, "language denial must not become factual unavailability");
  const stored1 = await insertMessage(connection, { ...base, senderType: "character", text: reply1.text, displayOrder: 20,
    sourceType: "ai", sourceRef: `guest-reply:${input1.id}`, replyRecoveryState: reply1.replyRecoveryState, productRequestState });
  assert.equal(stored1.product, null, "immediate client projection strips both private states");
  const [[storedRaw]] = await connection.execute("SELECT product_payload_json, source_ref FROM chat_messages WHERE id = ?", [stored1.id]);
  const payload = typeof storedRaw.product_payload_json === "string" ? JSON.parse(storedRaw.product_payload_json) : storedRaw.product_payload_json;
  assert.deepEqual(payload._replyRecovery, reply1.replyRecoveryState);
  assert.deepEqual(payload._productRequestScope, productRequestState);
  assert.equal(storedRaw.source_ref, `guest-reply:${input1.id}`);
  const input2 = await insertMessage(connection, { ...base, senderType: "user", text: "Szeretném, ha meghallgatnál.", displayOrder: 30, sourceType: "user", sourceRef: "user-input" });
  const history = await listRecentMessagesBeforeOrder(connection, { sessionId, beforeDisplayOrder: 30 });
  assert.equal(history.length, 2);
  assert.deepEqual(history[1].replyRecoveryState, reply1.replyRecoveryState);
  assert.deepEqual(history[1].productRequestState, productRequestState);
  const prompt = buildChatReplyPrompt({ character, recentMessages: history, userText: input2.text });
  assert.ok(prompt.layers.some(layer => layer.id === "reply_recovery"));
  assert.ok(prompt.systemPrompt.includes("Preserve warm relationship continuity."));
  assert.equal(prompt.messages.at(-1).content, input2.text);
  assert.deepEqual(prompt.messages.slice(0, 2).map(message => message.content), history.map(message => message.text));
  const answer = "Persze, meghallgatlak. Mesélj arról, mi bánt most.";
  const reply2 = await checkReply({ userText: input2.text, recentMessages: history,
    replyResult: { text: answer, speechText: answer, sourceType: "ai", sourceRef: "ai" },
    logContext: { requestId: input2.id, sessionId, characterId } }, verdict);
  assert.equal(reply2.text, answer);
  assert.equal(reply2.replyRecoveryState, undefined, "approved answer must not inherit earlier failure metadata");
  await insertMessage(connection, { ...base, senderType: "character", text: reply2.text, displayOrder: 40, sourceType: "ai",
    sourceRef: `guest-reply:${input2.id}`, replyRecoveryState: reply2.replyRecoveryState, productRequestState });
  const after = await listRecentMessagesBeforeOrder(connection, { sessionId, beforeDisplayOrder: 50 });
  assert.equal(after[3].replyRecoveryState, undefined);
  assert.deepEqual(after[3].productRequestState, productRequestState);
  const client = await listMessagesForSessionWithDb(connection, sessionId);
  assert.equal(client.length, 4);
  assert.equal(JSON.stringify(client).includes("_replyRecovery"), false);
  assert.equal(JSON.stringify(client).includes("_productRequestScope"), false);
  assert.equal(assessmentCalls, 2, "exactly one controlled assessment per turn; no retries");
  assert.equal(providerEvents.length, 2);
  assert.deepEqual(providerEvents.map(event => [event.requestId, event.sessionId]), [[input1.id, sessionId], [input2.id, sessionId]]);
  assert.deepEqual(diagnostics.map(event => [event.requestId, event.sessionId]), [[input1.id, sessionId], [input2.id, sessionId]]);
  assert.equal(JSON.parse(diagnostics[0].errorMessage).fallbackKind, "language");
  assert.equal(JSON.parse(diagnostics[1].errorMessage).guardApplied, false);
  const input3 = await insertMessage(connection, { ...base, senderType: "user", text: "Köszönöm, vigyázz magadra!", displayOrder: 50, sourceType: "user", sourceRef: "user-input" });
  let generations = 0, languageChecks = 0;
  const events = [];
  const regeneratedText = "Szívesen, vigyázz te is magadra!";
  const regenerated = await enforceReplyBoundary({ replyResult: { text: "Initial candidate.", speechText: "Initial candidate.", sourceType: "ai" },
    userText: input3.text, language: "hu", character, languageQualityRequired: true, independentLanguageQualityRequired: true,
    logContext: { requestId: input3.id, sessionId, characterId }, recordReview: async event => events.push(buildReplyReviewLogEvent(event)),
    assessLanguageQuality: async () => ++languageChecks === 1 ? { reviewStatus: "invalid_fields", protocolFailure: "span_mismatch" }
      : { reviewStatus: "valid", confidence: .54, languageQualitySupported: true, severity: "none", languageIssues: [] },
    regenerateReply: async () => { generations++; return { text: regeneratedText, speechText: regeneratedText, sourceType: "ai" }; } });
  assert.equal(regenerated.text, regeneratedText);
  assert.equal(generations, 1); assert.equal(languageChecks, 2);
  const saved = await insertMessage(connection, { ...base, senderType: "character", text: regenerated.text, displayOrder: 60, sourceType: "ai",
    sourceRef: `guest-reply:${input3.id}`, replyRecoveryState: regenerated.replyRecoveryState, productRequestState });
  assert.equal(saved.replyRecoveryState, undefined, "successful regeneration cannot persist the previous failed candidate's guard state");
  const projected = await listMessagesForSessionWithDb(connection, sessionId);
  assert.equal(projected.length, 6); assert.equal(projected.at(-1).text, regeneratedText);
  const logged = JSON.parse(events[0].errorMessage);
  assert.equal(logged.regeneration.initialProtocol, "span_mismatch"); assert.equal(logged.languageReview.confidence, .54);
  assert.equal(events[0].requestId, input3.id); assert.equal(events[0].sessionId, sessionId);
  passed = true;
} finally {
  try {
    if (connection) {
      try {
        if (transactionStarted) await connection.rollback();
        for (const [table, column, id] of [["chat_messages", "session_id", sessionId], ["chat_sessions", "id", sessionId], ["guest_sessions", "id", guestId]]) {
          const [[row]] = await connection.execute(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`, [id]);
          assert.equal(Number(row.count), 0, `${table} fixture must leave no residual rows`);
        }
      } finally { connection.release(); }
    }
  } finally { await closeDbPool(); }
}
assert.equal(passed, true);
console.log("Local recovery service check passed (real loopback MySQL transaction rolled back, 2 controlled HTTP assessments + regeneration/persistence at .54, 0 residual rows, no paid/voice/image calls).");
