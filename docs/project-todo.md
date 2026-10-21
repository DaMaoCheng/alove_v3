# Project Todo

This file is the persistent local backlog for follow-up work that should not be done immediately. Keep items concise, actionable, and scoped enough to pick up later.

## Pending

### Site payment badges in product detail

- Status: completed locally on 2026-07-09
- Priority: medium
- Context: Some Shopify storefronts show payment method badges on product detail pages or home pages, such as Shop Pay, Apple Pay, Google Pay, Visa, and Mastercard.
- Goal: Render configured site-level payment badges in the in-app product detail panel without requiring per-product manual setup.
- Suggested approach:
  1. Reuse the site-level `payment_methods_json` configuration added on 2026-07-09.
  2. Render the selected badges in the existing product detail panel near the product CTA.
  3. Keep the feature optional: if a site has no selected payment methods, hide the badge row and keep product detail behavior unchanged.
- Notes: Do not add another Shopify payment/settings token for this V1 path. The current direction is manual site-level selection in the admin site editor, using local normalized badge assets.
- Progress: Product detail panels now render the configured site-level payment badges in the CTA footer, keep them hidden when no site methods are configured, and support one-line horizontal drag when the badge row overflows.

### Knowledge frontend cleanup round 5

- Status: completed
- Priority: high
- Context: After the 2026-06-26 knowledge access scope and readonly-display work, the admin knowledge frontend started accumulating mixed responsibilities across controller, template, and admin CSS files.
- Goal: Split knowledge frontend code without changing user-facing behavior, following `docs/superpowers/plans/2026-06-26-knowledge-frontend-cleanup-round-5.md`.
- Progress: Completed locally on 2026-06-26. The admin knowledge controller was reduced to page orchestration, editor lifecycle moved to `admin-knowledge-editor.js`, target picker behavior moved to `admin-knowledge-target-picker.js`, knowledge templates moved to `admin-knowledge-template.js`, and knowledge styles moved to `admin-knowledge.css`.
- Verification: Targeted knowledge self-checks passed, and Playwright real admin checks passed for `/admin?view=kb`, `/admin?view=commonCharacters`, `/admin?view=creatorCharacters`, and `/admin?view=mascot`.
- Remaining parts: none. This cleanup round is complete.

### Architecture cleanup round 3

- Status: completed
- Priority: high
- Context: After the completed 2026-06-23 cleanup round, several new hotspots are starting to mix responsibilities again across chat product UI, search page orchestration, admin knowledge backend, AI reply plumbing, chat reply orchestration, and admin sites management.
- Goal: Execute the next cleanup round without changing user-facing behavior, following `docs/superpowers/plans/2026-06-23-architecture-cleanup-round-3.md`.
- Suggested order:
  1. `src/features/chat/chat-product-panel.js`
  2. `src/features/search/search-page.js`
  3. `server/admin-knowledge-service.js`
  4. `server/ai-reply-service.js`
  5. `server/chat-text-message-service.js`
  6. `src/features/admin-console/admin-sites-controller.js`
- Notes: Keep public entry points stable, add or update split self-checks per part, and do not mix this round with behavior redesign or infrastructure refactors.
- Progress: Part 1 completed locally on 2026-06-23. `chat-product-panel.js` was split into template/renderer/gallery modules, chat remount paths now preserve an already-open product detail panel, product panel self-checks were updated, and real-browser chat verification passed for multi-image persistence, button paging, drag paging, product switching, and close behavior.
- Progress: Part 2 completed locally on 2026-06-23. `search-page.js` was split into topbar/results-renderer/product-state modules, the duplicate render/callback ownership between page and state was cleaned up, split self-checks were updated, and real-browser search verification passed on desktop/mobile for `/footballkituk/search`.
- Progress: Part 3 completed locally on 2026-06-23. `admin-knowledge-service.js` was reduced to a compatibility entry, with query/write/normalizer/mapper modules owning the backend knowledge responsibilities; DB-backed create/update/delete self-checks passed serially and authenticated HTTP list/detail smoke checks passed.
- Progress: Part 4 completed locally on 2026-06-23. `ai-reply-service.js` was reduced to an orchestration entry, with provider/contract/fallback modules owning transport, structured reply parsing, and fallback payload logic; AI reply split self-check plus empty-reply retry, output-contract, voice-meta, structured-reply, and voice/text-alignment checks all passed.
- Progress: Part 5 completed locally on 2026-06-23. `chat-text-message-service.js` kept transaction and reply orchestration ownership while product reply payload/analytics moved to `chat-product-reply-service.js` and TTS model decisions moved to `chat-reply-voice-service.js`; split, product, stale mascot, voice alignment, DB-backed chat, and authenticated HTTP mascot guard checks passed.
- Progress: Part 6 completed locally on 2026-06-23. `admin-sites-controller.js` was reduced to list/default-site orchestration, while modal save flow moved to `admin-sites-editor.js` and selected-region filtering/search state moved to `admin-sites-region-picker.js`; split, region picker UI, currency removal, authenticated admin sites API, and admin sites page-entry checks passed.
- Remaining parts: none. This cleanup round is complete.

### Architecture cleanup round 4

- Status: completed
- Priority: high
- Context: After the 2026-06-23 cleanup rounds and the 2026-06-25 Shopify Admin/product-source work, several hotspots have started accumulating mixed responsibilities again.
- Goal: Execute the next cleanup round in order, recording a baseline before each part, preserving behavior, running targeted real-chain verification after each part, and updating release/log records before moving to the next part.
- Plan: `docs/superpowers/plans/2026-06-25-architecture-cleanup-round-4.md`
- Suggested order:
  1. project hygiene and reproducibility
  2. product source backend split
  3. admin site service split
  4. proactive message and campaign chain split
  5. voice product reply chain split
  6. frontend product/admin cleanup
- Notes: Keep existing facade imports stable. Do not delete old files, untracked artifacts, or historical docs unless the user explicitly approves cleanup.
- Progress: Part 1 completed locally on 2026-06-25. Project handoff hygiene was recorded, scripts index was added, the historical deployment checklist was marked, Round 3 todo state was corrected, generated test results were ignored, and deployment package verification passed.
- Progress: Part 2 completed locally on 2026-06-25. `server/product-source-service.js` was reduced to a facade with HTTP, Shopify Admin, Shopify public, and shared source modules; product source/search/normalizer/context/secret self-checks and real local/online FKK product search passed.
- Progress: Part 3 completed locally on 2026-06-25. `server/admin-site-service.js` was reduced to a facade with query/write/mapper/product-source/region/shared modules; admin site product source, region picker, geo-region, mascot sync, multisite preflight, local health, and multisite HTTP smoke checks passed.
- Progress: Part 4 completed locally on 2026-06-25. `server/proactive-message-job-service.js` kept memory-job orchestration while proactive gate checks moved to `proactive-message-gate-service.js` and prompt/session/character context moved to `proactive-message-context-service.js`; proactive send, scheduler, campaign product, campaign snapshot, proactive voice, local health, and deployment package checks passed.
- Progress: Part 5 completed locally on 2026-06-25. `server/chat-voice-message-service.js` now reuses `chat-product-reply-service.js` for product selection, product bubble insertion, and product analytics, matching the text reply path; voice/text alignment, product trigger/context, voice asset, voice text-flow, local health, and deployment package checks passed.
- Progress: Part 6 completed locally on 2026-06-25. `admin-promotion-campaigns-controller.js` now owns only list/filter/open-editor orchestration while `admin-promotion-campaigns-editor.js` owns modal lifecycle, save payload extraction, and product picker search/selection; frontend split, campaign backend split, admin UI smoke, local admin page HEAD, deployment check, and package verification passed.
- Remaining parts: none. This cleanup round is complete.

### Post-2026-06-20 architecture cleanup round 2

- Status: completed
- Priority: high
- Context: After the formal `2026-06-20-architecture-split-followup` split, several hotspots have grown back across admin styles, mascot admin backend, admin accounts controller, chat page rendering, and promotion campaign backend.
- Goal: Execute the next cleanup round without changing user-facing behavior, following `docs/superpowers/plans/2026-06-23-post-2026-06-20-architecture-cleanup.md`.
- Suggested order:
  1. `src/features/app-shell/styles/admin-console.css`
  2. `server/admin-mascot-service.js`
  3. `src/features/admin-console/admin-accounts-controller.js`
  4. `src/features/chat/chat-page.js`
  5. `server/promotion-campaign-service.js`
- Notes: Keep public entry points stable, update self-check boundaries before or during each split, and do not mix this cleanup round with behavior redesign.
- Progress: Part 1 completed locally on 2026-06-23. `admin-console.css` page-specific styles were split into overview/accounts/mascot/promotion/logs files, self-checks were updated, and desktop real-browser admin verification passed.
- Progress: Part 2 completed locally on 2026-06-23. `server/admin-mascot-service.js` was split into query/write/mapper/shared modules, DB-backed mascot self-checks were updated to the current `site_gg/site_fkk` model, temporary write-check fixtures now self-clean, and real-browser `/admin?view=mascot` verification passed on desktop/mobile.
- Progress: Part 3 completed locally on 2026-06-23. `admin-accounts-controller.js` was split into state/list-actions/bulk-actions/bulk-modal modules, the current-page selection helper was restored for `选择本页`, and real-browser `/admin?view=accounts` verification passed on desktop/mobile.
- Progress: Part 4 completed locally on 2026-06-23. `chat-page.js` was reduced to page assembly, while quick replies, message rendering, product card rendering, and product impression reporting moved into focused chat modules; affected self-checks were updated to the new file boundaries, and real-browser chat verification passed on desktop/mobile for `/footballkituk/chat?agent=fan`.
- Progress: Part 5 completed locally on 2026-06-23. `promotion-campaign-service.js` was split into query/write/normalizer/mapper/stats modules, the split self-check was updated to accept named export blocks, DB-backed campaign self-checks passed serially, and real HTTP admin verification confirmed list/create/update responses still worked with `stats` after restarting the local service.
- Remaining parts: none. This cleanup round is complete.

### ElevenLabs front-desk Professional Voice Clone verification

- Status: completed locally
- Priority: high
- Context: Front-desk/mascot shared PVC `ALOVE Front Desk PVC` is verified, fine-tuned, and able to generate TTS.
- Goal: Local binding is complete. Deploy the binding to the server and verify online front-desk voice replies after the next release.
- Detail: See `docs/integrations/elevenlabs-frontdesk-voice-todo-2026-06-22.md`.

### Global user-facing error handling

- Status: pending
- Priority: medium
- Context: Create page and AI avatar modal now hide raw remote/model errors, but the project still has multiple places that may display raw `error.message` directly.
- Goal: Add a shared frontend error presentation helper that keeps user-correctable validation messages specific, while converting system/API/model/database/timeout errors to page-language-appropriate generic messages.
- Suggested scope:
  - Add a shared utility such as `getUserFacingErrorMessage(error, { locale, fallbackType, allowKnownValidation })`.
  - Preserve raw errors for logs/analytics via `raw_reason`, `payload`, `status`, or request ids.
  - First wire high-frequency user surfaces: create character, avatar generation, chat send/voice/attachment, auth/register/reset, admin generic failures.
  - Avoid replacing validation messages like file size, unsupported format, password mismatch, missing required fields, or permission/account-type explanations.
- Notes: Current create page language is English, while admin pages are mostly Chinese. The helper must choose copy by page/context, not a hardcoded global language.
