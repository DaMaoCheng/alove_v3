import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectPlayableVoiceMessages,
} from "../src/features/chat/chat-voice-playback-queue.js";
import {
  collectReadyCharacterVoiceMessageIds,
  consumeVoiceAutoplayIds,
  markVoiceMessagesForAutoplay,
} from "../src/app/chat-voice-autoplay-state.js";

const messages = [
  { id: "old-ai", senderType: "character", displayOrder: 10, voice: { id: "v-old", audioUrl: "/voice/old.mp3", assetStatus: "ready" } },
  { id: "new-ai", senderType: "character", displayOrder: 20, voice: { id: "v-new", audioUrl: "/voice/new.mp3", assetStatus: "ready" } },
  { id: "pending-ai", senderType: "character", displayOrder: 30, voice: { id: "v-pending", audioUrl: "", assetStatus: "pending" } },
  { id: "user-voice", senderType: "user", displayOrder: 40, voice: { id: "v-user", audioUrl: "/voice/user.mp3", assetStatus: "ready" } },
];

assert.deepEqual(
  collectPlayableVoiceMessages(messages, { messageIds: ["new-ai"] }).map((item) => item.messageId),
  ["new-ai"],
  "auto playback should only collect explicitly unread/queued message ids"
);

assert.deepEqual(
  collectPlayableVoiceMessages(messages, { messageIds: [] }),
  [],
  "opening a chat with no unread voice ids should not enqueue old history"
);

assert.deepEqual(
  collectReadyCharacterVoiceMessageIds(messages),
  ["old-ai", "new-ai"],
  "only ready character voice messages should become unread/autoplay candidates"
);

const appState = {
  chat: {
    voiceAutoplayByCharacterId: {},
  },
};

markVoiceMessagesForAutoplay(appState, "char-1", [messages[1], messages[1], messages[2]]);
assert.deepEqual(
  appState.chat.voiceAutoplayByCharacterId["char-1"],
  ["new-ai"],
  "autoplay ids should be unique and only include ready character voice messages"
);

assert.deepEqual(
  consumeVoiceAutoplayIds(appState, "char-1"),
  ["new-ai"],
  "returning to a chat should consume unread voice ids once"
);
assert.deepEqual(
  consumeVoiceAutoplayIds(appState, "char-1"),
  [],
  "consumed unread voice ids should not replay on later remounts"
);

const viewFactorySource = readFileSync("src/app/app-view-factory.js", "utf8");
const replySchedulerSource = readFileSync("src/app/chat-reply-scheduler.js", "utf8");
const chatPageSource = readFileSync("src/features/chat/chat-page.js", "utf8");

assert.match(viewFactorySource, /consumeVoiceAutoplayIds/, "chat view should consume queued unread voice ids before rendering");
assert.match(chatPageSource, /voiceAutoPlayMessageIds/, "chat page should pass unread voice ids into playback binding");
assert.match(replySchedulerSource, /markVoiceMessagesForAutoplay/, "AI replies should mark voice messages for unread/autoplay playback");

console.log("chat unread voice playback self-check passed");
