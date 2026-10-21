import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSource = [
  "src/features/call-modal/call-realtime-client.js",
  "src/features/call-modal/call-state-machine.js",
  "src/features/call-modal/call-audio-capture.js",
  "src/features/call-modal/call-websocket-client.js",
  "src/features/call-modal/call-playback-guard.js",
].map((path) => readFileSync(path, "utf8")).join("\n");
const deploymentSource = readFileSync("scripts/deployment-check.mjs", "utf8");

assert.match(clientSource, /ASSISTANT_RESUME_GUARD_MS/, "call client should have a fallback guard for missed audio ended events");
assert.match(clientSource, /armAssistantResumeGuard/, "assistant playback should arm the resume guard");
assert.match(clientSource, /finishAssistantPlayback/, "assistant playback should use a single finish path");
assert.match(clientSource, /resumeAudioContext/, "call client should resume suspended audio context before listening");
assert.match(clientSource, /this\.turnStartedAt\s*=\s*0/, "listening resume should reset turn timing state");
assert.match(clientSource, /type:\s*["']resume_listening["']/, "client should tell backend to resume listening after playback");
assert.match(clientSource, /if \(!this\.paused\)[\s\S]*?this\.pausedForAssistant\s*=\s*false/, "manual resume should clear assistant pause state");

assert.match(deploymentSource, /call-long-session-resume-self-check\.mjs/, "deployment check should include long call resume self-check");

console.log("call long-session resume self-check passed");
