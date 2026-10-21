# Realtime Call Turn Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the realtime call flow so each spoken turn is isolated, old STT results cannot be resent to the LLM, and background audio is gated consistently across long calls.

**Architecture:** Keep the existing WebSocket `/ws/call` and ElevenLabs realtime STT provider, but make each user turn explicit. The frontend owns a finite state machine and local RMS audio gate; the backend owns turn IDs, one active final per turn, and STT socket reset between turns.

**Tech Stack:** Browser `MediaStream` + `ScriptProcessorNode`, Node `ws`, ElevenLabs realtime STT, existing chat `createUserMessage/createUserReply`, Node self-check scripts.

---

### Task 1: Add Failing Self-Checks For Turn Isolation

**Files:**
- Create: `scripts/call-turn-isolation-self-check.mjs`
- Modify: `scripts/deployment-check.mjs`

- [ ] **Step 1: Create static self-check for required state machine hooks**

Create `scripts/call-turn-isolation-self-check.mjs` with assertions for:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const clientSource = readFileSync("src/features/call-modal/call-realtime-client.js", "utf8");
const serverSource = readFileSync("server/call-realtime-service.js", "utf8");
const deploymentSource = readFileSync("scripts/deployment-check.mjs", "utf8");

assert.match(clientSource, /CALL_STATES/, "frontend should define explicit call states");
assert.match(clientSource, /beginListeningTurn/, "frontend should begin isolated listening turns");
assert.match(clientSource, /finishListeningTurn/, "frontend should finish one listening turn before assistant reply");
assert.match(clientSource, /shouldSendAudioFrame/, "frontend should gate low-energy audio frames before STT");
assert.match(clientSource, /localNoiseFloor/, "frontend should track a local noise floor");
assert.match(clientSource, /turnId/, "frontend should send turnId with audio chunks");

assert.match(serverSource, /activeTurnId/, "backend should track one active turn");
assert.match(serverSource, /completedTurnIds/, "backend should reject repeated final transcripts per turn");
assert.match(serverSource, /resetProviderSocketForNextTurn/, "backend should reset STT socket between turns");
assert.match(serverSource, /payload\.turnId/, "backend should read turnId from client audio chunks");
assert.match(serverSource, /stale_turn_ignored/, "backend should expose stale turn ignore diagnostics");

assert.match(deploymentSource, /call-turn-isolation-self-check\.mjs/, "deployment check should include turn isolation self-check");

console.log("call turn isolation self-check passed");
```

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
node scripts/call-turn-isolation-self-check.mjs
```

Expected: FAIL because the hooks do not exist yet.

- [ ] **Step 3: Add the new script to deployment check**

Insert after `scripts/call-long-session-resume-self-check.mjs`:

```js
["node", ["scripts/call-turn-isolation-self-check.mjs"]],
```

Do not change unrelated deployment checks.

### Task 2: Rebuild Frontend Call Turn State

**Files:**
- Modify: `src/features/call-modal/call-realtime-client.js`

- [ ] **Step 1: Add explicit states and local audio gate constants**

Add constants near the top:

```js
const CALL_STATES = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  LISTENING: "listening",
  FINALIZING: "finalizing",
  THINKING: "thinking",
  SPEAKING: "speaking",
  COOLDOWN: "cooldown",
  PAUSED: "paused",
  ENDED: "ended",
});
const LOCAL_GATE_BOOT_FRAMES = 18;
const LOCAL_GATE_MIN_RMS = 0.012;
const LOCAL_GATE_MARGIN = 0.018;
```

- [ ] **Step 2: Add turn fields to the client constructor**

Add:

```js
this.callState = CALL_STATES.IDLE;
this.turnId = 0;
this.activeTurnId = 0;
this.sentFramesInTurn = 0;
this.localNoiseFloor = 0;
this.noiseSampleCount = 0;
```

- [ ] **Step 3: Replace direct audio send gate with `shouldSendAudioFrame()`**

In `onaudioprocess`, compute RMS and send only if:

```js
if (!this.shouldSendAudioFrame(input)) return;
```

When sending, include:

```js
turnId: this.activeTurnId,
```

- [ ] **Step 4: Add `beginListeningTurn()` and `finishListeningTurn()`**

Implement:

```js
beginListeningTurn() {
  if (this.stopped || this.paused) return;
  this.turnId += 1;
  this.activeTurnId = this.turnId;
  this.sentFramesInTurn = 0;
  this.turnStartedAt = 0;
  this.transcriptFinalAt = 0;
  this.assistantAudioAt = 0;
  this.callState = CALL_STATES.LISTENING;
  this.pausedForAssistant = false;
}

finishListeningTurn() {
  this.callState = CALL_STATES.FINALIZING;
  this.pausedForAssistant = true;
}
```

- [ ] **Step 5: Implement local RMS gate**

Implement:

```js
shouldSendAudioFrame(input) {
  if (this.stopped || this.muted || this.paused || this.pausedForAssistant || this.socket?.readyState !== WebSocket.OPEN) return false;
  if (this.callState !== CALL_STATES.LISTENING) return false;
  const rms = calculateRms(input);
  if (this.noiseSampleCount < LOCAL_GATE_BOOT_FRAMES) {
    this.localNoiseFloor = ((this.localNoiseFloor * this.noiseSampleCount) + rms) / (this.noiseSampleCount + 1);
    this.noiseSampleCount += 1;
    return false;
  }
  const threshold = Math.max(LOCAL_GATE_MIN_RMS, this.localNoiseFloor + LOCAL_GATE_MARGIN);
  if (rms < threshold) return false;
  this.sentFramesInTurn += 1;
  return true;
}
```

Add:

```js
function calculateRms(input) {
  if (!input?.length) return 0;
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    sum += (input[index] || 0) * (input[index] || 0);
  }
  return Math.sqrt(sum / input.length);
}
```

### Task 3: Reset STT Provider Between Turns

**Files:**
- Modify: `server/call-realtime-service.js`

- [ ] **Step 1: Add backend turn bookkeeping**

In `createCallSession()`, add:

```js
activeTurnId: 0,
completedTurnIds: new Set(),
ignoredTurnCount: 0,
```

- [ ] **Step 2: Store client turnId when audio chunks arrive**

In `audio_chunk`, parse:

```js
const turnId = Number(payload.turnId || 0);
if (!turnId || turnId < session.activeTurnId) {
  sendEvent(session, "stale_turn_ignored", { callSessionId: session.callSessionId, turnId });
  return;
}
session.activeTurnId = turnId;
sendAudioChunkToProvider(session, payload.audio);
```

- [ ] **Step 3: Attach active turnId to provider final events**

When provider returns `final`, call:

```js
void handleFinalTranscript(session, normalized.text, session.activeTurnId);
```

- [ ] **Step 4: Reject duplicate or stale final transcripts**

At the top of `handleFinalTranscript(session, text, turnId)`:

```js
const normalizedTurnId = Number(turnId || session.activeTurnId || 0);
if (!normalizedTurnId || session.completedTurnIds.has(normalizedTurnId)) {
  sendEvent(session, "stale_turn_ignored", { callSessionId: session.callSessionId, turnId: normalizedTurnId });
  return;
}
session.completedTurnIds.add(normalizedTurnId);
```

- [ ] **Step 5: Reset STT provider after final**

After marking the session as processing, call:

```js
resetProviderSocketForNextTurn(session);
```

Implement:

```js
function resetProviderSocketForNextTurn(session) {
  if (session.providerSocket && session.providerSocket.readyState !== WebSocket.CLOSED) {
    session.providerSocket.removeAllListeners("message");
    session.providerSocket.removeAllListeners("error");
    session.providerSocket.removeAllListeners("close");
    session.providerSocket.close();
  }
  session.providerSocket = null;
}
```

### Task 4: Resume With A Fresh Provider Socket

**Files:**
- Modify: `server/call-realtime-service.js`
- Modify: `src/features/call-modal/call-realtime-client.js`

- [ ] **Step 1: Backend resume creates a fresh provider socket**

In `resume_listening`, before setting `listening = true`:

```js
await connectProviderSocket(session);
session.processing = false;
session.listening = true;
sendEvent(session, "listening", { callSessionId: session.callSessionId });
```

- [ ] **Step 2: Frontend listening event starts a new turn**

When payload type is `listening`, call:

```js
this.beginListeningTurn();
```

Do not reuse the old turn ID.

- [ ] **Step 3: Frontend final event finishes the current turn only**

When `transcript_final` arrives:

```js
if (payload.turnId && Number(payload.turnId) !== this.activeTurnId) return;
this.finishListeningTurn();
```

Then emit the existing final diagnostics.

### Task 5: Verify And Document

**Files:**
- Modify: `logs/bugs/2026-06-17.md`
- Modify: `logs/updates/2026-06-17.md`

- [ ] **Step 1: Run targeted checks**

Run:

```bash
node scripts/call-turn-isolation-self-check.mjs
node scripts/call-realtime-phase1-self-check.mjs
node scripts/call-long-session-resume-self-check.mjs
node scripts/call-latency-diagnostics-self-check.mjs
node --check src/features/call-modal/call-realtime-client.js
node --check server/call-realtime-service.js
```

Expected: all pass.

- [ ] **Step 2: Run full deployment check**

Run:

```bash
npm run check:deployment
```

Expected: `deployment check passed`.

- [ ] **Step 3: Restart local service and smoke test**

Run:

```bash
launchctl kickstart -k gui/$(id -u)/com.aiove.localapp
sleep 2
curl -fsS http://127.0.0.1:4173/api/health
npm run smoke:multisite
```

Expected: health JSON has `"ok": true`, smoke passes.

- [ ] **Step 4: Update logs**

Update bug log with:
- Old second-turn transcript cannot be resent after a new turn starts.
- STT provider socket is reset after final transcript.
- Local RMS gate filters low-energy background audio before sending to STT.

Update update log with changed files and self-check results.

---

## Self-Review

- Requirement coverage: duplicate old transcript is blocked by turn IDs and completed turn set; noise creep is reduced by local RMS gate; frontend and backend both isolate each turn.
- Placeholder scan: no TBD/TODO placeholders.
- Scope check: only realtime call path changes; normal chat and ordinary voice message paths are not changed.
