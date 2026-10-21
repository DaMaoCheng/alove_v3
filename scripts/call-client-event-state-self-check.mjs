import assert from "node:assert/strict";
import { applyCallClientEventState, formatCallLatencyText } from "../src/features/call-modal/call-client-event-state.js";

function createState({ guestActive = true } = {}) {
  return {
    call: {
      status: "listening",
      turnStatus: "Listening",
      sessionId: "call_1",
      liveText: "",
      liveSpeaker: "",
      latencyText: "",
      error: "",
    },
    chat: {
      guest: {
        active: guestActive,
        messageLimit: 30,
        messageCount: 5,
      },
    },
  };
}

const endedState = createState();
assert.deepEqual(
  applyCallClientEventState(endedState, {
    type: "status",
    status: "ended",
    text: "Call ended",
    payload: { callSessionId: "call_2", reason: "message_limit_reached" },
  }),
  { finishLifecycle: true, mergeMessagesPayload: null, refreshGuestChat: true }
);
assert.equal(endedState.call.status, "ended");
assert.equal(endedState.call.turnStatus, "Call ended");
assert.equal(endedState.call.sessionId, "call_2");

const transcriptState = createState();
applyCallClientEventState(transcriptState, { type: "partial", text: "hello" });
assert.equal(transcriptState.call.liveText, "hello");
assert.equal(transcriptState.call.liveSpeaker, "user");
assert.equal(transcriptState.call.turnStatus, "Listening");
applyCallClientEventState(transcriptState, { type: "final", text: "hello there" });
assert.equal(transcriptState.call.turnStatus, "Heard");

const assistantState = createState();
const assistantPayload = { message: { text: "Hi" }, items: [{ id: "message_1" }] };
assert.deepEqual(
  applyCallClientEventState(assistantState, { type: "assistant", payload: assistantPayload }),
  { finishLifecycle: false, mergeMessagesPayload: assistantPayload, refreshGuestChat: false }
);
assert.equal(assistantState.call.liveText, "Hi");
assert.equal(assistantState.call.liveSpeaker, "assistant");

const userMessagePayload = { items: [{ id: "message_2" }] };
assert.equal(
  applyCallClientEventState(createState(), { type: "user_message", payload: userMessagePayload }).mergeMessagesPayload,
  userMessagePayload
);

const errorState = createState();
const errorResult = applyCallClientEventState(errorState, {
  type: "error",
  text: "Limit reached",
  payload: { code: "GUEST_MESSAGE_LIMIT_REACHED" },
});
assert.equal(errorState.call.status, "error");
assert.equal(errorState.call.error, "Limit reached");
assert.equal(errorState.call.turnStatus, "Call unavailable");
assert.equal(errorResult.refreshGuestChat, true);

const diagnosticsState = createState();
applyCallClientEventState(diagnosticsState, {
  type: "diagnostics",
  diagnostics: { heardMs: 1250, assistantWaitMs: 2400 },
});
assert.equal(diagnosticsState.call.latencyText, "Heard 1.3s · Reply 2.4s");
assert.equal(formatCallLatencyText({ timing: { replyTotalMs: 3050 } }), "Reply 3.0s");
assert.equal(formatCallLatencyText({ timing: { replyTotalMs: 3050 } }, "Chinese (Mandarin)"), "回复 3.0s");

const usageState = createState();
const usageResult = applyCallClientEventState(usageState, {
  type: "usage",
  payload: { messageLimit: 30, messageCount: 30 },
});
assert.equal(usageState.chat.guest.messageLimit, 30);
assert.equal(usageState.chat.guest.messageCount, 30);
assert.equal(usageResult.refreshGuestChat, true);

const formalState = createState({ guestActive: false });
applyCallClientEventState(formalState, {
  type: "usage",
  payload: { messageLimit: 30, messageCount: 30 },
});
assert.equal(formalState.chat.guest.messageCount, 5, "formal account calls should not mutate guest usage state");

console.log("call client event state self-check passed");
