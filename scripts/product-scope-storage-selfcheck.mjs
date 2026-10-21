import assert from "node:assert/strict";
import mysql from "mysql2/promise";

process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("Unexpected network request in storage self-check"); };
const namespace = "_productRequestScope";
const state = { version: 1, status: "pending", siteId: "site_fixture", characterId: "mascot_fixture", clarificationCount: 1,
  items: [
    { evidence: "Real Madrid shirt", sharedEvidence: "both M", text: "Real Madrid shirt both M" },
    { evidence: "Barcelona shirt", sharedEvidence: "both M", text: "Barcelona shirt both M" },
  ], selectedIndex: null };
const legacy = { legacyNote: "preserve", unknown: { nested: [1, "two"] } };
const payload = { ...legacy, [namespace]: state };
let checks = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const reportingCalls = [];
let reportingRows = [];
let reportingSession = { id: "session_fixture", site_id: state.siteId, character_id: state.characterId };
const reportDb = { execute: async (sql, params) => {
  reportingCalls.push({ sql, params });
  return sql.includes("FROM chat_sessions") ? [[reportingSession].filter(Boolean)] : [reportingRows];
} };
const originalCreatePool = mysql.createPool;
mysql.createPool = () => reportDb;
const { insertMessage, mapMessageRow, listRecentMessagesBeforeOrder } = await import("../server/chat-message-store.js");
const { getReportingConversation, getReportingGuestConversation } = await import("../server/reporting-data-service.js");
const { readProductRequestState } = await import("../server/product-request-scope-service.js");

check(mapMessageRow({ content_type: "text", product_payload_json: JSON.stringify(payload) }).product, legacy,
  "stored text client projection removes private scope while preserving unknown old JSON keys");
check(mapMessageRow({ content_type: "text", product_payload_json: JSON.stringify({ [namespace]: state }) }).product, null,
  "private-only stored text has no client product");
check(mapMessageRow({ content_type: "feedback_action", product_payload_json: JSON.stringify(payload) }).product, payload,
  "non-text payload behavior remains unchanged");
for (const value of [null, "legacy scalar", [1, { old: true }], legacy]) {
  check(mapMessageRow({ content_type: "text", product_payload_json: JSON.stringify(value) }).product, value,
    "ordinary text JSON types remain unchanged");
}

const insertCalls = [];
const db = { execute: async (sql, params) => { insertCalls.push({ sql, params }); return [{}]; } };
const base = { sessionId: "session_fixture", characterId: state.characterId, senderType: "character", senderLabel: "Fixture",
  contentType: "text", text: "Which item first?", displayOrder: 20, sourceType: "ai", sourceRef: "guest-reply:fixture:product-clarification" };
const inserted = await insertMessage(db, { ...base, product: legacy, productRequestState: state });
check(JSON.parse(insertCalls[0].params[9]), payload, "insert merges validated scope into existing text JSON");
check(inserted.product, legacy, "immediate insert result never exposes private scope");
check(insertCalls[0].params[13], base.sourceRef, "guest exact reply source reference remains unchanged");
check(insertCalls[0].params.length, 14, "existing INSERT columns and parameter count remain unchanged");
check(insertCalls[0].sql.includes("product_payload_json"), true, "scope uses existing JSON column");
const privateOnly = await insertMessage(db, { ...base, productRequestState: state });
check(privateOnly.product, null, "private-only immediate result does not masquerade as product");
check(JSON.parse(insertCalls.at(-1).params[9])[namespace], state, "private-only state survives persistence");
const ordinary = await insertMessage(db, { ...base, product: legacy });
check(ordinary.product, legacy, "ordinary insert return is preserved");
check(JSON.parse(insertCalls.at(-1).params[9]), legacy, "ordinary insert does not add state");
const noPayload = await insertMessage(db, base);
check(noPayload.product, null, "ordinary text without payload remains null");
check(insertCalls.at(-1).params[9], null, "ordinary text without payload stores NULL");
const nonText = await insertMessage(db, { ...base, contentType: "feedback_action", product: payload, productRequestState: state });
check(nonText.product, payload, "non-text insert does not strip or reinterpret its existing payload");
check(JSON.parse(insertCalls.at(-1).params[9]), payload, "non-text persistence remains unchanged");
const invalidState = { ...state, version: 99, status: "invented", secret: "must-not-persist" };
await insertMessage(db, { ...base, product: legacy, productRequestState: invalidState });
check(JSON.parse(insertCalls.at(-1).params[9]), legacy, "invalid internal state cannot replace old text JSON");
for (const durableState of [{ ...state, status: "selected", selectedIndex: 1 },
  { ...state, status: "cleared", selectedIndex: null, clarificationCount: 0, items: [] }]) {
  const result = await insertMessage(db, { ...base, product: legacy, productRequestState: durableState });
  check(JSON.parse(insertCalls.at(-1).params[9]), { ...legacy, [namespace]: durableState }, "selected/cleared boundary survives storage");
  check(result.product, legacy, "selected/cleared state stays private in immediate result");
}
for (const invalid of [{ ...state, clarificationCount: 3 }, { ...state, status: "selected", selectedIndex: 9 },
  { ...state, items: state.items.map((item) => ({ ...item, text: "unverified reconstructed condition" })) }]) {
  await insertMessage(db, { ...base, product: payload, productRequestState: invalid });
  check(JSON.parse(insertCalls.at(-1).params[9]), legacy, "malformed state is removed without damaging unrelated payload keys");
}
await insertMessage(db, { ...base, product: legacy, productRequestState: { ...state, secret: "never persist arbitrary fields" } });
check(JSON.parse(insertCalls.at(-1).params[9]), payload, "state validator omits arbitrary extra fields");

let historyCall;
const sentAt = new Date("2026-10-10T08:00:00Z");
const history = await listRecentMessagesBeforeOrder({ execute: async (sql, params) => {
  historyCall = { sql, params };
  return [[
    { id: "msg_pending", sender_type: "character", content_type: "text", text_content: base.text, product_payload_json: JSON.stringify(payload),
      character_id: state.characterId, display_order: 20, sent_at: sentAt },
    { id: "msg_old", sender_type: "character", content_type: "text", text_content: "old", product_payload_json: JSON.stringify(legacy),
      character_id: state.characterId, display_order: 10, sent_at: sentAt },
    { id: "msg_card", sender_type: "character", content_type: "product", text_content: "", product_payload_json: JSON.stringify({ name: "Fixture shirt", id: "product_fixture" }),
      character_id: state.characterId, display_order: 30, sent_at: sentAt },
  ]];
} }, { sessionId: base.sessionId, beforeDisplayOrder: 40 });
check(history[0].productRequestState, state, "server history recovers only namespaced selection state");
check(history[0].product, null, "text state never masquerades as a recent card");
check(history[0].id, "msg_pending", "server history includes message ID");
check(history[0].displayOrder, 20, "server history includes display order");
check(history[0].characterId, state.characterId, "server history includes character scope");
check(history[0].sentAt, sentAt, "server history includes timestamp");
check(history[0].sourceRef, undefined, "existing ordinary clarification source mapping is not broadened");
check(history[0].unknown, undefined, "unknown old text JSON does not enter server context");
check(history[1].productRequestState ?? null, null, "ordinary history has no request state");
check(Object.hasOwn(history[1], "productRequestState"), false, "ordinary text does not create a false scope boundary");
check(Object.hasOwn(history[2], "productRequestState"), false, "ordinary product card does not create a false scope boundary");
check(readProductRequestState([history[0], history[1], history[2]], { siteId: state.siteId, characterId: state.characterId }), state,
  "later ordinary text/card cannot erase durable pending selection");
check(history[2].product.name, "Fixture shirt", "existing card history remains available");
check(historyCall.params, [base.sessionId, 40], "history keeps session/order isolation");
check(await listRecentMessagesBeforeOrder({ execute: async () => { throw new Error("invalid order queried DB"); } }, { sessionId: base.sessionId, beforeDisplayOrder: 0 }), [], "invalid history order remains query-free");

reportingRows = [
  { id: "private_old", content_type: "text", product_payload_json: JSON.stringify(payload) },
  { id: "private_only", content_type: "text", product_payload_json: JSON.stringify({ [namespace]: state }) },
  { id: "ordinary", content_type: "text", product_payload_json: ' { "legacyNote" : "preserve" } ' },
  { id: "invalid", content_type: "text", product_payload_json: "invalid old JSON" },
  { id: "object", content_type: "text", product_payload_json: payload },
  { id: "card", content_type: "product", product_payload_json: JSON.stringify(payload) },
];
const token = { allSites: true, siteIds: [], scopes: ["messages:read"] };
const url = new URL("https://fixture.invalid/report");
for (const result of [await getReportingGuestConversation(token, "guest_fixture", base.sessionId),
  await getReportingConversation(token, url, "user_fixture", base.sessionId)]) {
  const rows = result.item.messages;
  check(rows[0].productPayload, legacy, "report camel payload strips scope");
  check(JSON.parse(rows[0].product_payload_json), legacy, "report raw string payload strips scope");
  check(typeof rows[0].product_payload_json, "string", "report raw string type is preserved");
  check(rows[1].productPayload, null, "report private-only camel payload is null");
  check(rows[1].product_payload_json, "null", "report private-only raw JSON preserves string type");
  check(rows[2].product_payload_json, reportingRows[2].product_payload_json, "unrelated old JSON formatting remains unchanged");
  check(rows[3].product_payload_json, "invalid old JSON", "invalid unrelated raw JSON remains unchanged");
  check(rows[3].productPayload, null, "invalid JSON camel projection remains unchanged");
  check(rows[4].product_payload_json, legacy, "raw object scope is stripped while preserving object type");
  check(rows[4].productPayload, null, "pre-existing safeJson behavior for raw objects remains unchanged");
  check(rows[5].product_payload_json, reportingRows[5].product_payload_json, "non-text report raw payload remains unchanged");
  check(rows[5].productPayload, payload, "non-text report camel payload remains unchanged");
  check(JSON.stringify(rows.slice(0, 5)).includes(namespace), false, "both text reporting projections have zero private namespace");
}
const callsBefore = reportingCalls.length;
check((await getReportingGuestConversation({ ...token, scopes: [] }, "guest_fixture", base.sessionId)).item.messages, [],
  "missing messages:read still returns no messages");
check(reportingCalls.length - callsBefore, 1, "missing message scope does not query message data");
await getReportingGuestConversation({ ...token, allSites: false, siteIds: [state.siteId] }, "guest_fixture", base.sessionId);
const scopedCall = reportingCalls.at(-2);
check(scopedCall.sql.includes("g.site_id IN (?)"), true, "site-limited reporting SQL retains site permission constraint");
check(scopedCall.params, ["guest_fixture", base.sessionId, state.siteId], "site-limited reporting bind parameters remain scoped");
await assert.rejects(() => getReportingGuestConversation({ allSites: false, siteIds: [], scopes: token.scopes }, "guest_fixture", base.sessionId),
  (error) => error.statusCode === 403 || error.status === 403); checks++;
reportingSession = null;
await assert.rejects(() => getReportingGuestConversation(token, "guest_fixture", base.sessionId),
  (error) => error.statusCode === 404 || error.status === 404); checks++;
mysql.createPool = originalCreatePool;
console.log(`Product scope storage self-check passed (${checks} assertions; fake DB only, no network).`);
