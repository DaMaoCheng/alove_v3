import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  consumeVoiceAutoplayIds,
  ensureVoiceAutoplayState,
  markVoiceMessagesForAutoplay,
} from "../src/app/chat-voice-autoplay-state.js";

const appState = { chat: {} };
assert.deepEqual(ensureVoiceAutoplayState(appState), {}, "voice autoplay state should be initialized when missing");

markVoiceMessagesForAutoplay(appState, "char-read", [
  { id: "m1", senderType: "character", voice: { audioUrl: "/m1.mp3", assetStatus: "ready" } },
  { id: "m2", senderType: "character", voice: { audioUrl: "/m2.mp3", assetStatus: "ready" } },
]);

assert.deepEqual(
  consumeVoiceAutoplayIds(appState, "char-read", [
    { id: "m1", senderType: "character", voice: { audioUrl: "/m1.mp3", assetStatus: "ready" } },
  ]),
  ["m1"],
  "entering a chat should only consume unread voice ids that are currently available"
);
assert.deepEqual(
  appState.chat.voiceAutoplayByCharacterId["char-read"],
  ["m2"],
  "unloaded unread voice ids should remain queued instead of being lost"
);

assert.deepEqual(
  consumeVoiceAutoplayIds(appState, "char-read", [
    { id: "m2", senderType: "character", voice: { audioUrl: "/m2.mp3", assetStatus: "ready" } },
  ]),
  ["m2"],
  "remaining unread voice ids should play once their messages are available"
);

assert.deepEqual(
  consumeVoiceAutoplayIds(appState, "char-read", [
    { id: "m2", senderType: "character", voice: { audioUrl: "/m2.mp3", assetStatus: "ready" } },
  ]),
  [],
  "read voice ids should not replay after they are consumed"
);

const sessionSource = readFileSync("src/app/app-session-actions.js", "utf8");
const authStateSource = readFileSync("src/app/app-auth-state.js", "utf8");
const dataSource = readFileSync("src/app/chat-data-actions.js", "utf8");

assert.match(sessionSource, /resetAuthenticatedState\(appState, \{ reason: "logout" \}\)/, "logout should use the shared authenticated-state reset");
assert.match(authStateSource, /voiceAutoplayByCharacterId\s*=\s*\{\}/, "shared authenticated-state reset should clear unread voice autoplay state");
assert.match(dataSource, /voiceAutoplayByCharacterId\s*=\s*\{\}/, "unauthenticated chat contact load should clear unread voice autoplay state");

console.log("chat read state self-check passed");
