# Post-2026-06-20 Architecture Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue the 2026-06-20 structure cleanup by splitting the new hotspot files that have grown back since that release, without changing user-facing behavior.

**Architecture:** Keep existing public entry points stable. Do not redesign admin routes, chat routes, or page wiring. Extract dense responsibility clusters into focused modules by feature boundary: admin styles, mascot admin backend, admin account page actions, chat page rendering/quick replies, and promotion campaign backend.

**Tech Stack:** Node.js ES modules, browser ES modules, existing admin console modules, existing self-check scripts, CSS `@import` structure, MySQL-backed service modules.

---

## Baseline

This plan treats `2026-06-20-architecture-split-followup` as the last formal split baseline.

Reference files:
- `logs/updates/2026-06-20.md`
- `docs/releases/2026-06-20-architecture-split-followup.md`
- `docs/superpowers/plans/2026-06-20-architecture-split-followup.md`

Current post-baseline hotspots to clean up:
- `src/features/app-shell/styles/admin-console.css`
- `server/admin-mascot-service.js`
- `src/features/admin-console/admin-accounts-controller.js`
- `src/features/chat/chat-page.js`
- `server/promotion-campaign-service.js`

## Part 1: Admin Console Styles Second Split

**Why:** `src/features/app-shell/styles/admin-console.css` has grown back into a shared sink for unrelated admin subdomains. It now mixes generic table/layout rules with overview, accounts, mascot, promotion campaigns, logs, and site-region picker styles.

**Files:**
- Modify: `src/features/app-shell/styles/admin-console.css`
- Create: `src/features/app-shell/styles/admin-overview.css`
- Create: `src/features/app-shell/styles/admin-accounts.css`
- Create: `src/features/app-shell/styles/admin-mascot.css`
- Create: `src/features/app-shell/styles/admin-promotion-campaigns.css`
- Create: `src/features/app-shell/styles/admin-logs.css`
- Modify: `src/features/app-shell/app.css`
- Create: `scripts/admin-console-style-round2-self-check.mjs`
- Update if needed: existing admin style self-checks that still assume everything lives in one file.

**Target boundary:**
- Keep in `admin-console.css`:
  - shell layout
  - topbar
  - generic buttons/filters used across admin
  - generic `.data-table`, `.dt-head`, `.dt-row`, `.pill`, pager primitives
  - shared agent form primitives if still truly cross-page
- Move to `admin-overview.css`:
  - KPI cards
  - product funnel cards
  - product rank panel shell
- Move to `admin-accounts.css`:
  - account bulk bar
  - account detail rows
  - account conversation modal
- Move to `admin-mascot.css`:
  - mascot template card
  - mascot site card
  - mascot bind blocks
- Move to `admin-promotion-campaigns.css`:
  - promotion toolbar
  - campaign table width rules
  - product picker dropdown
  - campaign stats row styles
- Move to `admin-logs.css`:
  - logs page shell
  - log filters
  - log row layout
- Keep import order stable in `app.css` so later files only narrow their own page scope.

**Validation:**
- `node scripts/admin-console-style-split-self-check.mjs`
- `node scripts/admin-console-style-round2-self-check.mjs`
- `git diff --check -- src/features/app-shell/app.css src/features/app-shell/styles/admin-console.css src/features/app-shell/styles/admin-overview.css src/features/app-shell/styles/admin-accounts.css src/features/app-shell/styles/admin-mascot.css src/features/app-shell/styles/admin-promotion-campaigns.css src/features/app-shell/styles/admin-logs.css scripts/admin-console-style-round2-self-check.mjs`
- Real browser check for:
  - `/admin?view=overview`
  - `/admin?view=accounts`
  - `/admin?view=mascot`
  - `/admin?view=promotionCampaigns`
  - `/admin?view=logs`

**Success standard:**
- No visual regression on the five admin subpages above.
- `admin-console.css` goes back to generic shell/table/shared primitives instead of page-specific accumulation.

## Part 2: Mascot Admin Backend Split

**Why:** `server/admin-mascot-service.js` now mixes template save, site mascot save, unbound mascot bind/update, disable/archive flow, site list query assembly, mapper logic, validation, and ad-delivery stub behavior.

**Files:**
- Modify: `server/admin-mascot-service.js`
- Create: `server/admin-mascot-query-service.js`
- Create: `server/admin-mascot-write-service.js`
- Create: `server/admin-mascot-mapper.js`
- Create: `server/admin-mascot-shared.js`
- Create: `scripts/admin-mascot-backend-split-self-check.mjs`
- Update if needed: `scripts/admin-mascot-ui-self-check.mjs`, `scripts/admin-mascot-site-bound-fallback-self-check.mjs`

**Target boundary:**
- `admin-mascot-service.js`
  - keep exported public entry points only
  - delegate read/write work to the new modules
- `admin-mascot-query-service.js`
  - build template mascot payload
  - load site mascot cards
  - load unbound mascots
- `admin-mascot-write-service.js`
  - template save
  - site mascot save
  - unbound mascot create/update bind
  - disable/archive flow
  - ad delivery record creation if it remains needed
- `admin-mascot-mapper.js`
  - `mapMascotSetting`
  - `mapMascotSiteRow`
  - `mapUnboundMascotRow`
  - default template fallback object
- `admin-mascot-shared.js`
  - payload normalization
  - category/site assertions
  - id helpers
  - knowledge binding replacement helpers

**Validation:**
- `node --check server/admin-mascot-service.js`
- `node --check server/admin-mascot-query-service.js`
- `node --check server/admin-mascot-write-service.js`
- `node --check server/admin-mascot-mapper.js`
- `node --check server/admin-mascot-shared.js`
- `node scripts/admin-mascot-backend-split-self-check.mjs`
- Existing mascot/admin self-check group relevant to site binding and fallback

**Success standard:**
- Admin mascot API payload shape stays unchanged.
- Site-specific mascot binding, template fallback, and disable/archive behavior stay unchanged.
- `server/admin-mascot-service.js` becomes a thin entry module.

## Part 3: Admin Accounts Controller Split

**Why:** `src/features/admin-console/admin-accounts-controller.js` currently owns page state, rendering, DOM event binding, bulk operations, selection logic, pagination/search, modal creation, and account status actions.

**Files:**
- Modify: `src/features/admin-console/admin-accounts-controller.js`
- Create: `src/features/admin-console/admin-accounts-state.js`
- Create: `src/features/admin-console/admin-accounts-list-actions.js`
- Create: `src/features/admin-console/admin-accounts-bulk-actions.js`
- Create: `src/features/admin-console/admin-accounts-bulk-modal.js`
- Create: `scripts/admin-accounts-controller-split-self-check.mjs`

**Target boundary:**
- `admin-accounts-controller.js`
  - keep `bindAdminAccounts(shell)` entry
  - wire state, render, and imported action binders
- `admin-accounts-state.js`
  - page state object
  - selection helpers
  - `updateAccountInState`
  - `pruneSelectionToCurrentItems`
- `admin-accounts-list-actions.js`
  - row expand/collapse
  - paging
  - filters
  - search debounce
  - open conversation/edit/password actions
- `admin-accounts-bulk-actions.js`
  - select all matching accounts
  - bulk role/site/status operations
  - success/error toast/dialog handling for batch work
- `admin-accounts-bulk-modal.js`
  - modal HTML mounting/unmounting
  - bulk select modal submit wiring

**Validation:**
- `node --check src/features/admin-console/admin-accounts-controller.js`
- `node --check src/features/admin-console/admin-accounts-state.js`
- `node --check src/features/admin-console/admin-accounts-list-actions.js`
- `node --check src/features/admin-console/admin-accounts-bulk-actions.js`
- `node --check src/features/admin-console/admin-accounts-bulk-modal.js`
- `node scripts/admin-accounts-controller-split-self-check.mjs`
- Real browser check on `/admin?view=accounts`

**Success standard:**
- Search focus retention, paging, bulk selection, bulk site change, and account status change all behave exactly the same.
- Controller returns to page binding only, not modal and bulk logic sink.

## Part 4: Chat Page Rendering Split

**Why:** `src/features/chat/chat-page.js` now mixes page assembly, quick-reply fallback strategy, archived-character messaging, message rendering, product-card rendering, product panel payload shaping, image normalization, and product impression analytics.

**Files:**
- Modify: `src/features/chat/chat-page.js`
- Create: `src/features/chat/chat-quick-replies.js`
- Create: `src/features/chat/chat-message-renderer.js`
- Create: `src/features/chat/chat-product-card.js`
- Create: `src/features/chat/chat-product-impressions.js`
- Create: `scripts/chat-page-split-self-check.mjs`
- Update if needed: `scripts/chat-quick-replies-self-check.mjs`, `scripts/chat-product-panel-state-self-check.mjs`, `scripts/chat-product-impression-parser-self-check.mjs`

**Target boundary:**
- `chat-page.js`
  - keep `createChatPage`
  - keep `scrollChatToLatest`
  - keep `bindChatAutoScroll`
  - import quick replies, renderer, and product impression helpers
- `chat-quick-replies.js`
  - fallback quick reply banks
  - product vs daily quick reply selection
  - shuffle/sample logic
  - emoji decoration logic
- `chat-message-renderer.js`
  - `renderChatMessages`
  - text/attachment/system/character message rendering
  - archived/private tag helpers if still display-only
- `chat-product-card.js`
  - product card HTML
  - product panel payload shaping
  - analytics payload shaping
  - image list normalization
- `chat-product-impressions.js`
  - message-id dedupe set
  - impression reporting
  - dataset payload parse helper

**Validation:**
- `node --check src/features/chat/chat-page.js`
- `node --check src/features/chat/chat-quick-replies.js`
- `node --check src/features/chat/chat-message-renderer.js`
- `node --check src/features/chat/chat-product-card.js`
- `node --check src/features/chat/chat-product-impressions.js`
- `node scripts/chat-page-split-self-check.mjs`
- Existing chat self-checks around quick replies, product panel, product impressions, and archived character access

**Success standard:**
- Chat page still renders the same DOM contract for existing features.
- Quick reply randomization still only changes on page refresh, not on message send.
- Product impression reporting and product panel payloads remain unchanged.

## Part 5: Promotion Campaign Backend Split

**Why:** `server/promotion-campaign-service.js` is a new hotspot. It already mixes list filtering, stats aggregation, create/update, payload normalization, snapshot normalization, keyword normalization, and mapper helpers.

**Files:**
- Modify: `server/promotion-campaign-service.js`
- Create: `server/promotion-campaign-query-service.js`
- Create: `server/promotion-campaign-write-service.js`
- Create: `server/promotion-campaign-normalizers.js`
- Create: `server/promotion-campaign-mapper.js`
- Create: `server/promotion-campaign-stats-service.js`
- Create: `scripts/promotion-campaign-backend-split-self-check.mjs`
- Update if needed: `scripts/promotion-campaign-self-check.mjs`, `scripts/promotion-campaign-product-message-self-check.mjs`, `scripts/promotion-campaign-product-snapshot-self-check.mjs`

**Target boundary:**
- `promotion-campaign-service.js`
  - keep exported public entry points only
- `promotion-campaign-query-service.js`
  - list filters
  - single-row load by id
- `promotion-campaign-write-service.js`
  - create and update persistence
- `promotion-campaign-normalizers.js`
  - campaign payload normalization
  - product snapshot normalization
  - keyword, priority, status, datetime normalization
- `promotion-campaign-mapper.js`
  - db row to API row mapping
  - parse keywords
  - parse snapshot
- `promotion-campaign-stats-service.js`
  - delivery and analytics aggregation
  - ratio helper and default stats object

**Validation:**
- `node --check server/promotion-campaign-service.js`
- `node --check server/promotion-campaign-query-service.js`
- `node --check server/promotion-campaign-write-service.js`
- `node --check server/promotion-campaign-normalizers.js`
- `node --check server/promotion-campaign-mapper.js`
- `node --check server/promotion-campaign-stats-service.js`
- `node scripts/promotion-campaign-self-check.mjs`
- `node scripts/promotion-campaign-backend-split-self-check.mjs`
- `node scripts/promotion-campaign-product-message-self-check.mjs`
- `node scripts/promotion-campaign-product-snapshot-self-check.mjs`

**Success standard:**
- Campaign list/create/update/statistics payloads stay unchanged.
- The service entry file becomes orchestration-only.
- Future campaign features can land in focused modules instead of continuing to enlarge one file.

## Part 6: Execution Order And Guardrails

**Recommended order:**
1. Admin console styles second split
2. Mascot admin backend split
3. Admin accounts controller split
4. Chat page rendering split
5. Promotion campaign backend split

**Why this order:**
- Part 1 and Part 2 are already impacting multiple active feature areas.
- Part 3 and Part 4 are next in churn risk because they absorb UI iterations fast.
- Part 5 is newer and still contained to one domain, so it can follow after the older hotspots are reduced.

**Guardrails:**
- No behavior redesign in this cleanup round.
- No new dependencies.
- No schema changes.
- No broad naming rewrites outside touched modules.
- Update self-check readers first when a split would otherwise break string-scanning tests.
- If any part fails twice in a row because boundaries are wrong, pause and re-scope that part before continuing.

## Final Verification

After any implementation pass based on this plan:
- Run targeted `node --check` for touched files.
- Run targeted self-checks for the part being executed.
- Run `git diff --check` on touched files only.
- For UI-facing parts, do real browser verification at desktop and mobile widths.
- Update:
  - `logs/updates/YYYY-MM-DD.md`
  - relevant `docs/releases/*.md`
  - `docs/project-todo.md` if scope/order changes during execution

## Out Of Scope For This Round

- `server/db.js` foundational breakup
- global auth/service runtime cleanup
- search page restructuring
- promotion campaign analytics dashboard redesign
- converting every old admin controller to a shared framework

## Expected Outcome

After this round, the project should regain the same shape it had after the 2026-06-20 cleanup: stable public entry points, lower-risk hotspot files, and clearer places to continue feature work without pushing everything back into one file.
