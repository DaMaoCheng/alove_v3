# Site Routing First Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first phase of multi-site routing locally: GG (`gogoalshop`) as default, FKK (`footballkituk`) as a second frontend site, site-prefixed frontend URLs, and session-aware navigation behavior.

**Architecture:** Keep the backend admin console global at `/admin`. Add a focused frontend routing helper that parses `/{siteSlug}/{page}` paths, generates site-prefixed frontend paths, and falls back no-prefix frontend paths to the default site. Auth responses expose account site assignment so the frontend can distinguish assigned users from unassigned users.

**Tech Stack:** Vanilla ES modules, Node.js server, MySQL via `mysql2`, existing SPA state/navigation modules.

---

### Task 1: Routing Rules Self-Check

**Files:**
- Create: `scripts/site-routing-first-phase-self-check.mjs`
- Create: `src/app/site-routing.js`
- Modify: `src/app/access-control.js`

- [ ] **Step 1: Write failing self-check**

Create `scripts/site-routing-first-phase-self-check.mjs` with assertions for:

```js
import assert from "node:assert/strict";
import {
  DEFAULT_SITE_SLUG,
  getSiteSlugFromPath,
  getViewFromSitePath,
  pathForSiteView,
  shouldRedirectToDefaultSite,
} from "../src/app/site-routing.js";

assert.equal(DEFAULT_SITE_SLUG, "gogoalshop");
assert.equal(getSiteSlugFromPath("/gogoalshop/login"), "gogoalshop");
assert.equal(getSiteSlugFromPath("/footballkituk/discover"), "footballkituk");
assert.equal(getSiteSlugFromPath("/admin"), "");
assert.equal(getViewFromSitePath("/gogoalshop/login"), "login");
assert.equal(getViewFromSitePath("/gogoalshop/register"), "register");
assert.equal(getViewFromSitePath("/footballkituk/discover"), "discover");
assert.equal(getViewFromSitePath("/footballkituk/chat"), "chat");
assert.equal(pathForSiteView("gogoalshop", "login"), "/gogoalshop/login");
assert.equal(pathForSiteView("footballkituk", "discover"), "/footballkituk/discover");
assert.equal(pathForSiteView("footballkituk", "chat", { agent: "fan" }), "/footballkituk/chat?agent=fan");
assert.equal(shouldRedirectToDefaultSite("/login"), true);
assert.equal(shouldRedirectToDefaultSite("/admin"), false);

console.log("site routing first phase self-check passed");
```

- [ ] **Step 2: Run and verify red**

Run:

```bash
node scripts/site-routing-first-phase-self-check.mjs
```

Expected: fails because `src/app/site-routing.js` does not exist yet.

- [ ] **Step 3: Implement routing helper**

Create `src/app/site-routing.js` with constants for `gogoalshop` and `footballkituk`, default site `gogoalshop`, and helper functions used by the self-check.

- [ ] **Step 4: Wire access-control**

Modify `src/app/access-control.js` so `getInitialViewFromPath()` understands site-prefixed frontend paths while keeping `/admin` global.

- [ ] **Step 5: Run green checks**

Run:

```bash
node scripts/site-routing-first-phase-self-check.mjs
node --check src/app/site-routing.js
node --check src/app/access-control.js
```

Expected: all pass.

### Task 2: Frontend Navigation Uses Site Prefix

**Files:**
- Modify: `src/app/app-state.js`
- Modify: `src/app/app-navigation.js`
- Modify: `src/app/app-session-actions.js`

- [ ] **Step 1: Add state fields**

Add `site` state with `currentSlug`, `defaultSlug`, `assignedSiteId`, `assignedSiteSlug`.

- [ ] **Step 2: Use site path generation**

Update `pushViewPath()` so frontend views generate `/{siteSlug}/{page}` paths. Keep admin paths unchanged.

- [ ] **Step 3: Preserve unassigned account site context**

After login/register/session hydration, keep the current path's `siteSlug` when the account has no assigned site. If the account has an assigned site slug, switch `currentSlug` to that slug.

- [ ] **Step 4: Run checks**

Run:

```bash
node --check src/app/app-state.js
node --check src/app/app-navigation.js
node --check src/app/app-session-actions.js
node scripts/site-routing-first-phase-self-check.mjs
```

### Task 3: Auth Responses Include Site Assignment

**Files:**
- Modify: `server/auth-service.js`
- Modify: `src/store/session-store.js`
- Modify: `src/app/app-session-actions.js`
- Modify: `src/services/auth-service.js`

- [ ] **Step 1: Backend returns site fields**

Update login and current-user responses to include `siteId`, `siteSlug`, and `siteName` from `users.site_id` joined to `sites`.

- [ ] **Step 2: Frontend stores site fields**

Update session store and `syncSessionState()` to persist and expose `siteId`, `siteSlug`, `siteName`.

- [ ] **Step 3: Send current site during login/register**

Add `siteSlug` to login/register request bodies so backend receives current site context for future registration rules.

- [ ] **Step 4: Run checks**

Run:

```bash
node --check server/auth-service.js
node --check src/store/session-store.js
node --check src/app/app-session-actions.js
node --check src/services/auth-service.js
```

### Task 4: Site Seeds for GG/FKK

**Files:**
- Modify: `database/schema.sql`
- Modify: `server/db.js`
- Test: `scripts/site-routing-first-phase-self-check.mjs` or a new DB seed assertion if needed.

- [ ] **Step 1: Seed required sites**

Ensure local database initialization/upsert contains:

```text
site_gg: name GG, slug gogoalshop, default true
site_fkk: name FKK, slug footballkituk, default false
```

Existing test accounts remain `site_id = NULL`.

- [ ] **Step 2: Run DB verification**

Run a Node DB query verifying `sites` contains both slugs and `site_gg` is default.

### Task 5: Local Runtime Verification

**Files:**
- No new files unless a self-check script is needed.

- [ ] **Step 1: Restart local service**

Run:

```bash
./scripts/local/stop-app.sh && ./scripts/local/start-app.sh
```

- [ ] **Step 2: Verify local paths**

Run curl checks for:

```text
/gogoalshop/login
/footballkituk/login
/gogoalshop/discover
/footballkituk/discover
/admin
```

Expected: HTTP 200 for app shell pages.

- [ ] **Step 3: Verify auth API fields**

Login as `personal@aiove.local` and confirm response contains empty `siteId/siteSlug` for unassigned account.

- [ ] **Step 4: Verify no server deployment**

Do not run `scp`, `ssh`, `systemctl`, or any server update command for this phase.
