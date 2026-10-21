# Architecture Cleanup Round 3 Implementation Plan

> **For agentic workers:** Use the same execution discipline as prior cleanup rounds: keep public entry points stable, split by real responsibility boundary, and validate each part before moving to the next. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the next architecture cleanup round after the completed 2026-06-23 split, focusing only on the new files that have started accumulating mixed responsibilities again, without changing user-facing behavior.

**Architecture:** This round is intentionally narrower than a broad refactor. Only split files that are now mixing multiple feature concerns or have become likely churn hotspots. Avoid touching stable infrastructure and avoid redesigning routes, data contracts, or product behavior.

**Tech Stack:** Node.js ES modules, browser ES modules, existing admin console modules, existing chat/product modules, MySQL-backed service modules, current self-check script pattern.

---

## Baseline

This plan treats the completed `/Users/cheng/Projects/alove-workspace/alove-page-rebuild/docs/superpowers/plans/2026-06-23-post-2026-06-20-architecture-cleanup.md` round as the immediate structural baseline.

Reference files:
- `/Users/cheng/Projects/alove-workspace/alove-page-rebuild/logs/updates/2026-06-23.md`
- `/Users/cheng/Projects/alove-workspace/alove-page-rebuild/docs/releases/2026-06-23-chat-page-rendering-split.md`
- `/Users/cheng/Projects/alove-workspace/alove-page-rebuild/docs/releases/2026-06-23-promotion-campaign-backend-split.md`
- `/Users/cheng/Projects/alove-workspace/alove-page-rebuild/docs/project-todo.md`

Current post-baseline hotspots to clean up:
- `src/features/chat/chat-product-panel.js`
- `src/features/search/search-page.js`
- `server/admin-knowledge-service.js`
- `server/ai-reply-service.js`
- `server/chat-text-message-service.js`
- `src/features/admin-console/admin-sites-controller.js`

Not in scope for this round unless a split above proves blocked:
- `server/db.js`
- `server/auth-service.js`
- `src/app/main.js`
- `src/app/app-session-actions.js`
- `server/proactive-message-scheduler-service.js`
- `server/proactive-message-job-service.js`

## Part 1: Chat Product Panel Split

- [ ] Split `src/features/chat/chat-product-panel.js` into smaller modules without changing panel behavior.

**Why:** This file currently mixes panel template markup, open/close state, product field rendering, gallery rendering, drag/swipe gestures, image index state, CTA analytics, and payload parsing.

**Files:**
- Modify: `src/features/chat/chat-product-panel.js`
- Create: `src/features/chat/chat-product-panel-template.js`
- Create: `src/features/chat/chat-product-panel-renderer.js`
- Create: `src/features/chat/chat-product-panel-gallery.js`
- Create if needed: `scripts/chat-product-panel-split-self-check.mjs`
- Update if needed: existing product panel self-checks

**Target boundary:**
- `chat-product-panel.js`
  - keep public binding entry
  - keep orchestration between renderer and gallery helpers
- `chat-product-panel-template.js`
  - panel shell HTML only
- `chat-product-panel-renderer.js`
  - price, sizes, features, code, payload parse, image normalization helpers
- `chat-product-panel-gallery.js`
  - prev/next controls
  - drag/swipe logic
  - track offset and image index updates

**Validation:**
- `node --check` on all touched chat product panel files
- related self-checks for product panel binding, state, gallery, and dynamic rendering
- real browser check in chat page on desktop and mobile

**Success standard:**
- sending a message does not reset an open product panel
- clicking another product still switches panels correctly
- multi-image button flip and drag flip both still work
- analytics click/detail events keep current payload shape

## Part 2: Search Page Split

- [ ] Split `src/features/search/search-page.js` by topbar, search effect, and result rendering.

**Why:** This file currently mixes topbar creation, input/debounce behavior, character filtering, product fetch, result section rendering, and product detail panel payload shaping.

**Files:**
- Modify: `src/features/search/search-page.js`
- Create: `src/features/search/search-topbar.js`
- Create: `src/features/search/search-results-renderer.js`
- Create: `src/features/search/search-product-state.js`
- Create if needed: `scripts/search-page-split-self-check.mjs`

**Target boundary:**
- `search-page.js`
  - keep `createSearchPage()` entry
  - coordinate state and imported modules
- `search-topbar.js`
  - search input, clear, cancel, drawer button
- `search-results-renderer.js`
  - recent searches section
  - character rows
  - product rows
  - HTML escaping helpers if still view-specific
- `search-product-state.js`
  - debounce timer
  - product API search trigger
  - loading/error transitions
  - product panel payload shaping if it belongs to search result state

**Validation:**
- `node --check` on touched search files
- search-page self-check if added
- real browser check for empty query, character result, product result, and product detail open on desktop/mobile

**Success standard:**
- query debounce still waits 0.5 seconds
- refresh/switch page behavior stays unchanged
- product results still come from the correct site API path
- search page DOM structure remains compatible with current styles

## Part 3: Admin Knowledge Backend Split

- [ ] Split `server/admin-knowledge-service.js` into query, write, normalizer, and mapper modules.

**Why:** This file already has a clean split boundary but still holds listing, detail loading, AI draft creation, payload normalization, section normalization, transaction writes, and row mapping in one file.

**Files:**
- Modify: `server/admin-knowledge-service.js`
- Create: `server/admin-knowledge-query-service.js`
- Create: `server/admin-knowledge-write-service.js`
- Create: `server/admin-knowledge-normalizers.js`
- Create: `server/admin-knowledge-mapper.js`
- Create if needed: `scripts/admin-knowledge-backend-split-self-check.mjs`

**Target boundary:**
- `admin-knowledge-service.js`
  - keep exported public entry points
  - keep thin orchestration only
- `admin-knowledge-query-service.js`
  - list and single-item reads
- `admin-knowledge-write-service.js`
  - create/update/delete transaction flow
  - AI draft to saved entity orchestration if still needed
- `admin-knowledge-normalizers.js`
  - payload/category/priority/keyword/section normalization
- `admin-knowledge-mapper.js`
  - base row and section row mapping
  - JSON/string array parsing helpers if mapper-owned

**Validation:**
- `node --check` on all touched backend files
- admin knowledge self-checks or new split self-check
- real admin knowledge create/edit/list smoke check if local service verification is available

**Success standard:**
- admin knowledge API payloads stay unchanged
- AI draft create flow still saves the same section structure
- no section ordering regression

## Part 4: AI Reply Service Split

- [ ] Split `server/ai-reply-service.js` around provider request, fallback, and structured reply helpers.

**Why:** This file now mixes OpenAI request transport, retry-on-empty logic, fallback copy, voice meta normalization, structured reply instruction building, extraction, and reply logging.

**Files:**
- Modify: `server/ai-reply-service.js`
- Create: `server/ai-reply-provider-service.js`
- Create: `server/ai-reply-fallback-service.js`
- Create: `server/ai-reply-contract-service.js`
- Create if needed: `server/ai-reply-log-adapter.js`
- Create if needed: `scripts/ai-reply-service-split-self-check.mjs`

**Target boundary:**
- `ai-reply-service.js`
  - keep exported public entry points
  - orchestrate provider + fallback + logging
- `ai-reply-provider-service.js`
  - fetch transport
  - request body/url
  - raw provider response extraction
- `ai-reply-fallback-service.js`
  - empty/failure fallback payload building
  - product-question fallback choice
  - voice fallback meta
- `ai-reply-contract-service.js`
  - structured reply instructions
  - text normalization
  - voice meta normalization

**Validation:**
- `node --check` on touched ai reply files
- empty reply retry self-check
- reply output contract self-check
- reasoning/self-check group that already protects current reply behavior

**Success standard:**
- no return-shape change for downstream chat services
- empty reply retry and visible fallback stay intact
- prior fixes around awkward fallback text do not regress

## Part 5: Chat Text Message Service Targeted Split

- [ ] Reduce `server/chat-text-message-service.js` by extracting the highest-churn helpers only.

**Why:** This file is central and risky. It now mixes user message persistence, reply orchestration, stale mascot/site guard behavior, product context resolution, AI reply generation, product message insertion, analytics recording, voice scheduling, and reply model selection.

**Important boundary:** This part is not a broad rewrite. Only extract stable helper clusters first.

**Files:**
- Modify: `server/chat-text-message-service.js`
- Create: `server/chat-reply-orchestrator-service.js`
- Create if needed: `server/chat-product-reply-service.js`
- Create if needed: `server/chat-reply-voice-service.js`
- Create if needed: `scripts/chat-text-message-service-split-self-check.mjs`

**Target boundary:**
- `chat-text-message-service.js`
  - keep public `createUserMessage()` and `createUserReply()` entry points
  - keep transaction ownership if that remains safest
- `chat-reply-orchestrator-service.js`
  - AI reply pipeline assembly
  - reply text + product context + saved assistant message composition
- `chat-product-reply-service.js`
  - product-card insertion and related analytics payload assembly
- `chat-reply-voice-service.js`
  - voice model/meta resolution
  - voice asset enqueue/generate handoff if cleanly separable

**Validation:**
- `node --check` on touched files
- chat reply contract self-checks
- product context self-checks
- voice/text alignment self-checks
- real local chat smoke test for normal text reply and product reply

**Success standard:**
- message ordering does not change
- product bubble + follow-up flow does not change
- saved reply text and generated voice text stay aligned
- stale mascot/site guard behavior does not regress

## Part 6: Admin Sites Controller Split

- [ ] Split `src/features/admin-console/admin-sites-controller.js` by controller and region-picker/editor responsibilities.

**Why:** This file currently mixes table loading, editor modal lifecycle, payload reading, default-site actions, and a fairly involved region picker with online search and tag state.

**Files:**
- Modify: `src/features/admin-console/admin-sites-controller.js`
- Create: `src/features/admin-console/admin-sites-editor.js`
- Create: `src/features/admin-console/admin-sites-region-picker.js`
- Create if needed: `scripts/admin-sites-controller-split-self-check.mjs`

**Target boundary:**
- `admin-sites-controller.js`
  - keep page entry and top-level load/render/click delegation
- `admin-sites-editor.js`
  - editor host open/close
  - form submit wiring
  - payload read helper
- `admin-sites-region-picker.js`
  - selected region state
  - tag render
  - local filter + online search states
  - picker open/close and option select behavior

**Validation:**
- `node --check` on touched admin sites files
- split self-check if added
- real admin sites page smoke check for list, edit, save, and region picker open/search/select

**Success standard:**
- site table and save flow stay unchanged
- region picker visual/interaction behavior stays unchanged
- controller goes back to page orchestration instead of holding picker internals

## Execution Order

Recommended order for this round:
1. `src/features/chat/chat-product-panel.js`
2. `src/features/search/search-page.js`
3. `server/admin-knowledge-service.js`
4. `server/ai-reply-service.js`
5. `server/chat-text-message-service.js`
6. `src/features/admin-console/admin-sites-controller.js`

## Guardrails

- Do not mix this round with behavior redesign, copy changes, product logic changes, or auth flow changes.
- Do not touch `server/db.js` in this round.
- Do not touch `server/auth-service.js` in this round unless a narrower split above is blocked by it.
- For every split part, update or add a split-specific self-check before claiming completion.
- Prefer smaller extractions first. If a file is risky, stop after one stable seam instead of forcing a full decomposition.

## Completion Standard

This round is complete only when:
- each finished part keeps existing entry points stable
- relevant self-checks pass
- real local smoke checks pass for the touched surface
- `docs/project-todo.md`, `logs/updates/`, and `docs/releases/` are updated in the same style as previous rounds
- no unrelated behavior changes are bundled into the cleanup work
