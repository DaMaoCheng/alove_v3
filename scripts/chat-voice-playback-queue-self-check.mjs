import assert from "node:assert/strict";
import {
  createChatVoicePlaybackQueue,
  collectPlayableVoiceMessages,
} from "../src/features/chat/chat-voice-playback-queue.js";

const playable = collectPlayableVoiceMessages([
  { id: "u1", senderType: "user", voice: { audioUrl: "/uploads/voice/u.mp3", assetStatus: "ready" }, displayOrder: 10 },
  { id: "a1", senderType: "character", voice: { id: "v1", audioUrl: "/uploads/voice/a1.mp3", assetStatus: "ready" }, displayOrder: 20 },
  { id: "a2", senderType: "character", voice: { id: "v2", audioUrl: "", assetStatus: "failed" }, displayOrder: 30 },
  { id: "a3", senderType: "character", voice: { id: "v3", audioUrl: "/uploads/voice/a3.mp3", assetStatus: "ready" }, displayOrder: 40 },
]);

assert.deepEqual(
  playable.map((item) => item.messageId),
  ["a1", "a3"],
  "queue should only collect ready character voice messages in order"
);

const played = [];
const stopped = [];
let lastAudio = null;
const queue = createChatVoicePlaybackQueue({
  createAudio: (url) => {
    lastAudio = {
      url,
      paused: true,
      currentTime: 0,
      listeners: {},
      play() {
        this.paused = false;
        played.push(url);
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
        stopped.push(url);
      },
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
    };
    return lastAudio;
  },
});

queue.enqueue(playable);
assert.equal(queue.getState().queueLength, 2);
await queue.playNext();
assert.deepEqual(played, ["/uploads/voice/a1.mp3"]);
assert.equal(queue.getState().currentMessageId, "a1");

lastAudio.listeners.ended();
assert.deepEqual(played, ["/uploads/voice/a1.mp3", "/uploads/voice/a3.mp3"], "queue should continue in order after audio ends");
assert.equal(queue.getState().currentMessageId, "a3");

queue.pauseAll();
assert.equal(queue.getState().autoPaused, true, "manual pause should pause the whole queue");
assert.deepEqual(stopped, ["/uploads/voice/a3.mp3"]);

queue.enqueue([{ messageId: "a4", voiceId: "v4", audioUrl: "/uploads/voice/a4.mp3", displayOrder: 50 }]);
await queue.playNext();
assert.deepEqual(played, ["/uploads/voice/a1.mp3", "/uploads/voice/a3.mp3"], "auto-paused queue should not continue automatically");

queue.stopAll();
assert.equal(queue.getState().queueLength, 0);
assert.equal(queue.getState().currentMessageId, "");

queue.enqueue([{ messageId: "a1", voiceId: "v1", audioUrl: "/uploads/voice/a1.mp3", displayOrder: 20 }]);
await queue.resumeAuto();
assert.deepEqual(
  played,
  ["/uploads/voice/a1.mp3", "/uploads/voice/a3.mp3"],
  "auto enqueue should not replay a message that was already consumed"
);

queue.enqueue([{ messageId: "a1", voiceId: "v1", audioUrl: "/uploads/voice/a1.mp3", displayOrder: 20 }], { force: true });
await queue.resumeAuto();
assert.deepEqual(
  played,
  ["/uploads/voice/a1.mp3", "/uploads/voice/a3.mp3", "/uploads/voice/a1.mp3"],
  "manual playback should be able to replay a consumed voice message"
);

console.log("chat voice playback queue self-check passed");
