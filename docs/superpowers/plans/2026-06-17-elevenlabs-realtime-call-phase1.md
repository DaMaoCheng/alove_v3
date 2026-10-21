# ElevenLabs Realtime Call Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build phase 1 of realtime call: stable turn-based voice conversation using ElevenLabs realtime STT, existing chat reply generation, existing ElevenLabs TTS playback, and a 200ms listen delay after assistant playback.

**Architecture:** The browser connects to the app server WebSocket, never directly to ElevenLabs. The server owns auth, call session ids, ElevenLabs realtime STT connection, final transcript handling, and reuse of existing chat message/reply services. The frontend owns microphone capture, PCM chunk streaming, playback, call status UI, and post-speech delay.

**Tech Stack:** Node HTTP upgrade + `ws`, ElevenLabs `scribe_v2_realtime`, browser Web Audio API, existing chat HTTP APIs, existing ElevenLabs TTS assets.

---

## File Structure

- Create `server/elevenlabs-realtime-stt-service.js`: build realtime STT URL/config and normalize provider events.
- Create `server/call-realtime-service.js`: app WebSocket `/ws/call`, auth, session lifecycle, final transcript to chat service, reply generation, and server events.
- Modify `server/server.js`: attach realtime call WebSocket service to the HTTP server.
- Create `src/features/call-modal/call-realtime-client.js`: browser microphone capture, PCM conversion, WebSocket events, playback and 200ms post-speech delay.
- Modify `src/features/call-modal/call-modal.js`: render real statuses and bind start/end/mute/speaker to the realtime client.
- Modify `src/app/main.js`, `src/app/app-state.js`, `src/app/app-view-factory.js`: store call session UI state and pass handlers.
- Create self-checks: `scripts/elevenlabs-realtime-stt-service-self-check.mjs`, `scripts/call-realtime-phase1-self-check.mjs`.
- Update `scripts/deployment-check.mjs` and `logs/updates/2026-06-17.md`.

## Phase 1 Tasks

### Task 1: Realtime STT Config Contract

**Files:**
- Create: `server/elevenlabs-realtime-stt-service.js`
- Create: `scripts/elevenlabs-realtime-stt-service-self-check.mjs`
- Modify: `scripts/deployment-check.mjs`

- [ ] Write a self-check that expects `scribe_v2_realtime`, a WebSocket URL under ElevenLabs `/speech-to-text/realtime`, and normalized transcript events.
- [ ] Run it and confirm it fails because the service does not exist.
- [ ] Implement config resolver and event normalizer.
- [ ] Run the self-check and confirm it passes.

### Task 2: Backend Call WebSocket Skeleton

**Files:**
- Create: `server/call-realtime-service.js`
- Modify: `server/server.js`
- Create: `scripts/call-realtime-phase1-self-check.mjs`
- Modify: `scripts/deployment-check.mjs`

- [ ] Write a self-check that confirms `server.js` calls `createRealtimeCallService({ server })`, `/ws/call` is the upgrade path, and the service emits `call_ready`, `transcript_final`, `assistant_audio`, `listening`, `error`, and `call_ended`.
- [ ] Run it and confirm it fails.
- [ ] Implement the WebSocket skeleton with auth from cookies, `callSessionId`, `turnId`, and safe JSON event parsing.
- [ ] Run the self-check and confirm it passes.

### Task 3: Backend Final Transcript to Existing Reply Chain

**Files:**
- Modify: `server/call-realtime-service.js`
- Modify if needed: `server/chat-text-message-service.js`

- [ ] Add a test/self-check that final transcript calls `createUserMessage` then `createUserReply` and returns reply messages including voice metadata.
- [ ] Implement `handleFinalTranscript` to treat final text as a normal user text message.
- [ ] Return `assistant_thinking`, then `assistant_audio` when a ready voice asset is present, or `assistant_text` with disabled voice when generation fails.
- [ ] Preserve privacy: do not write raw user audio to disk.

### Task 4: Frontend Realtime Call Client

**Files:**
- Create: `src/features/call-modal/call-realtime-client.js`
- Modify: `src/features/call-modal/call-modal.js`

- [ ] Add a self-check that microphone code uses `echoCancellation`, sends `start_call`, streams `audio_chunk`, handles `assistant_audio`, waits `200ms` after playback before sending `resume_listening`, and closes on page/call end.
- [ ] Implement a simple client class with `start`, `stop`, `setMuted`, `playAssistantAudio`, and `resumeListeningAfterDelay`.
- [ ] Do not implement barge-in in phase 1.

### Task 5: App State and UI Wiring

**Files:**
- Modify: `src/app/app-state.js`
- Modify: `src/app/main.js`
- Modify: `src/app/app-view-factory.js`
- Modify: `src/features/call-modal/call-modal.js`
- Modify: `src/features/app-shell/styles/call-modal.css`

- [ ] Add call state fields: `status`, `turnStatus`, `liveText`, `error`, `sessionId`.
- [ ] Open call starts realtime client after modal mount.
- [ ] Close call stops WebSocket, audio stream, timers, and playback.
- [ ] Mute pauses outgoing audio chunks but keeps the call open.
- [ ] UI shows connecting/listening/thinking/speaking/errors.

### Task 6: Verification and Logs

**Files:**
- Modify: `logs/updates/2026-06-17.md`

- [ ] Run `node scripts/elevenlabs-realtime-stt-service-self-check.mjs`.
- [ ] Run `node scripts/call-realtime-phase1-self-check.mjs`.
- [ ] Run `npm run check:deployment`.
- [ ] Restart local app.
- [ ] Run health and multisite smoke.
- [ ] Document what is done and what is intentionally phase 2.
