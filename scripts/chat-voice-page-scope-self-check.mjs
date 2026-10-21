import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageSource = readFileSync("src/features/chat/chat-page.js", "utf8");
const voiceSource = readFileSync("src/features/chat/chat-voice.js", "utf8");

assert.match(pageSource, /bindVoicePlayback\(wrap,\s*\{\s*messages/, "chat page should pass rendered messages into voice playback binding");
assert.match(voiceSource, /createChatVoicePlaybackQueue/, "chat voice module should use the shared queue");
assert.match(voiceSource, /visibilitychange/, "voice playback should stop when the tab is hidden");
assert.match(voiceSource, /if \(document\.hidden\) softStopActiveQueue\(\)/, "hidden tab should only soft-stop playback so buttons can replay after refocus");
assert.match(voiceSource, /window\.addEventListener\("blur", softStopActiveQueue\)/, "window blur should only soft-stop playback");
assert.match(voiceSource, /pagehide/, "voice playback should stop on page navigation");
assert.match(voiceSource, /beforeunload/, "voice playback should stop before unload");
assert.match(voiceSource, /root\.isConnected/, "voice playback should stop after switching away from the mounted chat page");
assert.match(voiceSource, /function softStopActiveQueue\(\)/, "chat voice module should keep a reusable soft stop for focus loss");
assert.match(voiceSource, /data-voice-message-id/, "voice buttons should be linked to message ids");
assert.match(voiceSource, /data-voice-status/, "voice buttons should expose voice asset status");
assert.match(voiceSource, /force:\s*true/, "manual voice button playback should be allowed to replay an already consumed voice message");

console.log("chat voice page-scope self-check passed");
