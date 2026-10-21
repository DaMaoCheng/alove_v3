# Project Health Audit

Updated: 2026-06-27

This document records a read-only project health audit for `/Users/cheng/Projects/alove-workspace/alove-page-rebuild`.

Scope covered in this audit:

- code structure / oversized mixed-responsibility files
- backend security risks
- frontend and admin exposure surface
- deployment and secret-management weaknesses

This audit did not change code. It combines mainline review plus multi-agent codebase inspection.

## Verification Level

- `Confirmed by local runtime check`
  - local server returned `200` for:
    - `http://127.0.0.1:4173/.env.local`
    - `http://127.0.0.1:4173/server/config.js`
    - `http://127.0.0.1:4173/.git/config`
- `Checked on current public entry`
  - current public responses returned `404` for:
    - `https://alove.fans/.env.local`
    - `https://alove.fans/server/config.js`
    - `https://alove.fans/.git/config`
    - `http://47.76.136.38/.env.local`

Important boundary:

- current public entry is not directly exposing those files
- the code path is still unsafe and can re-expose them if deploy or proxy shape changes

## Critical Findings

### 1. Static file handler exposes the whole project root

- Files:
  - [server/http-utils.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/http-utils.js:139)
  - [server/config.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/config.js:4)
- Status:
  - confirmed locally
- Problem:
  - `serveStatic()` reads from `PROJECT_ROOT` directly instead of a dedicated public directory.
  - dotfiles, server code, logs, and repo metadata are inside that same root.
- Impact:
  - local env file, server source, git config, logs, and other sensitive artifacts can be downloaded if this code path is exposed.
- Notes:
  - public entry currently returns `404`, so outer server config is masking the issue.
  - code still needs fixing; outer masking is not a valid long-term defense.

### 2. Recharge settlement can be forged from the app API

- Files:
  - [server/billing-routes.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/billing-routes.js:16)
  - [server/billing-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/billing-service.js:48)
- Status:
  - code-level confirmed
- Problem:
  - `/api/recharge` directly calls `settleRecharge()` for an authenticated user.
  - no provider callback verification, no signature verification, no payment-status verification, no amount verification.
- Impact:
  - authenticated users may be able to mint balance/credits by replaying or fabricating recharge requests.

### 3. Browser auth token is returned in JSON while also set as HttpOnly cookie

- Files:
  - [server/auth-routes.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/auth-routes.js:67)
  - [server/auth-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/auth-service.js:116)
  - [server/http-utils.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/http-utils.js:89)
- Status:
  - code-level confirmed
- Problem:
  - login/register responses include the raw token in JSON.
  - the same token is also accepted through `Authorization: Bearer`.
- Impact:
  - `HttpOnly` protection is largely neutralized for browser flows.
  - any future XSS or unsafe browser-side integration can reuse the token directly.

## High-Risk Findings

### 4. Public product search path can use backend product credentials

- Files:
  - [server/product-search-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/product-search-service.js:164)
  - [server/product-source-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/product-source-service.js:27)
  - [server/product-source-shopify-admin-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/product-source-shopify-admin-service.js:14)
- Status:
  - code-level confirmed
- Problem:
  - public product search and resolve routes can read encrypted product access tokens from site config.
- Impact:
  - anonymous traffic may be able to query backend product inventory through the app as a proxy.

### 5. Arbitrary product source URL creates an SSRF surface

- Files:
  - [server/admin-site-product-source-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/admin-site-product-source-service.js:19)
  - [server/product-source-http-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/product-source-http-service.js:10)
- Status:
  - code-level confirmed
- Problem:
  - non-Shopify-admin product source URLs can point at arbitrary `http/https` targets.
  - current validation only blocks obvious `/admin/` paths.
- Impact:
  - if a bad URL is configured, public search traffic can drive server-side requests to internal or sensitive targets.

### 6. Login flow allows account enumeration and lacks visible brute-force controls

- Files:
  - [server/auth-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/auth-service.js:136)
  - [server/auth-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/auth-service.js:21)
- Status:
  - code-level confirmed
- Problem:
  - responses distinguish between “account not found” and “incorrect password”.
  - no clear login lockout or visible IP/account login throttle was found in the login path.
- Impact:
  - easier credential stuffing and account discovery.

### 7. Raw backend error messages are returned to the client

- Files:
  - [server/routes.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/routes.js:50)
  - [server/http-utils.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/http-utils.js:56)
- Status:
  - code-level confirmed
- Problem:
  - route failures pass `error.message` directly to the frontend.
- Impact:
  - internal query details, third-party failures, and validation internals may leak through user-facing errors.

### 8. Voice upload path skips strong file validation before STT

- Files:
  - [server/chat-routes.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/chat-routes.js:81)
  - [server/upload-security.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/upload-security.js:1)
- Status:
  - code-level confirmed
- Problem:
  - chat voice upload sends raw buffer to STT without going through the stronger validated upload path.
- Impact:
  - malformed or disguised files can consume vendor quota or trigger unstable error paths.

### 9. Client error reporting endpoint is unauthenticated

- Files:
  - [server/admin-routes.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/admin-routes.js:26)
  - [server/app-error-log-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/app-error-log-service.js:10)
- Status:
  - code-level confirmed
- Problem:
  - `/api/client-errors/report` accepts arbitrary client error payloads without auth.
- Impact:
  - log poisoning, noisy diagnostics, and storage abuse.

### 10. Admin permission model is too coarse

- Files:
  - [server/route-utils.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/route-utils.js:13)
  - [server/admin-routes.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/admin-routes.js:230)
- Status:
  - code-level confirmed
- Problem:
  - sensitive admin operations rely on a single `requireAdmin()` gate.
- Impact:
  - compromise of any admin account can likely escalate to broad platform control.

## Deployment and Secret-Handling Weaknesses

### 11. Release deployment defaults to `root`

- Files:
  - [scripts/deploy-server-release.mjs](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/scripts/deploy-server-release.mjs:9)
- Problem:
  - deployment defaults to `root@host`.
- Impact:
  - deploy credential compromise becomes full-server compromise.

### 12. No database-level backup or rollback in the deploy flow

- Files:
  - [scripts/deploy-server-release.mjs](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/scripts/deploy-server-release.mjs:130)
  - [docs/deployment/server-runbook.md](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/docs/deployment/server-runbook.md:95)
- Problem:
  - rollback shape is release relink only; no database snapshot or restore point is built into the flow.
- Impact:
  - destructive migration, seed, or live data repair mistakes cannot be cleanly reversed.

### 13. Runtime secrets are copied into each release

- Files:
  - [scripts/deploy-server-release.mjs](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/scripts/deploy-server-release.mjs:191)
  - [.env.local](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/.env.local:1)
- Problem:
  - `.env.local` is copied into each new release directory.
- Impact:
  - more cleartext secret copies, wider exposure surface, harder rotation hygiene.

### 14. Secret self-check skips `.env.local`

- Files:
  - [scripts/secret-leak-self-check.mjs](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/scripts/secret-leak-self-check.mjs:16)
- Problem:
  - the self-check intentionally skips `.env`, `.env.local`, and `.env.*`.
- Impact:
  - the highest-value secret file is outside the current audit path.

### 15. Deploy health check is too shallow

- Files:
  - [server/routes.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/routes.js:33)
  - [scripts/deploy-server-release.mjs](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/scripts/deploy-server-release.mjs:225)
- Problem:
  - `/api/health` is basic liveness only.
  - deploy flow does not force a richer post-deploy smoke gate.
- Impact:
  - a broken release can still be marked healthy if the process is merely up.

## Structural / “Growing Fat Again” Findings

These are not direct exploits, but they are the main areas where future defects will keep accumulating.

### 16. `server/db.js` is carrying too many responsibilities

- File:
  - [server/db.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/db.js:28)
- Current size:
  - about 939 lines
- Mixed concerns:
  - pool
  - transactions
  - initialization
  - migrations
  - table creation
  - seed and repair logic

### 17. Text and voice reply pipelines are still split twins

- Files:
  - [server/chat-text-message-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/chat-text-message-service.js:121)
  - [server/chat-voice-message-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/chat-voice-message-service.js:108)
- Problem:
  - both files keep re-implementing similar orchestration with slightly different branches.

### 18. Prompt construction is overpacked

- File:
  - [server/chat-prompt-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/chat-prompt-service.js:3)
- Problem:
  - persona, voice, memory, product, knowledge, and history rules are all packed into one builder.

### 19. Product search service mixes too many business paths

- File:
  - [server/product-search-service.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/server/product-search-service.js:16)
- Problem:
  - public search, admin search, old checkout hydration, site lookup, and ranking logic all live together.

### 20. Frontend entry and admin knowledge UI are growing back after earlier splits

- Files:
  - [src/app/main.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/src/app/main.js:23)
  - [src/features/admin-console/admin-knowledge-template.js](/Users/cheng/Projects/alove-workspace/alove-page-rebuild/src/features/admin-console/admin-knowledge-template.js:24)
- Problem:
  - these files have already gone through cleanup rounds and are showing signs of responsibility creep again.

## Recommended Fix Order

### Immediate stop-the-bleeding

1. fix static root exposure in code
2. remove or hard-disable direct recharge settlement from the public app API
3. split public product search from backend-token product source access
4. harden product source URL validation against SSRF
5. stop returning browser session token in JSON responses

### Short follow-up hardening

1. add login throttle and unified auth failure messages
2. stop returning raw backend error messages to the client
3. require auth or signed ingestion for client error reporting
4. strengthen upload validation for voice inputs
5. split admin permissions into finer roles

### Structural cleanup phase

1. split `server/db.js`
2. merge text and voice reply orchestration into a shared pipeline
3. split prompt layers out of `chat-prompt-service`
4. split public/admin/checkout concerns out of `product-search-service`

## Notes

- This document is intentionally conservative: only items confirmed from code or direct local response checks are recorded as findings.
- Public `404` on sensitive paths does not clear the root exposure issue; it only shows the current public edge is masking it.
