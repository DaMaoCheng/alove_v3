# Architecture Cleanup Round 4 Plan

> Scope: execute the next cleanup pass in six ordered parts. Each part must keep user-facing behavior stable, record a baseline before edits, run targeted real-chain verification after edits, then update the release node and daily logs before moving on.

## Baseline

- Previous cleanup baseline: `docs/superpowers/plans/2026-06-23-architecture-cleanup-round-3.md`
- Round 3 status: complete in `docs/project-todo.md`
- Current local project: `/Users/cheng/Projects/alove-workspace/alove-page-rebuild`
- Current server: `47.76.136.38`
- Current public URL: `https://alove.fans`

Initial baseline checks before Part 1:

- Local health: `curl -fsS http://127.0.0.1:4173/api/health`
- Server health: `curl -fsS https://alove.fans/api/health`
- Server FKK product search: `curl -fsS 'https://alove.fans/api/products/search?siteSlug=footballkituk&query=milan&limit=2'`

## Part 1: Project Hygiene And Reproducibility

**Goal:** Reduce handoff and release confusion before touching behavior.

**Work:**

- Add a scripts index that explains main commands, self-check categories, write-risk boundaries, and local script entry points.
- Mark old deployment checklist as historical and point agents to the current runbook.
- Fix the completed Round 3 todo status so future agents do not repeat completed splits.
- Ignore generated `test-results/`.
- Keep generated deployment metadata documented as generated state.

**Validation:**

- `git diff --check`
- `npm run check:deployment`
- `DEPLOY_RELEASE_ID=2026-06-25-project-hygiene-baseline npm run package:deployment`
- Local/server health stays `ok`.

## Part 2: Product Source Backend Split

**Goal:** Keep `fetchProductSummary()` stable while splitting provider-specific product source code.

**Target files:**

- Keep facade: `server/product-source-service.js`
- Create Shopify Admin source module.
- Create Shopify public source module.
- Create generic HTTP source module.
- Create shared source HTTP/secret helper if needed.

**Validation:**

- Existing product source, product search, product normalizer, and secret leak self-checks.
- Real FKK product search returns Shopify products.
- Confirm no mutation-style Shopify Admin request is introduced.

## Part 3: Admin Site Service Split

**Goal:** Separate site CRUD, region binding, and product source secret handling.

**Target files:**

- Keep facade: `server/admin-site-service.js`
- Create site query/write modules.
- Create region binding module.
- Create site product source module.

**Validation:**

- Existing admin site product source and region picker checks.
- Authenticated admin site API check.
- Confirm token remains non-returned and leave-empty keeps previous encrypted token.

## Part 4: Proactive Message And Campaign Chain Split

**Goal:** Centralize proactive send policy and outbound message writing.

**Target files:**

- `server/proactive-message-scheduler-service.js`
- `server/proactive-message-job-service.js`
- `server/chat-proactive-message-service.js`
- campaign match/delivery helpers if needed

**Validation:**

- Proactive scheduler, proactive voice, campaign product message, and campaign snapshot checks.
- Confirm no duplicate proactive send, quiet-hours behavior remains stable, and campaign delivery stays one-per-user.

## Part 5: Voice Product Reply Chain Split

**Goal:** Make voice replies reuse the same product reply pipeline as text replies.

**Target files:**

- `server/chat-voice-message-service.js`
- `server/chat-product-reply-service.js`
- new shared reply pipeline helper if needed

**Validation:**

- Voice text alignment, product trigger, product context, chat voice asset, and voice message checks.
- Real chat smoke test for product-triggered voice/text consistency if local service is available.

## Part 6: Frontend Product/Admin Cleanup

**Goal:** Reduce duplicated product UI payload shaping and isolate admin product picker/site templates.

**Target files:**

- `src/features/admin-console/admin-promotion-campaigns-controller.js`
- `src/features/admin-console/admin-console-sites-template.js`
- `src/features/search/search-results-renderer.js`
- `src/features/chat/chat-product-card.js`
- selected admin CSS files

**Validation:**

- Search page, promotion campaign product picker, chat product panel, admin site UI, and related self-checks.
- Real browser check for search product detail and admin campaign product selection if local service is available.

## Guardrails

- Do not change public API payloads unless the part explicitly requires it and the user confirms.
- Keep existing facade imports stable.
- Add or update split self-checks with each part.
- Do not mix behavior redesign into cleanup parts.
- Do not delete old files or untracked artifacts unless the user explicitly approves cleanup.
