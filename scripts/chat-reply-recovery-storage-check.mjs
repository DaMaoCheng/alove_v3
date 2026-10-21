import assert from "node:assert/strict";
import mysql from "mysql2/promise";

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Unexpected network request in recovery storage check"); };
const { insertMessage, mapMessageRow, listRecentMessagesBeforeOrder } = await import("../server/chat-message-store.js");
const { buildChatReplyPrompt } = await import("../server/chat-prompt-service.js");
const state = { version: 1, kind: "language", reviewStatus: "valid", failedContracts: ["language"], guardApplied: true };
const legacy = { note: "preserve" };
const calls = [];
const db = { execute: async (sql, params) => { calls.push({ sql, params }); return [{}]; } };
const base = { sessionId: "fixture_session", characterId: "fixture_character", senderType: "character", senderLabel: "Fixture",
  contentType: "text", text: "I could not phrase that clearly.", displayOrder: 20, sourceType: "ai", sourceRef: "guest-reply:fixture_message" };
const inserted = await insertMessage(db, { ...base, product: legacy, replyRecoveryState: state });
assert.deepEqual(JSON.parse(calls[0].params[9]), { ...legacy, _replyRecovery: state }, "degraded state must survive text persistence");
assert.deepEqual(inserted.product, legacy, "immediate client projection must strip recovery metadata");
assert.equal(calls[0].params[13], base.sourceRef, "reply association must remain unchanged");
assert.equal(calls[0].params.length, 14, "no schema change");
assert.deepEqual(mapMessageRow({ content_type: "text", product_payload_json: calls[0].params[9] }).product, legacy);
assert.equal(mapMessageRow({ content_type: "text", product_payload_json: JSON.stringify({ _replyRecovery: state }) }).product, null);
const rows = [
  { id: "prior", sender_type: "character", content_type: "text", text_content: base.text, display_order: 20, product_payload_json: calls[0].params[9] },
  { id: "user", sender_type: "user", content_type: "text", text_content: "Szerver hiba", display_order: 30, product_payload_json: JSON.stringify({ _replyRecovery: state }) },
  { id: "old", sender_type: "character", content_type: "text", text_content: "old unmarked reply", display_order: 40, product_payload_json: null },
];
let query;
const history = await listRecentMessagesBeforeOrder({ execute: async (sql, params) => { query = { sql, params }; return [rows]; } }, { sessionId: base.sessionId, beforeDisplayOrder: 50 });
assert.deepEqual(history[0].replyRecoveryState, state);
assert.equal(history[1].replyRecoveryState, undefined, "user text cannot carry server recovery state");
assert.equal(history[2].replyRecoveryState, undefined, "old unmarked messages are untouched");
assert.deepEqual(query.params, [base.sessionId, 50]);
const prompt = buildChatReplyPrompt({ recentMessages: history, userText: "Please answer what I said." });
const recovery = prompt.layers.find(layer => layer.id === "reply_recovery");
assert.ok(recovery?.content.includes("1"), "prompt marks known failure position");
assert.ok(recovery.content.includes("checkout"), "does not interpret user frustration as a checkout problem");
assert.ok(!recovery.content.includes(base.text), "no duplicate raw message content in recovery layer");
assert.deepEqual(prompt.messages.slice(0, 3).map(message => message.content), rows.map(row => row.text_content), "preserve raw history and user text");
assert.equal(buildChatReplyPrompt({ recentMessages: history.slice(1), userText: "hello" }).layers.some(layer => layer.id === "reply_recovery"), false);
assert.equal(buildChatReplyPrompt({ recentMessages: [history[0], ...Array.from({ length: 50 }, () => history[2])], userText: "hello" }).layers.some(layer => layer.id === "reply_recovery"), false,
  "only the actual last 50 prompt messages can contribute recovery markers");
const { normalizeReplyRecoveryState } = await import("../server/chat-reply-recovery-state.js");
assert.deepEqual(normalizeReplyRecoveryState({ ...state, secret: "must not persist" }), state);
for (const invalid of [null, { ...state, guardApplied: false }, { ...state, version: 2 }, { ...state, kind: "invented" },
  { ...state, failedContracts: ["raw secret"] }, { ...state, reviewStatus: "secret" }, { ...state, failedContracts: Array(100).fill("language") }]) {
  assert.equal(normalizeReplyRecoveryState(invalid), null);
  await insertMessage(db, { ...base, product: legacy, replyRecoveryState: invalid });
  assert.deepEqual(JSON.parse(calls.at(-1).params[9]), legacy);
}
for (const payload of [null, "legacy scalar", [1], legacy]) {
  assert.deepEqual(mapMessageRow({ content_type: "text", product_payload_json: JSON.stringify(payload) }).product, payload);
}
await insertMessage(db, { ...base, senderType: "user", product: legacy, replyRecoveryState: state });
assert.deepEqual(JSON.parse(calls.at(-1).params[9]), legacy, "do not write recovery state for user messages");
await insertMessage(db, { ...base, contentType: "feedback_action", product: legacy, replyRecoveryState: state });
assert.deepEqual(JSON.parse(calls.at(-1).params[9]), legacy, "do not change non-text payloads");
const scopeState = { version: 1, status: "cleared", siteId: "fixture_site", characterId: base.characterId,
  items: [], selectedIndex: null, clarificationCount: 0 };
const combined = await insertMessage(db, { ...base, product: legacy, productRequestState: scopeState, replyRecoveryState: state });
assert.deepEqual(JSON.parse(calls.at(-1).params[9]), { ...legacy, _productRequestScope: scopeState, _replyRecovery: state },
  "recovery state must coexist with existing product request state");
assert.deepEqual(combined.product, legacy, "both internal namespaces stay private");
const originalCreatePool = mysql.createPool;
const reportPayload = { ...legacy, _replyRecovery: state };
const reportRows = [
  { content_type: "text", product_payload_json: JSON.stringify(reportPayload) },
  { content_type: "text", product_payload_json: JSON.stringify({ _replyRecovery: state }) },
  { content_type: "text", product_payload_json: reportPayload },
  { content_type: "text", product_payload_json: ' { "note" : "preserve" } ' },
  { content_type: "text", product_payload_json: "invalid legacy JSON" },
  { content_type: "feedback_action", product_payload_json: JSON.stringify(legacy) },
];
mysql.createPool = () => ({ execute: async sql => sql.includes("FROM chat_sessions") ? [[{ id: base.sessionId }]] : [reportRows] });
try {
  const { getReportingConversation, getReportingGuestConversation } = await import("../server/reporting-data-service.js");
  const token = { allSites: true, siteIds: [], scopes: ["messages:read"] };
  for (const result of [await getReportingConversation(token, new URL("https://fixture.invalid"), "user_fixture", base.sessionId),
    await getReportingGuestConversation(token, "guest_fixture", base.sessionId)]) {
    const messages = result.item.messages;
    assert.deepEqual(messages[0].productPayload, legacy, "report camel projection strips recovery");
    assert.deepEqual(JSON.parse(messages[0].product_payload_json), legacy, "report raw string strips recovery");
    assert.equal(messages[1].productPayload, null);
    assert.equal(messages[1].product_payload_json, "null");
    assert.deepEqual(messages[2].product_payload_json, legacy, "report raw object strips recovery");
    assert.equal(messages[3].product_payload_json, reportRows[3].product_payload_json, "keep unrelated JSON formatting");
    assert.equal(messages[4].product_payload_json, reportRows[4].product_payload_json, "keep invalid legacy raw JSON");
    assert.deepEqual(messages[5].productPayload, legacy, "non-text report unchanged");
    assert.equal(JSON.stringify(messages).includes("_replyRecovery"), false);
  }
} finally { mysql.createPool = originalCreatePool; }
console.log("Reply recovery storage and prompt check passed (mocked DB, no network/model calls).");
