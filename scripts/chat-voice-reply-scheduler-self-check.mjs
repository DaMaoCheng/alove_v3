import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appChatActionsSource = readFileSync("src/app/app-chat-actions.js", "utf8");
const voiceActionsSource = readFileSync("src/app/chat-voice-actions.js", "utf8");

assert.match(
  appChatActionsSource,
  /const replyScheduler = createChatReplyScheduler\(/,
  "chat actions should create one shared reply scheduler"
);
assert.match(
  appChatActionsSource,
  /const voiceActions = createChatVoiceActions\(\{[\s\S]*\.\.\.replyScheduler,[\s\S]*\}\);/,
  "voice message actions should receive the shared reply scheduler"
);
assert.match(
  voiceActionsSource,
  /scheduleDelayedReply\?\.\(normalizedCharacterId, userTextMessage\.id\)/,
  "voice message submit should schedule an AI reply after ASR returns a user text message"
);
assert.match(
  voiceActionsSource,
  /hasActiveReplyScheduler\?\.\(normalizedCharacterId\)/,
  "voice message submit should preserve typing indicator while a scheduled reply is pending"
);

console.log("chat voice reply scheduler self-check passed");
