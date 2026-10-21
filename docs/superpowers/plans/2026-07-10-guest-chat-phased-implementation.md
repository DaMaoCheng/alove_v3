# Guest Chat Phased Implementation Plan

## Scope And Release Boundary

- 所有功能先在本地实现和验证；完整版本部署后仍保持 `guest_chat_enabled=false`。
- 首次线上开放只允许管理员对单个已验收站点启用；其他站点继续关闭。
- 正式用户继续使用现有 `/api/chat/*`；游客使用独立 `/api/guest/*`、HttpOnly cookie 和 guest 数据边界。
- 本期不包含外部商城账号绑定、订单同步、SSO、优惠码领取/核销或跨设备游客恢复。

## Progress

| Batch | Status | Local checkpoint |
| --- | --- | --- |
| 1. Site switch and guest data foundation | Completed | `444db66` |
| 2. Guest text chat and public browsing | Completed | `e3fdb3c` |
| 3. Guest product messages without promotions | Completed | `50a8165` |
| 4. One successful guest image | Completed | `1295a16` |
| 5. Registration/login claim | Completed | This local checkpoint |
| Final real-user simulation and release gate | Completed locally | This local checkpoint |
| Admin guest-session visibility | Completed locally | Read-only account-management integration |
| 6. Guest AI voice replies | Completed locally | Reuse formal TTS and protected voice assets |
| 7. Guest voice input and attachments | Completed locally | Shared 30/24h message quota |
| 8. Guest realtime calls | Completed locally | Shared 30-message rolling quota; no time limit |
| 9. Claim and cleanup expansion | Completed locally | Voice, attachment and call ownership |

## Batch 1: Site Switch And Guest Data Foundation

### Implementation

- Add `sites.guest_chat_enabled`, default off, and expose it through the existing site editor.
- Add guest session, image entitlement, claim fields and controlled guest ownership for chat/image records.
- Store only token hashes in the database; use a 14-day HttpOnly cookie and freeze site/mascot ownership.
- Keep all guest pages and guest chat endpoints unavailable until later batches.

### Acceptance

- Empty and existing databases migrate safely; all sites remain disabled by default.
- A disabled site cannot create a guest session.
- Forged site, character, session and expired tokens are rejected without exposing tokens in URLs, payloads or logs.
- Formal login, registration, routing, chat and site administration remain unchanged.

## Batch 2: Guest Text Chat And Public Browsing

### Implementation

- Allow anonymous Discover, Search, read-only Kitshop, product detail, Create preview and the current site mascot Chat only when the site switch is enabled; keep the frozen mascot in sidebar contacts so the guest can return after navigating away.
- Add guest session/history/message endpoints with 30 user messages per rolling 24 hours, 10 per 10 minutes, stable `clientMessageId`, database locks and AI reply recovery.
- Add hashed short-term network cost guards for session creation, messaging and product search/resolve; delete derived hashes after 24 hours through periodic maintenance.
- Show a non-blocking registration prompt at 20 messages and block sending at 30 until the rolling window resets.
- Reject guest voice, attachment, character-creation writes, profile, admin, promotion and other protected operations on the server; Create upload, AI helpers and submit show an auth prompt before calling protected endpoints.
- Keep guest text outside formal memory, summaries, indexes, proactive delivery and user analytics.

### Acceptance

- A valid site path survives refresh and history navigation; IP/default routing cannot override it.
- Duplicate submits, retries, concurrent limits and AI retry do not duplicate messages, quota or model calls.
- Formal-user direct character links, chat pacing, analytics and protected endpoints remain unchanged.
- Browser, HTTP, database, deployment and multi-agent security/frontend/product reviews pass with no P0/P1 blocker.

## Batch 3: Guest Product Messages Without Promotions

Status: completed locally. All site switches are off after verification; server and GitHub are not updated.

### Implementation

- Detect product intent in guest chat and query only the frozen session site's trusted product source.
- Persist and return a guest-safe product snapshot; product text and card must use the same source result.
- Skip `promotion_campaign` and strip campaign IDs, codes, discount copy and entitlement fields from prompt context, storage and API output.
- Do not create campaign delivery, eligibility, order-profile or user-attribution records.

### Acceptance

- A guest can only receive products from the frozen site; no default-site or cross-site fallback is possible.
- Active campaigns and discount codes cannot leak through card data, text, response bodies or links.
- Empty, failed or out-of-stock sources do not produce invented price, stock or links.
- Formal product cards, promotion priority, discount display and analytics still pass regression tests.

## Batch 4: One Successful Guest Image

Status: completed locally. All site switches are off after verification; server and GitHub are not updated.

### Implementation

- Add the entitlement state machine `available -> reserved -> consumed` for the frozen site's mascot.
- Reuse the existing formal-user image intent, prompt, reference-material and safety rules; the only guest-specific content rule is a maximum of one successful image.
- Consume the entitlement only after the protected image asset reaches `ready`; failure or recoverable timeout returns it to `available`.
- Keep image access protected by the current guest cookie before claim and by the formal account after claim.
- Use one deterministic protected file per asset, staged-file recovery, job heartbeats and per-asset advisory locks so retries, restarts and expiry cleanup converge without duplicate or orphan images.
- Delete expired unclaimed guest sessions, image entitlements, queued jobs, image records and protected files through periodic maintenance.

### Acceptance

- Double click, concurrency, job replay, restart and recovery produce at most one successful image.
- Failed generation remains retryable; a second request after success is rejected deterministically.
- Expired/other guest cookies and cross-site requests cannot read the asset.
- Formal image generation, quotas, references, attachments and protected assets remain unchanged.

## Batch 5: Registration And Login Claim

Status: completed locally. All site switches are off after verification; server and GitHub are not updated.

### Implementation

- Claim the current valid guest within registration/login transaction boundaries after verifying the same site and mascot.
- Preserve existing account `site_id`; reject cross-site claim without exposing or moving guest data.
- Transfer or deterministically merge text messages, guest-safe product cards and ready image assets.
- Make claim idempotent and revoke the guest token after success; enqueue allowed formal indexes/summaries only after claim.
- Never backfill promotions, proactive messages or historical eligibility.

### Acceptance

- New registration retains guest history and lands in the same site's mascot chat.
- Same-site existing accounts transfer or merge without hiding old messages; cross-site accounts cannot claim.
- Failed auth, disconnects, duplicate submits, concurrent claim and cleanup do not lose or duplicate data.
- Invite-code, Google login, site assignment, mascot activation and formal account switching regressions pass.

### Local verification result

- Email registration, email login and Google callback claim the same-site guest and revoke the guest cookie; Google new-account cross-site mismatch rolls back identity creation.
- Existing same-site sessions merge under user/session locks with stable causal ordering; duplicate/concurrent claims converge and in-flight guest reply/image work remains valid.
- Claimed text is indexed asynchronously through a recoverable heartbeat job. Guest product/image history stays visible but is permanently excluded from later formal indexes, summaries, memory extraction, promotions and proactive jobs.
- Latest restarted local browser retained text and the protected ready image after registration and refresh; multi-agent state/security/frontend review reported no P0/P1.

## Final Verification And Release Gate

1. Run each batch's syntax, service, database, HTTP and browser checks plus adjacent formal-user regressions before starting the next batch.
2. After all batches, deploy with every `guest_chat_enabled` switch off, then run health and formal-user smoke checks.
3. Enable only the first approved site and simulate the complete browser journey: entry, text, product, one image, 20/30 prompts, registration claim, existing-account merge, cross-site refusal and all failure/retry cases.
4. On any failure, disable the site switch first, repair locally, and repeat from the failed batch.
5. Only after final acceptance update design status, release history, server and GitHub.

### Local final verification result

- A fresh FKK browser completed guest product recommendation, one ready protected image, the 20-message soft prompt, the 30-message hard stop and disabled 31st-send state. Local counters were accelerated to 19/29 for the two UI milestones; the full quota/concurrency behavior was separately exercised through the runtime suite.
- Registration from the hard prompt returned to the same FKK mascot and retained text, the guest-safe product card and the protected image across another full reload. Persisted indexes and summary links contained text only.
- A second browser logged an existing FKK account into a guest conversation and displayed both the previous formal marker and the guest marker in one active session.
- A third browser logged a GG account into an FKK guest conversation, returned to the GG path, displayed the site-mismatch notice and left the FKK guest active and unclaimed.
- Invalid/expired token, duplicate/retry/concurrent messages, image failure/recovery, product failure/sanitization, restricted operations and adjacent formal auth/chat/product/image/resource tests passed through the final regression matrix.
- Multisite full preflight and HTTP smoke passed. Temporary accounts, anonymous rate rows, verification codes and protected test files were removed. FKK was later re-enabled locally for the extended voice/attachment/call verification; GG remains off.
- Production deployment, production switch enablement, server verification and GitHub push remain intentionally outside this local-only run.

## Rollback

- Disable `guest_chat_enabled` for the affected site; formal users and existing `/api/chat/*` remain available.
- Do not delete guest data during an incident until ownership/claim state is verified.
- Code rollback uses the latest completed local checkpoint; database rollback must preserve additive guest columns/tables unless a separately reviewed migration is prepared.

## Admin Guest-Session Visibility Follow-up

Status: completed locally. Server and GitHub are not updated.

- The existing account-management page now switches between formal accounts and a read-only guest-session view without changing formal account mutations.
- Admins can inspect guest KPIs, filters, site/mascot ownership, rolling quota, image entitlement, claim state and guest-origin conversation history.
- `chat_messages.guest_session_id` is an additive nullable provenance field. It prevents claimed formal conversations from being misreported as guest history while leaving formal messages unchanged.
- Guest list and conversation reads require admin authentication, never return guest credentials, clamp pagination/search input and cap conversation payloads.
- Dedicated service checks, claim regressions, existing account regressions, real browser flows and the full deployment suite passed locally.

## Batch 6: Guest AI Voice Replies

Status: completed locally on 2026-07-12. Server and GitHub are not updated.

### Implementation

- Reuse the formal reply speech sanitizer, character voice metadata, TTS asset service and protected playback URL for guest opening lines and AI text replies.
- Add guest ownership to voice assets without creating a temporary user; TTS failure leaves the text reply successful and retryable without creating duplicate messages or assets.
- Keep the formal reply path unchanged and do not add a second TTS implementation.

### Acceptance

- Guest opening and AI replies expose ready voice playback when TTS succeeds; refresh restores the same asset.
- TTS timeout/provider/storage failure keeps readable text and does not duplicate reply, quota or asset.
- Other guests, expired cookies and cross-site requests cannot read the audio; formal voice generation and autoplay regressions pass.

### Verification checkpoint

- A fresh FKK guest opened the real chat page, received a seven-second voiced opening line, sent one text message and received a voiced four-second AI reply; both protected playback controls were usable and the browser reported no console errors or error overlay.
- The corresponding database session contained three guest-provenance messages, two `ready` voice assets and no failed voice asset.
- Provider/storage failure, same-asset retry, stale `finalizing` recovery, abandoned temporary-file cleanup, cleanup-versus-generation and late-worker-versus-recovery races passed dedicated checks.
- Formal opening/reply/retry/playback checks, the full deployment suite, multisite preflight and HTTP smoke passed. Two independent final reviews reported no remaining P0/P1.

## Batch 7: Guest Voice Input And Attachments

Status: completed locally on 2026-07-12. Server and GitHub are not updated.

### Implementation

- Enable the existing microphone and attachment controls in guest chat and route uploads through guest-only endpoints that reuse formal validation, ASR and attachment processing.
- Count each successful voice or attachment send once against the shared 30/24h and 10/10min limits; failed upload/ASR does not consume a message.
- Preserve the formal ordering: user upload/transcript message, AI pending state, then AI text/voice reply. Store files under protected guest ownership.

### Acceptance

- Voice and attachment messages refresh correctly and can be used by the same formal AI/vision context rules.
- Double submit, upload retry, ASR failure and quota concurrency never duplicate or over-count.
- Cross-guest, expired and forged file access is rejected; formal text/voice/attachment paths remain unchanged.

### Verification checkpoint

- Real FKK guest HTTP flow passed for attachment upload, stable upload-ID reuse, attachment send, protected owner read and anonymous rejection; real voice flow passed strict 16kHz mono PCM16 WAV validation, ASR, same-request replay without duplicate quota, two-stage reply and ready protected AI voice.
- Attachment uploads reserve guest/network budgets before reading the body, fence stale workers with attempt tokens and independent temporary files, recover stale `finalizing` state from either temp or final files, and remove historical temporary files during completion/deletion/expiry cleanup.
- Voice input reserves ASR work before provider calls, caps guest/network/global in-flight work, preserves transcript-before-reply order and recovers a missing second-stage reply without duplicating the user message or model call.
- Real browser showed enabled guest Attach and Voice message controls, disabled realtime Call, restored chat state and no console errors. Formal attachment/voice paths, claim/cleanup, the full deployment suite, multisite preflight and HTTP smoke passed.
- Final security, architecture/state and UI reviews reported no remaining P0/P1.

## Batch 8: Guest Realtime Calls

Status: completed locally on 2026-07-12. Server and GitHub are not updated.

### Implementation

- Extend the existing `/ws/call` authentication handshake to accept either a formal user or a valid guest cookie, never a client-supplied guest ID.
- Count every successfully persisted final guest-call transcript once in the shared 30-message rolling window; keep one active call per guest/network and retain elapsed time only for audit.
- Freeze the call to the guest site mascot and reuse formal STT, turn, product overlay, TTS and call UI behavior.

### Acceptance

- A guest can start, pause/resume and end a call with the frozen mascot; turns and product overlays match formal behavior.
- Parallel sockets, reconnects, duplicate turns, abrupt disconnect and refresh cannot duplicate shared message usage or create concurrent active calls.
- Expired/claimed/cross-site guests are rejected without affecting formal calls.

### Verification checkpoint

- Restarted local WebSocket accepted a valid FKK guest cookie and emitted `call_ready`, `call_usage`, `listening` and `call_ended`; wrong Origin, missing identity, unknown Upgrade and oversized payload returned deterministic rejection/close results.
- Each successfully persisted final transcript consumes one shared message; duplicate call/turn keys do not consume twice. Different cookies cannot bypass the same-network one-active guard, and global guest concurrency remains capped at 50; elapsed time is retained only for admin audit.
- Startup failure, server limit termination and unexpected socket close release microphone/audio resources, stop the UI timer and disable terminal pause state; guarded manual resume remains compatible with formal calls.
- Guest call turns persist and consume the shared message quota before the AI reply, recover missing replies, and preserve guest-safe products and ready voice. The 30th reply completes before the call ends and shows the existing authentication handoff.
- Guest/formal call, claim, cleanup, product, voice, frontend split, full deployment, multisite preflight and HTTP smoke checks passed. Security, architecture/state and UI reviews reported no remaining P0/P1.

## Batch 9: Claim, Cleanup And Final Regression

Status: completed locally on 2026-07-12. Server and GitHub are not updated.

### Implementation

- Transfer guest voice assets, attachments and ended call records during same-site claim; revoke guest access after claim and authorize the formal owner.
- Extend cleanup to remove expired unclaimed audio, attachments, call rows and protected files while coordinating with active jobs/calls and claim locks.
- Update admin guest visibility with voice/attachment/call usage where needed, then run the complete real-user simulation.

### Acceptance

- Registration/login keeps all guest chat modalities visible without duplicate files/messages; cross-site claim remains rejected.
- Cleanup removes only expired unclaimed guest resources and never deletes claimed/formal resources.
- Full guest and formal browser/API/database/worker/WebSocket regressions plus multisite smoke and independent reviews pass with no P0/P1.

### Verification checkpoint

- New-registration transfer and existing-account merge both preserved actual protected attachments and `ready` AI voice files; the formal owner could read them after claim while the old guest cookie received `401`.
- Every claimed call row records the claimant and target chat session. An active stale call is closed during claim; its elapsed duration is retained for audit without enforcing a time allowance.
- Expired unclaimed cleanup removes attachment, voice, image and call rows/files. Claimed resources survive later expiry cleanup, and a transaction-level guest/attachment lock prevents cleanup from deleting a file while claim is transferring ownership.
- Admin guest details now report voice-input, attachment-message, call count, call duration and call-turn usage. Call-only visitors count once in today's participation KPI without becoming temporary `users` accounts.
- Claim, cleanup, admin visibility, call split, formal chat/voice/image/call, the complete deployment suite, multisite preflight and HTTP smoke all passed locally. Final security, architecture/state and UI reviews reported no remaining P0/P1.
- FKK remains enabled for local verification and GG remains disabled. Production deployment, server verification and GitHub publication remain intentionally pending.
