import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";
import {
  buildGuestTurnSourceRef,
  resolveGuestTurnStartDisplayOrder,
  resolveStoredGuestTurnText,
} from "../server/guest-turn-service.js";

const guestReplySource = readFileSync("server/guest-reply-service.js", "utf8");
const guestTurnSource = readFileSync("server/guest-turn-service.js", "utf8");
const voiceReplySource = readFileSync("server/chat-voice-message-service.js", "utf8");

assert.match(
  guestReplySource,
  /listRecentMessagesBeforeOrder[\s\S]*beforeDisplayOrder:\s*prepared\.promptBeforeDisplayOrder/,
  "guest replies must exclude every message from the current persisted turn"
);
assert.match(
  guestTurnSource,
  /promptBeforeDisplayOrder/,
  "guest turn preparation must preserve the first display order of the current turn"
);
assert.match(
  voiceReplySource,
  /listRecentMessagesBeforeOrder[\s\S]*beforeDisplayOrder:\s*Number\(userMessage\?\.display_order/,
  "formal voice replies must exclude the persisted current transcript from recent history"
);

const formalVoicePrompt = buildChatReplyPrompt({
  character: { name: "Boundary Check", personaPrompt: "Keep continuity." },
  recentMessages: [
    { senderType: "user", text: "earlier voice" },
    { senderType: "character", text: "earlier reply" },
  ],
  userText: "current voice",
});
assert.equal(countUserText(formalVoicePrompt.messages, "current voice"), 1);

const guestAttachmentText = "current guest text\nAttachment: current-shirt.jpg";
const guestAttachmentPrompt = buildChatReplyPrompt({
  character: { name: "Boundary Check", personaPrompt: "Keep continuity." },
  recentMessages: [
    { senderType: "user", text: "earlier guest text" },
    { senderType: "character", text: "earlier guest reply" },
  ],
  userText: guestAttachmentText,
});
assert.equal(countUserText(guestAttachmentPrompt.messages, guestAttachmentText), 1);

const repeatedTextPrompt = buildChatReplyPrompt({
  character: { name: "Boundary Check", personaPrompt: "Keep continuity." },
  recentMessages: [
    { senderType: "user", text: "same words" },
    { senderType: "character", text: "earlier reply" },
  ],
  userText: "same words",
});
assert.equal(
  countUserText(repeatedTextPrompt.messages, "same words"),
  2,
  "a legitimate earlier message with identical text must not be removed by string deduplication"
);

const executedQueries = [];
const restoredGuestOrder = await resolveGuestTurnStartDisplayOrder({
  async execute(sql, params) {
    executedQueries.push({ sql, params });
    if (executedQueries.length === 1) return [[{ has_attachments: 1 }]];
    return [[{ first_display_order: 20 }]];
  },
}, {
  guest: { id: "guest_boundary", chat_session_id: "session_boundary" },
  requestKey: "request_boundary",
  primaryMessage: { display_order: 40 },
});
assert.equal(restoredGuestOrder, 20, "guest retries should restore the first message order for a multi-message turn");
assert.match(executedQueries[2].sql, /guest_chat_attachments/, "guest turn recovery should include every attached message");
assert.deepEqual(
  executedQueries[2].params,
  [
    "guest_boundary",
    "request_boundary",
    "session_boundary",
    "guest_boundary",
    "request_boundary",
    buildGuestTurnSourceRef("request_boundary"),
  ],
);
assert.equal(executedQueries.length, 3, "attachment turns should select the source-ref generation before resolving the full turn boundary");

const textLookupQueries = [];
const restoredCurrentText = await resolveStoredGuestTurnText({
  async execute(sql, params) {
    textLookupQueries.push({ sql, params });
    return [[{ text_content: "current hashed text" }]];
  },
}, {
  guest: { id: "guest_boundary", chat_session_id: "session_boundary" },
  requestKey: `${"x".repeat(127)}b`,
  primaryMessage: { content_type: "attachment", text_content: "" },
  attachments: [],
});
assert.equal(restoredCurrentText, "current hashed text");
assert.equal(textLookupQueries.length, 1, "a current hashed text row must win before legacy fallback is considered");

let legacyFallbackQueryCount = 0;
const restoredLegacyOrder = await resolveGuestTurnStartDisplayOrder({
  async execute() {
    legacyFallbackQueryCount += 1;
    if (legacyFallbackQueryCount === 1) return [[{ has_attachments: 1 }]];
    return legacyFallbackQueryCount === 2
      ? [[{ first_display_order: null }]]
      : [[{ first_display_order: 20 }]];
  },
}, {
  guest: { id: "guest_boundary", chat_session_id: "session_boundary" },
  requestKey: "legacy_request_boundary",
  primaryMessage: { display_order: 40 },
});
assert.equal(restoredLegacyOrder, 20, "legacy text must remain the first boundary even when a later attachment carries the full client id");
assert.equal(legacyFallbackQueryCount, 3);

const pureTurnQueries = [];
const pureTurnOrder = await resolveGuestTurnStartDisplayOrder({
  async execute(sql, params) {
    pureTurnQueries.push({ sql, params });
    return pureTurnQueries.length === 1
      ? [[{ has_attachments: 0 }]]
      : [[{ first_display_order: 40 }]];
  },
}, {
  guest: { id: "guest_boundary", chat_session_id: "session_boundary" },
  requestKey: `${"x".repeat(127)}c`,
  primaryMessage: { display_order: 40 },
});
assert.equal(pureTurnOrder, 40);
assert.equal(pureTurnQueries.length, 2);
assert.match(pureTurnQueries[1].sql, /client_message_id = \?/);
assert.doesNotMatch(pureTurnQueries[1].sql, /source_ref/, "pure text, voice, and call turns must not use legacy source-ref matching");

const sharedPrefix = "x".repeat(127);
const firstLongRequestRef = buildGuestTurnSourceRef(`${sharedPrefix}a`);
const secondLongRequestRef = buildGuestTurnSourceRef(`${sharedPrefix}b`);
assert.notEqual(firstLongRequestRef, secondLongRequestRef, "long request keys with the same prefix must not share a turn source reference");
assert.ok(firstLongRequestRef.length <= 128, "hashed guest turn source references must fit the database column");

verifyProviderPayload();

console.log("chat current-turn prompt boundary self-check passed");

function countUserText(messages, text) {
  return messages.filter((message) => message?.role === "user" && message?.content === text).length;
}

function verifyProviderPayload() {
  runProviderPayloadCheck("responses");
  runProviderPayloadCheck("chat_completions");
}

function runProviderPayloadCheck(apiMode) {
  const code = `
    import assert from "node:assert/strict";
    process.env.OPENAI_API_KEY = "boundary-test-key";
    process.env.OPENAI_BASE_URL = "https://boundary.example.test/v1";
    process.env.OPENAI_MODEL = "boundary-test-model";
    process.env.OPENAI_API_MODE = "${apiMode}";
    let requestBody = null;
    globalThis.fetch = async (_url, options = {}) => {
      requestBody = JSON.parse(String(options.body || "{}"));
      return {
        ok: true,
        status: 200,
        async json() {
          return ${apiMode === "responses"
            ? "{ output_text: 'ok' }"
            : "{ choices: [{ message: { content: 'ok' } }] }"};
        },
      };
    };
    const { buildChatReplyPrompt } = await import("./server/chat-prompt-service.js");
    const { requestOpenAiReply } = await import("./server/ai-reply-provider-service.js");
    const marker = "provider-current-turn-marker";
    const prompt = buildChatReplyPrompt({
      character: { name: "Boundary Check", personaPrompt: "Keep continuity." },
      recentMessages: [
        { senderType: "user", text: "earlier turn" },
        { senderType: "character", text: "earlier reply" },
      ],
      userText: marker,
    });
    await requestOpenAiReply(prompt);
    const serializedSystem = String(${apiMode === "responses" ? "requestBody.instructions" : "requestBody.messages[0]?.content"} || "");
    const providerMessages = ${apiMode === "responses" ? "requestBody.input" : "requestBody.messages.slice(1)"};
    const currentMessages = providerMessages.filter((message) => message.role === "user" && message.content === marker);
    assert.equal(serializedSystem.includes(marker), false);
    assert.equal(currentMessages.length, 1);
    assert.equal(providerMessages.at(-1).content, marker);
  `;
  execFileSync(process.execPath, ["--input-type=module"], {
    cwd: process.cwd(),
    input: code,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
