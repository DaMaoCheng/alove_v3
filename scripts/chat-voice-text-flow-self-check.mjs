import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/app/chat-voice-actions.js", import.meta.url), "utf8");

assert.match(source, /scheduleDelayedReply/, "voice messages should reuse delayed reply scheduling");
assert.match(source, /contentType\s*===\s*["']text["']/, "voice transcript should be returned as a text user message");
assert.doesNotMatch(source, /sendChatVoiceReply/, "voice submit should not use the old immediate voice reply endpoint");
assert.doesNotMatch(source, /contentType\s*===\s*["']voice["']/, "voice submit should not wait for a voice bubble message before replying");

console.log("Chat voice text-flow self-check passed");
