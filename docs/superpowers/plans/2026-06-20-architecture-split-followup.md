# Architecture Split Follow-up Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue the post-2026-06-11 architecture cleanup by splitting newly grown hot files without changing user-facing behavior.

**Architecture:** Keep existing public entry points stable and move dense responsibility clusters into focused modules. Each part should be independently testable and shippable, with self-checks added before or during the split.

**Tech Stack:** Node.js ES modules, browser ES modules, existing project self-check scripts, no new runtime dependencies.

---

## Execution Status

- Part 1 completed locally: product source and normalizer split.
- Part 2 completed locally: realtime call backend split.
- Part 3 completed locally: realtime call frontend split.
- Part 4 completed locally: `src/app/main.js` call/create flow split.
- Part 5 completed locally: create character page voice preview and language picker split.
- Part 6 completed locally for the low-risk style scope: admin character editor styles moved to `admin-character-editor.css`; list/table styles intentionally left in `admin-console.css`.
- Final verification completed locally: targeted self-check groups, touched-file `git diff --check`, and Chrome headless checks for common/creator admin create modals at desktop and `390x844`.
- Deployment status: not deployed. These are local structure changes only.

---

## Current Baseline

Completed in the first split pass:

- `server/mascot-product-context-service.js`
  - Extracted product intent and product filtering into `server/product-intent-service.js`.
  - Main service now keeps orchestration, site resolution, API reads, Shopify reads, and product normalization.
- `src/features/admin-console/admin-character-editor-template.js`
  - Reduced to the modal dispatcher.
  - Extracted common character forms, creator character forms, and shared editor fields.

This plan covers the remaining split work after that baseline.

## Part 1: Product Source And Product Normalization Split

**Why:** `server/mascot-product-context-service.js` is smaller now, but it still mixes API fetching, Shopify-specific source logic, URL construction, product normalization, price formatting, image normalization, size normalization, and feature normalization.

**Files:**

- Modify: `server/mascot-product-context-service.js`
- Create: `server/product-source-service.js`
- Create: `server/product-normalizer.js`
- Create: `scripts/product-source-service-self-check.mjs`
- Create: `scripts/product-normalizer-self-check.mjs`
- Update: `scripts/mascot-product-context-self-check.mjs` only if needed to keep coverage explicit.

**Split:**

- `product-source-service.js`
  - Owns read-only product source selection.
  - Owns blocked Admin URL detection.
  - Owns generic API URL building.
  - Owns Shopify public search URL building.
  - Owns JSON fetch with timeout.
  - Owns Shopify public product detail fetch.
- `product-normalizer.js`
  - Owns generic product row normalization.
  - Owns Shopify product normalization.
  - Owns price/currency formatting.
  - Owns image URL normalization.
  - Owns size/feature/availability normalization.
- `mascot-product-context-service.js`
  - Keeps `buildMascotProductContext()`.
  - Keeps character eligibility.
  - Keeps product site resolution.
  - Calls product source and product normalizer modules.

**Validation:**

- `node --check server/product-source-service.js`
- `node --check server/product-normalizer.js`
- `node --check server/mascot-product-context-service.js`
- `node scripts/product-source-service-self-check.mjs`
- `node scripts/product-normalizer-self-check.mjs`
- `node scripts/mascot-product-context-self-check.mjs`
- `node scripts/product-context-ac-milan-regression-self-check.mjs`
- `node scripts/product-message-trigger-self-check.mjs`
- `node scripts/product-followup-sanitizer-self-check.mjs`

**Success Standard:**

- `buildMascotProductContext()` behavior stays unchanged.
- Shopify/public product APIs remain read-only.
- Price currency, image gallery, size, feature, and AC Milan filtering behavior stay unchanged.
- `server/mascot-product-context-service.js` should ideally drop below about `260` lines.

## Part 2: Realtime Call Backend Split

**Why:** `server/call-realtime-service.js` has grown around WebSocket session setup, provider socket management, turn isolation, audio forwarding, transcript finalization, reply generation, diagnostics, and logging.

**Files:**

- Modify: `server/call-realtime-service.js`
- Create: `server/call-session-service.js`
- Create: `server/call-provider-socket-service.js`
- Create: `server/call-turn-service.js`
- Create: `server/call-diagnostics-service.js`
- Create: `scripts/call-realtime-backend-split-self-check.mjs`

**Split:**

- `call-session-service.js`
  - Owns session shape.
  - Owns session lifecycle and close/reset helpers.
  - Owns send event / send error helpers.
- `call-provider-socket-service.js`
  - Owns ElevenLabs realtime socket connection.
  - Owns socket open waiting.
  - Owns audio chunk forwarding.
  - Owns provider socket reset between turns.
- `call-turn-service.js`
  - Owns final transcript handling.
  - Owns turn id stale-check and completed-turn guard.
  - Owns calling `createUserMessage()` / `createUserReply()`.
- `call-diagnostics-service.js`
  - Owns timing log.
  - Owns audio probe log.
  - Owns safe diagnostic payload formatting.
- `call-realtime-service.js`
  - Keeps `createRealtimeCallService()`.
  - Keeps WebSocket route setup and high-level message dispatch.

**Validation:**

- `node --check server/call-realtime-service.js`
- `node --check server/call-session-service.js`
- `node --check server/call-provider-socket-service.js`
- `node --check server/call-turn-service.js`
- `node --check server/call-diagnostics-service.js`
- `node scripts/call-realtime-backend-split-self-check.mjs`
- `node scripts/call-realtime-phase1-self-check.mjs`
- `node scripts/call-turn-isolation-self-check.mjs`
- `node scripts/call-latency-diagnostics-self-check.mjs`
- `node scripts/call-long-session-resume-self-check.mjs`

**Success Standard:**

- No call state behavior changes.
- Stale turn protection remains deterministic.
- Audio probe and timing logs remain present.
- `server/call-realtime-service.js` should ideally drop below about `180` lines.

## Part 3: Realtime Call Frontend Split

**Why:** `src/features/call-modal/call-realtime-client.js` mixes call state machine, WebSocket connection, microphone capture, resampling, audio encoding, playback resume guards, and diagnostics.

**Files:**

- Modify: `src/features/call-modal/call-realtime-client.js`
- Create: `src/features/call-modal/call-state-machine.js`
- Create: `src/features/call-modal/call-audio-capture.js`
- Create: `src/features/call-modal/call-websocket-client.js`
- Create: `src/features/call-modal/call-playback-guard.js`
- Create: `scripts/call-realtime-frontend-split-self-check.mjs`

**Split:**

- `call-state-machine.js`
  - Owns `CALL_STATES`.
  - Owns allowed transitions and status text mapping if reusable.
- `call-audio-capture.js`
  - Owns microphone stream setup.
  - Owns resample, PCM conversion, base64 conversion, RMS calculation.
  - Owns audio probe interval data creation.
- `call-websocket-client.js`
  - Owns WebSocket connect/reconnect/close and message parsing.
  - Owns outbound event helpers.
- `call-playback-guard.js`
  - Owns assistant playback resume guard timers.
  - Owns fallback resume when `ended/error` is missed.
- `call-realtime-client.js`
  - Keeps public client creation/binding entry.
  - Wires the modules together.

**Validation:**

- `node --check src/features/call-modal/call-realtime-client.js`
- `node --check src/features/call-modal/call-state-machine.js`
- `node --check src/features/call-modal/call-audio-capture.js`
- `node --check src/features/call-modal/call-websocket-client.js`
- `node --check src/features/call-modal/call-playback-guard.js`
- `node scripts/call-realtime-frontend-split-self-check.mjs`
- `node scripts/call-realtime-phase1-self-check.mjs`
- `node scripts/call-controls-self-check.mjs`
- `node scripts/call-realtime-fast-vad-self-check.mjs`
- `node scripts/call-modal-no-remount-self-check.mjs`

**Success Standard:**

- No UI or state behavior changes.
- Existing call controls keep working.
- Audio capture format and probe fields remain unchanged.
- `call-realtime-client.js` should ideally drop below about `180` lines.

## Part 4: App Main Call And Create Flow Split

**Why:** `src/app/main.js` was previously split, but call handling, profile handling, create submit handling, category/search/admin view setters, and boot/mount wiring have grown back into the app entry.

**Files:**

- Modify: `src/app/main.js`
- Create: `src/app/app-call-actions.js`
- Create: `src/app/app-profile-actions.js` only if profile code remains mixed after call extraction.
- Create: `src/app/app-create-actions.js`
- Create: `scripts/app-main-split-self-check.mjs`

**Split:**

- `app-call-actions.js`
  - Owns open/start/stop/close/pause call handlers.
  - Owns call shop click handling.
  - Owns call client event handling.
  - Owns merging call messages into current chat.
  - Owns updating call modal DOM if this can be cleanly injected.
- `app-create-actions.js`
  - Owns create character submit handler.
  - Owns create field setter if it stays coupled to create state.
- `app-profile-actions.js`
  - Owns profile open/close/tab selection if it remains a visible chunk after call extraction.
- `main.js`
  - Keeps boot, initial route resolution, top-level action construction, and view mounting.

**Validation:**

- `node --check src/app/main.js`
- `node --check src/app/app-call-actions.js`
- `node --check src/app/app-create-actions.js`
- `node --check src/app/app-profile-actions.js` if created.
- `node scripts/app-main-split-self-check.mjs`
- `node scripts/call-modal-no-remount-self-check.mjs`
- `node scripts/chat-product-panel-state-self-check.mjs`
- `node scripts/create-character-reset-self-check.mjs`
- `node scripts/register-mascot-activation-self-check.mjs`

**Success Standard:**

- Initial boot and site routing unchanged.
- Call modal state unchanged.
- Create character flow unchanged.
- `src/app/main.js` should ideally drop below about `260` lines.

## Part 5: Create Character Page Secondary Split

**Why:** `src/features/create-character/create-character-page.js` was split on 2026-06-11, but voice preview and language picker logic have grown back into the page module.

**Files:**

- Modify: `src/features/create-character/create-character-page.js`
- Create: `src/features/create-character/create-character-voice-preview.js`
- Create: `src/features/create-character/create-character-language-picker.js`
- Create: `scripts/create-character-page-secondary-split-self-check.mjs`

**Split:**

- `create-character-voice-preview.js`
  - Owns preview button binding.
  - Owns global stop behavior.
  - Owns active preview audio state.
  - Owns play/stop button visual state.
- `create-character-language-picker.js`
  - Owns language picker binding.
  - Owns option rendering.
  - Owns language selection and state update callback.
- `create-character-page.js`
  - Keeps page rendering, field binding, avatar binding, and submit payload wiring.

**Validation:**

- `node --check src/features/create-character/create-character-page.js`
- `node --check src/features/create-character/create-character-voice-preview.js`
- `node --check src/features/create-character/create-character-language-picker.js`
- `node scripts/create-character-page-secondary-split-self-check.mjs`
- `node scripts/create-voice-dropdown-ui-self-check.mjs`
- `node scripts/create-voice-preview-playback-self-check.mjs`
- `node scripts/create-character-language-standardization-self-check.mjs`
- `node scripts/avatar-generation-manual-prompt-ui-self-check.mjs`

**Success Standard:**

- Create page UI unchanged.
- Voice preview behavior unchanged.
- Language picker behavior unchanged.
- `create-character-page.js` should ideally drop below about `230` lines.

## Part 6: Admin Console Style Follow-up

**Why:** `src/features/app-shell/styles/admin-console.css` is around `543` lines. It is not urgent, but repeated admin role modal work has added several scoped blocks. Split only after template structure stabilizes.

**Files:**

- Modify: `src/features/app-shell/styles/admin-console.css`
- Create: `src/features/app-shell/styles/admin-character-editor.css`
- Create: `src/features/app-shell/styles/admin-character-list.css` only if list-specific rules are easy to isolate.
- Update style imports wherever the project currently imports shell styles.
- Create: `scripts/admin-console-style-split-self-check.mjs`

**Split:**

- `admin-character-editor.css`
  - Owns common/creator character modal layout.
  - Owns avatar action layout.
  - Owns language/voice dropdown z-index and sizing rules.
- `admin-character-list.css`
  - Owns table/list status badges and character list actions only if clearly separable.
- `admin-console.css`
  - Keeps admin shell, tabs, common layout, and generic admin utilities.

**Validation:**

- `node scripts/admin-console-style-split-self-check.mjs`
- `node scripts/admin-common-character-edit-layout-self-check.mjs`
- `node scripts/admin-creator-character-create-search-self-check.mjs`
- Browser check of `/admin?view=commonCharacters` and `/admin?view=creatorCharacters` at desktop and `390x844`.

**Success Standard:**

- No visual changes.
- Dropdown layer and field heights stay correct.
- This part can be skipped if CSS remains stable and no new admin UI work is planned.

## Suggested Order

1. Part 1: Product source and normalizer split.
2. Part 2: Realtime call backend split.
3. Part 3: Realtime call frontend split.
4. Part 4: App main call/create split.
5. Part 5: Create character page secondary split.
6. Part 6: Admin style split only if needed.

## Deployment Boundary

- Parts 1-5 are code-structure changes and should be verified locally before any server update.
- Deploy only after a complete part passes its targeted checks.
- If multiple parts are completed in one local session, create one release node that clearly lists all completed parts.
- Keep server `.env.local`, database, and shared uploads untouched by using the existing release deployment flow.
