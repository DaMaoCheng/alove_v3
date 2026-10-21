# Complexity Refactor Plan

## Scope And Safety Boundary

- 本轮只做行为保持型拆解，不改变产品规则、页面结构、视觉样式、API 路径、响应字段、数据库结构、站点配置或模型配置。
- 所有工作仅在本地分支 `codex/complexity-refactor` 推进；完整恢复点为本地 tag `snapshot/pre-complexity-refactor-20260713`，指向 `35b2005`。
- 数据库和 `uploads` 的拆解前备份保存在忽略目录 `.codex-backups/complexity-refactor-20260713/`；自检允许创建临时数据，但结束后必须无持久残留。
- 每次只移动一个职责，原入口保留为兼容 facade。每个子批次都要独立验证、互评并创建本地 checkpoint commit，失败时只回退到上一 checkpoint。
- 正式聊天长事务、主动消息崩溃恢复、数据库版本化迁移和 Kitshop 异步响应竞态都涉及行为或状态语义，另写专项修复，不混入本轮纯拆解。
- 服务器和 GitHub 不更新，除非用户后续明确要求发布。

## Stable Public Contracts

`server/guest-chat-service.js` 在 Batch 1 全程保留以下既有出口，调用方无需改 import：

- `GUEST_COOKIE_NAME`
- `GUEST_SESSION_MAX_AGE_SECONDS`
- `getOrCreateGuestSession`
- `getGuestConversation`
- `sendGuestMessage`
- `sendGuestReplyForMessage`
- `createGuestCallMessage`
- `createGuestCallReply`
- `requireGuest`
- `acquireGuestReplyLockForToken`
- `assertGuestBrowsingEnabled`
- `retryGuestVoiceAssets`

## Progress

| Batch | Scope | Status | Checkpoint |
| --- | --- | --- | --- |
| 0 | Snapshot, backups, baseline and safety guard | Complete | local checkpoint `chore: establish complexity refactor safety baseline` |
| 1A | Guest session lookup/create/map | Complete | local checkpoint `refactor: extract guest session lifecycle` |
| 1B | Guest quota pure calculations | Complete | local checkpoint `refactor: extract guest message quota policy` |
| 1C | Guest turn persistence | Complete | local checkpoint `refactor: extract guest turn persistence` |
| 1D | Guest reply orchestration | Complete | local checkpoint `refactor: extract guest reply orchestration` |
| 2 | Authentication/session state reset and application | Complete | local checkpoint `refactor: extract auth session state` |
| 3 | Realtime call rendering ownership | Complete | local checkpoint `refactor: separate call state and DOM rendering` |
| 4 | Kitshop repository and shelf-builder boundaries | Complete | local checkpoint `refactor: split Kitshop persistence and shelves` |
| 5 | Proactive delivery policy/time boundaries | Complete | local checkpoint `refactor: extract proactive delivery policies` |
| 6A | Shared deterministic quota and memory rules | Complete | local checkpoint `refactor: consolidate shared backend rules` |
| 6B | Frontend shared pagination/escaping helpers | Complete | local checkpoint `refactor: consolidate admin UI helpers` |
| 6C | Explicit self-check manifest | Complete | local checkpoint `test: document self-check manifest` |
| Final | Full browser/API/database/WebSocket regression | Complete | local checkpoint `chore: complete complexity refactor verification` |

## Batch 0: Baseline And Recovery Point

### Work

- Confirm the `main` commit, create the local snapshot tag and isolated branch.
- Back up the approved local database and all uploaded assets, then verify both archives are readable.
- Add a guard that defaults mutating guest self-checks to local MySQL `127.0.0.1:3307`; server loopback `3306` requires explicit `ALLOW_MUTATING_SELF_CHECKS=true` after backup verification, and remote targets remain rejected.
- Upgrade source-scanning tests to inspect the facade and extracted modules before any source move.
- Run the full deployment suite and record database/site/upload state before and after; temporary fixtures must be cleaned.

### Acceptance

- Snapshot, DB dump and upload archive are readable recovery points.
- The guard passes on the approved local environment and fails before any write for a non-approved DB target.
- Existing source-scanning checks still pass before extraction.
- Full deployment check passes and leaves no persistent fixture, site-switch or upload change.

## Batch 1: Guest Chat Facade Split

### Locked Invariants For 1A-1D

- The dedicated advisory lock is acquired before a transaction and serializes work for the same guest; a `replyLockHeld` path must never acquire it twice.
- A quota-mutating transaction first loads the guest using `requireGuestForDb(... FOR UPDATE)`.
- Duplicate `client_message_id` returns the original turn without consuming network, message, voice or call quota and without a second model call.
- A new turn preserves this order: call lease or attachment ownership check → network quota → total message quota including reserved voice/call turns → message/image/session/call writes.
- Quota row reads and updates stay inside the locked transaction. Only side-effect-free arithmetic is extracted to the quota policy.
- AI generation remains inside the guest reply advisory lock but outside the DB transaction.
- Reply persistence repeats the `guest-reply:<messageId>` idempotency check inside its transaction.
- TTS is only reserved and attached inside the reply transaction; audio generation starts after commit and after advisory-lock release.

### Batch 1A: Session Lookup/Create/Map

- Extract cookie-token lookup, site/frontdesk validation, session creation and DTO mapping to `server/guest-session-service.js`.
- Preserve SQL, expiry, frozen site/character behavior and exported facade signatures byte-for-byte where practical.
- Verify syntax, guest text/session/cleanup checks, real local session API and DB cleanup; then independent state review and checkpoint commit.

### Batch 1B: Pure Quota Calculations

- Extract constants and pure rolling-window calculations to `server/guest-message-quota-policy.js`.
- Do not move locks, DB reservation reads/updates, network counters or persistence.
- Verify quota boundaries for text, voice and call plus concurrency/idempotency self-checks; then independent review and checkpoint commit.

### Batch 1C: Turn Persistence

- Extract user-turn validation and transactional persistence to `server/guest-turn-service.js`.
- Preserve lock order, duplicate-message fast path, attachment/image/call ownership and message ordering.
- Verify text, attachment, voice, call, image and claim checks plus a real local duplicate-send/concurrency API test; then independent review and checkpoint commit.

### Batch 1D: Reply Orchestration

- Extract reply preparation, AI/product reply orchestration, reply transaction and post-commit voice generation to `server/guest-reply-service.js`.
- Preserve advisory lock duration, reply/product idempotency keys, sanitization, message order and retry contracts.
- Verify text, product, image, AI voice, voice input, realtime call and claim checks plus real local AI-failure/retry behavior; then independent review and checkpoint commit.

### Batch 1 Exit Acceptance

- Every listed facade export remains available and existing callers require no changes.
- All guest and corresponding formal-user regressions pass.
- `server/guest-chat-service.js` contains orchestration exports only, not duplicated implementations.
- No test fixture/file/site switch remains, and independent architecture/state review reports no P0/P1 regression.

## Batch 2: Authentication And Session State

- Capture desktop/mobile screenshots and interaction traces for login, register, refresh recovery and logout before source changes.
- Create one state-reset implementation used by logout and auth-expiry paths, and one authenticated-session application flow shared by email login, registration and recovered sessions.
- Keep routes, guest claim, navigation and UI markup/styles unchanged.
- Verify login, registration, Google login, account switch, guest claim and pixel/interaction equivalence; review and checkpoint before Batch 3.

## Batch 3: Realtime Call Rendering Ownership

- Capture formal/guest desktop/mobile call baselines before source changes.
- Separate call event reduction from DOM rendering and give product overlay one owner without changing current markup/styles.
- Verify start, pause/resume, turns, product overlay, quota termination, repeated cleanup, timers/listeners and visual equivalence; review and checkpoint.

## Batch 4: Kitshop Boundaries

- Keep `getKitshopShelves()` as the facade; separate cache persistence/read queries from pure product normalization and shelf construction.
- Do not add request sequencing or change admin behavior in this pure-refactor batch; track that race as a separate bug fix.
- Verify FKK/GG shelf order, visibility, links, cache fallback and current user/admin UI equivalence; review and checkpoint.

## Batch 5: Proactive Delivery Boundaries

- Extract pure eligibility, ranking and timezone calculations while keeping persistence and scheduler contracts stable.
- Do not change reservation recovery semantics.
- Verify daily slots, quiet hours, reply gates, distribution, campaign priority and delivery records; review and checkpoint.

## Batch 6: Small Shared Rules

- `6A`: consolidate only semantics-identical quota constants, memory taxonomy and stale-mascot completion rules.
- `6B`: consolidate only semantics-identical frontend pagination/escaping helpers, with before/after UI screenshots.
- `6C`: add a domain manifest that explicitly lists deployment-gate and optional/manual checks; do not rewrite the test framework.
- Each sub-batch receives its own targeted checks, full deployment check, review and checkpoint.

## Final Verification

1. Run syntax and target checks after every extraction checkpoint, then `npm run check:deployment`.
2. Restart the local service and verify health, multisite routing and authenticated/guest APIs.
3. Use a real browser to simulate FKK and GG login, guest text/product/image/voice/attachment/call/claim, Kitshop and administrator paths on desktop and mobile.
4. Compare affected screenshots and interaction state before/after; page structure, spacing, text, loading, empty and error states must remain unchanged.
5. Compare DB/site/upload state with the batch baseline and remove every self-check fixture.
6. Run independent backend state/transaction and frontend regression reviews; no P0/P1 issue may remain.
7. Update progress, logs and the local checkpoint hash. Do not deploy or push.

## Rollback

- Stop immediately on any failed acceptance item; do not stack another extraction on top.
- Restore only current-batch files from the preceding checkpoint commit.
- Use the recorded checkpoint hash for each batch; use `snapshot/pre-complexity-refactor-20260713` and the verified DB/upload archives only for full recovery.
