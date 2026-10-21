# Multi-Site Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first multi-site foundation for AIOVE: site identity, user site binding, creator/common/mascot character rules, mascot auto-activation, site-aware character visibility, and matching admin pages.

**Architecture:** Sites become a first-class backend entity. Users, creator characters, mascot defaults, registration routing, and public character queries all reference `site_id`. Mascots reuse `ai_characters` and `user_character_activations`; no separate mascot chat system is introduced.

**Tech Stack:** Vanilla JS frontend modules, Node.js HTTP routes/services, MySQL schema with startup migrations, existing admin console component/controller pattern.

---

## File Structure

### Backend

- Create `server/site-service.js`: list/update sites, resolve default site, resolve by slug, assign user sites.
- Create `server/site-routes.js`: admin-facing site APIs and public site lookup APIs.
- Create `server/site-context-service.js`: resolve current site from user/session/path/invite/default.
- Modify `server/db.js`: add startup migrations for `sites`, `users.site_id`, `ai_characters.character_kind`, `ai_characters.site_id`.
- Modify `database/schema.sql`: add `sites` table and new user/character columns.
- Modify `server/auth-service.js`: set `site_id` during register/login response/current user response.
- Modify `server/auth-routes.js`: pass URL/request context into register if needed.
- Modify `server/character-creation-service.js`: set character kind/site by actor role and enforce creator limit.
- Modify `server/character-public-service.js`: filter public characters by current site.
- Modify `server/character-admin-service.js`: support creator/common filtering and site assignment.
- Modify `server/character-activation-service.js`: protect mascot auto-activations if removal is later added.
- Modify `server/admin-account-*`: include account site in list/detail/edit.

### Frontend

- Create `src/services/site-service.js`: site admin APIs.
- Create `src/features/admin-console/admin-sites-controller.js`: site management controller.
- Create `src/features/admin-console/admin-console-sites-template.js`: site management UI.
- Create `src/features/admin-console/admin-creator-characters-controller.js`: creator character admin controller.
- Create `src/features/admin-console/admin-common-characters-controller.js`: common character admin controller.
- Modify `src/features/admin-console/admin-console-data.js`: add `sites`, `creatorCharacters`, `commonCharacters`, `mascot` views; replace single `agents` nav.
- Modify `src/features/admin-console/admin-console-page.js`: bind new controllers.
- Modify `src/features/admin-console/admin-console-agents-template.js`: split reusable list/editor helpers or retire in favor of creator/common templates.
- Modify `src/features/create-character/create-character-template.js`: hide Creator category unless session account type is creator/admin.
- Modify `src/features/create-character/create-character-page.js`: pass user/session/account type into template.
- Modify `src/app/app-view-factory.js`: pass session into create page.
- Modify `src/app/character-create-actions.js`: handle creator limit errors and reload site-aware lists.
- Modify `src/store/session-store.js` and `src/app/app-session-actions.js`: persist `siteId` and `siteSlug`.
- Modify `src/app/app-navigation.js`: normalize logged-in users back to their own site slug path.

### Verification Scripts

- Create `scripts/multi-site-self-check.mjs`: database/API integration check for sites, user binding, creator filtering, and mascot activation.

---

## Task 1: Database Foundation

**Files:**
- Modify: `database/schema.sql`
- Modify: `server/db.js`
- Test/Create: `scripts/multi-site-self-check.mjs`

- [ ] **Step 1: Add failing schema check script**

Create `scripts/multi-site-self-check.mjs` with an initial check that fails before schema exists:

```js
import { getDbPool, initializeDatabase } from "../server/db.js";

const db = getDbPool();

async function main() {
  await initializeDatabase();
  const [siteTables] = await db.execute(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sites'`
  );
  const [userSiteColumns] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'site_id'`
  );
  const [characterKindColumns] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_characters' AND COLUMN_NAME = 'character_kind'`
  );
  const [characterSiteColumns] = await db.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_characters' AND COLUMN_NAME = 'site_id'`
  );

  assert(siteTables.length === 1, "sites table missing");
  assert(userSiteColumns.length === 1, "users.site_id missing");
  assert(characterKindColumns.length === 1, "ai_characters.character_kind missing");
  assert(characterSiteColumns.length === 1, "ai_characters.site_id missing");
  console.log("multi-site schema ok");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().finally(() => db.end());
```

- [ ] **Step 2: Run script and verify failure**

Run:

```bash
node scripts/multi-site-self-check.mjs
```

Expected before implementation: failure mentioning missing `sites` or missing columns.

- [ ] **Step 3: Add schema and migrations**

In `database/schema.sql`, add `sites` before `users` foreign references are needed:

```sql
CREATE TABLE IF NOT EXISTS sites (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(96) NOT NULL,
  slug VARCHAR(96) NOT NULL,
  default_language VARCHAR(32) NULL,
  currency VARCHAR(16) NULL,
  default_mascot_character_id VARCHAR(64) NULL,
  product_api_url VARCHAR(512) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  site_status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_sites_slug (slug),
  KEY idx_sites_default_status (is_default, site_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Add seed sites:

```sql
INSERT INTO sites (id, name, slug, default_language, currency, is_default, site_status)
VALUES
  ('site_global', 'AIOVE Global', 'global', 'en', 'USD', 1, 'active'),
  ('site_latam', 'AIOVE Latam', 'latam', 'es', 'MXN', 0, 'active'),
  ('site_japan', 'AIOVE Japan', 'japan', 'ja', 'JPY', 0, 'active')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  default_language = VALUES(default_language),
  currency = VALUES(currency),
  site_status = VALUES(site_status),
  updated_at = CURRENT_TIMESTAMP(3);
```

Add to `users`:

```sql
site_id VARCHAR(64) NULL,
KEY idx_users_site_status (site_id, account_status),
CONSTRAINT fk_users_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
```

Add to `ai_characters`:

```sql
character_kind VARCHAR(32) NOT NULL DEFAULT 'common',
site_id VARCHAR(64) NULL,
KEY idx_ai_characters_kind_site_status (character_kind, site_id, character_status, visibility),
KEY idx_ai_characters_owner_kind (owner_uid, character_kind),
CONSTRAINT fk_ai_characters_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL
```

In `server/db.js`, add migration functions:

```js
async function addSiteColumnsIfMissing() {
  await createSitesTableIfMissing();
  await addColumnIfMissing("users", "site_id", "VARCHAR(64) NULL AFTER account_type");
  await addColumnIfMissing("ai_characters", "character_kind", "VARCHAR(32) NOT NULL DEFAULT 'common' AFTER metrics_json");
  await addColumnIfMissing("ai_characters", "site_id", "VARCHAR(64) NULL AFTER character_kind");
  await addIndexIfMissing("users", "idx_users_site_status", "CREATE INDEX idx_users_site_status ON users(site_id, account_status)");
  await addIndexIfMissing("ai_characters", "idx_ai_characters_kind_site_status", "CREATE INDEX idx_ai_characters_kind_site_status ON ai_characters(character_kind, site_id, character_status, visibility)");
  await addIndexIfMissing("ai_characters", "idx_ai_characters_owner_kind", "CREATE INDEX idx_ai_characters_owner_kind ON ai_characters(owner_uid, character_kind)");
}
```

- [ ] **Step 4: Run schema self-check**

Run:

```bash
node scripts/multi-site-self-check.mjs
```

Expected: `multi-site schema ok`.

- [ ] **Step 5: Commit**

```bash
git add database/schema.sql server/db.js scripts/multi-site-self-check.mjs
git commit -m "feat: add multi-site schema foundation"
```

---

## Task 2: Site Service And Site Context

**Files:**
- Create: `server/site-service.js`
- Create: `server/site-context-service.js`
- Create: `server/site-routes.js`
- Modify: `server/routes.js`
- Modify: `scripts/multi-site-self-check.mjs`

- [ ] **Step 1: Extend self-check for site APIs**

Append to `scripts/multi-site-self-check.mjs` after schema checks:

```js
const [sites] = await db.execute("SELECT id, name, slug, is_default FROM sites WHERE site_status = 'active' ORDER BY is_default DESC, slug ASC");
assert(sites.some((site) => site.slug === "global"), "global site seed missing");
assert(sites.filter((site) => Number(site.is_default) === 1).length === 1, "exactly one default site required");
```

- [ ] **Step 2: Create site service**

Create `server/site-service.js`:

```js
import { getDbPool } from "./db.js";
import { createId } from "./security.js";

export async function listSites() {
  const [rows] = await getDbPool().execute(
    `SELECT id, name, slug, default_language, currency, default_mascot_character_id, product_api_url, is_default, site_status, created_at, updated_at
     FROM sites
     ORDER BY is_default DESC, slug ASC`
  );
  return { ok: true, items: rows.map(mapSiteRow) };
}

export async function getDefaultSite(db = getDbPool()) {
  const [rows] = await db.execute(
    `SELECT id, name, slug, default_language, currency, default_mascot_character_id, site_status
     FROM sites
     WHERE site_status = 'active'
     ORDER BY is_default DESC, created_at ASC
     LIMIT 1`
  );
  const site = rows[0] || null;
  if (!site) throwSiteError("默认站点未配置", 500);
  return mapSiteRow(site);
}

export async function getSiteBySlug(slug, db = getDbPool()) {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  const [rows] = await db.execute(
    `SELECT id, name, slug, default_language, currency, default_mascot_character_id, site_status
     FROM sites
     WHERE slug = ? AND site_status = 'active'
     LIMIT 1`,
    [normalized]
  );
  return rows[0] ? mapSiteRow(rows[0]) : null;
}

export async function createSite(payload = {}) {
  const site = normalizeSitePayload(payload);
  const id = createId("site");
  await getDbPool().execute(
    `INSERT INTO sites (id, name, slug, default_language, currency, is_default, site_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, site.name, site.slug, site.defaultLanguage, site.currency, site.isDefault ? 1 : 0, site.status]
  );
  if (site.isDefault) await clearOtherDefaultSites(id);
  return listSites();
}

export async function updateSite(siteId, payload = {}) {
  const id = String(siteId || "").trim();
  if (!id) throwSiteError("站点不存在", 404);
  const site = normalizeSitePayload(payload);
  const [result] = await getDbPool().execute(
    `UPDATE sites
     SET name = ?, slug = ?, default_language = ?, currency = ?, default_mascot_character_id = ?, is_default = ?, site_status = ?, updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [site.name, site.slug, site.defaultLanguage, site.currency, site.defaultMascotCharacterId || null, site.isDefault ? 1 : 0, site.status, id]
  );
  if (!result.affectedRows) throwSiteError("站点不存在", 404);
  if (site.isDefault) await clearOtherDefaultSites(id);
  return listSites();
}

function normalizeSitePayload(payload) {
  const name = String(payload.name || "").trim().slice(0, 96);
  const slug = normalizeSlug(payload.slug);
  if (!name) throwSiteError("请输入站点名称", 400);
  if (!slug) throwSiteError("请输入站点路径", 400);
  return {
    name,
    slug,
    defaultLanguage: String(payload.defaultLanguage || "").trim().slice(0, 32) || null,
    currency: String(payload.currency || "").trim().slice(0, 16) || null,
    defaultMascotCharacterId: String(payload.defaultMascotCharacterId || "").trim().slice(0, 64),
    isDefault: payload.isDefault === true || payload.isDefault === "true" || payload.isDefault === 1,
    status: String(payload.status || "active").trim() === "inactive" ? "inactive" : "active",
  };
}

export function normalizeSlug(value = "") {
  return String(value || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 96);
}

function mapSiteRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    slug: row.slug || "",
    defaultLanguage: row.default_language || "",
    currency: row.currency || "",
    defaultMascotCharacterId: row.default_mascot_character_id || "",
    productApiUrl: row.product_api_url || "",
    isDefault: Number(row.is_default || 0) === 1,
    status: row.site_status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function clearOtherDefaultSites(defaultSiteId) {
  await getDbPool().execute("UPDATE sites SET is_default = 0 WHERE id <> ?", [defaultSiteId]);
}

function throwSiteError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
```

- [ ] **Step 3: Create site context service**

Create `server/site-context-service.js`:

```js
import { getDbPool } from "./db.js";
import { getDefaultSite, getSiteBySlug, normalizeSlug } from "./site-service.js";

export async function resolveSiteContext({ user = null, slug = "", inviteCode = "" } = {}, db = getDbPool()) {
  if (user?.site_id || user?.siteId) {
    const site = await getSiteById(user.site_id || user.siteId, db);
    if (site) return { ...site, source: "session" };
  }

  const inviteSite = await resolveInviteSite(inviteCode, db);
  if (inviteSite) return { ...inviteSite, source: "invite" };

  const pathSite = await getSiteBySlug(slug, db);
  if (pathSite) return { ...pathSite, source: "path" };

  const defaultSite = await getDefaultSite(db);
  return { ...defaultSite, source: "default" };
}

export function extractSiteSlugFromPath(pathname = "") {
  return normalizeSlug(String(pathname || "").split("/").filter(Boolean)[0] || "");
}

async function getSiteById(siteId, db) {
  const [rows] = await db.execute(
    `SELECT id, name, slug, default_language, currency, default_mascot_character_id, site_status
     FROM sites
     WHERE id = ? AND site_status = 'active'
     LIMIT 1`,
    [siteId]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    name: rows[0].name || "",
    slug: rows[0].slug || "",
    defaultLanguage: rows[0].default_language || "",
    currency: rows[0].currency || "",
    defaultMascotCharacterId: rows[0].default_mascot_character_id || "",
  };
}

async function resolveInviteSite(inviteCode, db) {
  const code = String(inviteCode || "").trim();
  if (!code) return null;
  const [rows] = await db.execute(
    `SELECT s.id, s.name, s.slug, s.default_language, s.currency, s.default_mascot_character_id
     FROM users u
     INNER JOIN sites s ON s.id = u.site_id
     WHERE u.referral_code = ? AND s.site_status = 'active'
     LIMIT 1`,
    [code]
  );
  return rows[0] ? {
    id: rows[0].id,
    name: rows[0].name || "",
    slug: rows[0].slug || "",
    defaultLanguage: rows[0].default_language || "",
    currency: rows[0].currency || "",
    defaultMascotCharacterId: rows[0].default_mascot_character_id || "",
  } : null;
}
```

- [ ] **Step 4: Add site routes**

Create `server/site-routes.js`:

```js
import { requireAuth } from "./auth-service.js";
import { readAuthToken, readJson, sendJson } from "./http-utils.js";
import { listSites, createSite, updateSite } from "./site-service.js";

export async function handleSiteRoute(req, res, { path }) {
  if (req.method === "GET" && path === "/api/admin/sites") {
    await requireAdmin(req);
    sendJson(res, 200, await listSites());
    return true;
  }
  if (req.method === "POST" && path === "/api/admin/sites") {
    await requireAdmin(req);
    sendJson(res, 200, await createSite(await readJson(req)));
    return true;
  }
  const match = path.match(/^\/api\/admin\/sites\/([^/]+)$/);
  if (req.method === "PATCH" && match) {
    await requireAdmin(req);
    sendJson(res, 200, await updateSite(decodeURIComponent(match[1]), await readJson(req)));
    return true;
  }
  return false;
}

async function requireAdmin(req) {
  const user = await requireAuth(req, readAuthToken);
  if (user.account_type !== "admin") {
    const error = new Error("无权访问后台");
    error.statusCode = 403;
    throw error;
  }
  return user;
}
```

Modify `server/routes.js`:

```js
import { handleSiteRoute } from "./site-routes.js";

const routeHandlers = [
  handleAuthRoute,
  handleAdminRoute,
  handleSiteRoute,
  handleProfileRoute,
  handleHomeRoute,
  handleChatRoute,
  handleCharacterRoute,
  handleBillingRoute,
];
```

- [ ] **Step 5: Run checks**

Run:

```bash
node --check server/site-service.js
node --check server/site-context-service.js
node --check server/site-routes.js
node --check server/routes.js
node scripts/multi-site-self-check.mjs
```

Expected: syntax OK and self-check passes.

- [ ] **Step 6: Commit**

```bash
git add server/site-service.js server/site-context-service.js server/site-routes.js server/routes.js scripts/multi-site-self-check.mjs
git commit -m "feat: add site service and admin routes"
```

---

## Task 3: User Site Binding And Mascot Activation

**Files:**
- Modify: `server/auth-service.js`
- Modify: `server/auth-routes.js`
- Modify: `server/character-activation-service.js`
- Modify: `server/request-user-service.js`
- Modify: `src/store/session-store.js`
- Modify: `src/app/app-session-actions.js`

- [ ] **Step 1: Extend self-check for user site and mascot activation**

Add to `scripts/multi-site-self-check.mjs`:

```js
const [[defaultSite]] = await db.execute("SELECT id FROM sites WHERE is_default = 1 LIMIT 1");
assert(defaultSite?.id, "default site missing");
```

- [ ] **Step 2: Update auth user selects**

In `server/auth-service.js`, include site columns in `requireAuth`, `getCurrentUser`, `loginUser` responses:

```js
siteId: user.site_id || "",
siteSlug: user.site_slug || "",
```

Update SQL joins:

```sql
LEFT JOIN sites site ON site.id = u.site_id
SELECT ..., u.site_id, site.slug AS site_slug
```

- [ ] **Step 3: Assign site during register**

In `registerUser`, resolve site before insert:

```js
const siteContext = await resolveSiteContext({
  slug: payload.siteSlug,
  inviteCode: payload.inviteCode,
}, db);
```

Insert:

```sql
site_id
```

Set value:

```js
siteContext.id
```

- [ ] **Step 4: Add mascot auto activation helper**

In `server/character-activation-service.js`, export:

```js
export async function activateSiteMascotForUser(db, { userId, siteId }) {
  const [[site]] = await db.execute(
    `SELECT default_mascot_character_id FROM sites WHERE id = ? LIMIT 1`,
    [siteId]
  );
  const mascotId = site?.default_mascot_character_id || await findFallbackMascotId(db);
  if (!mascotId) return null;
  const activationId = createId("act");
  await db.execute(
    `INSERT IGNORE INTO user_character_activations (
       id, internal_uid, character_id, activation_status, source_type, source_ref, activated_at, updated_at
     ) VALUES (?, ?, ?, 'active', 'mascot_auto', ?, NOW(3), NOW(3))`,
    [activationId, userId, mascotId, siteId]
  );
  return mascotId;
}

async function findFallbackMascotId(db) {
  const [[row]] = await db.execute(
    `SELECT id FROM ai_characters
     WHERE character_kind = 'mascot' AND character_status = 'published'
     ORDER BY site_id IS NULL DESC, created_at ASC
     LIMIT 1`
  );
  return row?.id || "";
}
```

- [ ] **Step 5: Call mascot activation after registration**

Inside the existing `registerUser` transaction after user/billing insert:

```js
await activateSiteMascotForUser(db, { userId, siteId: siteContext.id });
```

- [ ] **Step 6: Update frontend session store**

In `src/store/session-store.js`, persist:

```js
siteId: nextSession?.siteId || nextSession?.user?.siteId || state.siteId || "",
siteSlug: nextSession?.siteSlug || nextSession?.user?.siteSlug || state.siteSlug || "",
```

In empty state:

```js
siteId: "",
siteSlug: "",
```

In `src/app/app-session-actions.js`, sync into `appState.session`.

- [ ] **Step 7: Run checks**

```bash
node --check server/auth-service.js
node --check server/character-activation-service.js
node --check src/store/session-store.js
node --check src/app/app-session-actions.js
```

- [ ] **Step 8: Commit**

```bash
git add server/auth-service.js server/auth-routes.js server/character-activation-service.js src/store/session-store.js src/app/app-session-actions.js scripts/multi-site-self-check.mjs
git commit -m "feat: bind users to sites during auth"
```

---

## Task 4: Character Kind, Creator Limit, And Public Filtering

**Files:**
- Modify: `server/character-creation-service.js`
- Modify: `server/character-public-service.js`
- Modify: `server/character-sql.js`
- Modify: `server/character-mapper.js`
- Modify: `server/character-admin-service.js`
- Modify: `server/character-normalizers.js`
- Modify: `server/character-routes.js`

- [ ] **Step 1: Extend self-check for creator visibility**

Add database assertions after schema setup:

```js
const [kindRows] = await db.execute("SELECT character_kind, COUNT(*) AS count FROM ai_characters GROUP BY character_kind");
console.log("character kinds", kindRows);
```

- [ ] **Step 2: Include kind/site fields in SQL**

In `server/character-sql.js`, add to both selects:

```sql
c.character_kind,
c.site_id,
site.slug AS site_slug,
site.name AS site_name,
```

Add join:

```sql
LEFT JOIN sites site ON site.id = c.site_id
```

- [ ] **Step 3: Map kind/site fields**

In `server/character-mapper.js`, add:

```js
characterKind: row.character_kind || "common",
siteId: row.site_id || "",
site: {
  id: row.site_id || "",
  slug: row.site_slug || "",
  name: row.site_name || "",
},
```

- [ ] **Step 4: Set kind on create**

In `server/character-creation-service.js`:

```js
const characterKind = resolveCreatedCharacterKind(user, fields.categoryId);
const siteId = characterKind === "creator" ? user.site_id : null;
```

Rules:

```js
function resolveCreatedCharacterKind(user, categoryId) {
  const isCreatorCategory = String(categoryId || "").toLowerCase() === "creator";
  if (!isCreatorCategory) return "common";
  if (user.account_type === "admin" || user.accountType === "admin") return "creator";
  if (user.account_type === "creator" || user.accountType === "creator") return "creator";
  throwUserError("普通用户不能创建网红角色");
}
```

Before inserting creator character for creator account:

```js
if (characterKind === "creator" && user.account_type === "creator") {
  const [[existing]] = await db.execute(
    "SELECT id FROM ai_characters WHERE owner_uid = ? AND character_kind = 'creator' LIMIT 1",
    [user.id]
  );
  if (existing) throwUserError("每个创作者账号只能创建一个网红角色");
}
```

Insert `character_kind` and `site_id`.

- [ ] **Step 5: Filter public characters by site**

In `server/character-public-service.js`, accept `siteId`:

```js
export async function listPublicCharacters({ category = "", siteId = "" } = {})
```

Add condition:

```sql
AND (
  c.character_kind = 'common'
  OR (c.character_kind = 'creator' AND c.site_id = ?)
)
```

Pass `siteId` param.

- [ ] **Step 6: Wire site context in character route**

In `server/character-routes.js`, use optional user:

```js
const user = await getOptionalRequestUser(req);
const siteId = user?.site_id || "";
sendJson(res, 200, await listPublicCharacters({ category: ..., siteId }));
```

For anonymous users, resolve site by path or default in a later navigation task; first backend can default to common only if no site.

- [ ] **Step 7: Run checks**

```bash
node --check server/character-creation-service.js
node --check server/character-public-service.js
node --check server/character-sql.js
node --check server/character-mapper.js
node --check server/character-routes.js
```

- [ ] **Step 8: Commit**

```bash
git add server/character-creation-service.js server/character-public-service.js server/character-sql.js server/character-mapper.js server/character-routes.js scripts/multi-site-self-check.mjs
git commit -m "feat: enforce site-aware character kinds"
```

---

## Task 5: Create Page Category Visibility

**Files:**
- Modify: `src/app/app-view-factory.js`
- Modify: `src/features/create-character/create-character-page.js`
- Modify: `src/features/create-character/create-character-template.js`
- Modify: `src/app/app-state.js`

- [ ] **Step 1: Add template rendering check**

Create a temporary one-off command in implementation notes:

```bash
node --input-type=module -e 'import {createCharacterPageHtml} from "./src/features/create-character/create-character-template.js"; console.log(createCharacterPageHtml({createState:{}, category:"Babe", user:{accountType:"personal"}}).includes("Creator"));'
```

Expected after implementation: `false`.

- [ ] **Step 2: Pass user to create page**

In `src/app/app-view-factory.js`:

```js
return createCharacterPage({
  createState: appState.create,
  user: appState.session,
  ...
});
```

- [ ] **Step 3: Filter categories**

In `create-character-template.js`:

```js
function visibleCreateCategories(user = {}) {
  const accountType = user.accountType || "personal";
  return CREATE_CATS.filter((item) => item.key !== "Creator" || accountType === "creator" || accountType === "admin");
}
```

Use `visibleCreateCategories(user)` instead of `CREATE_CATS`.

If current category is `Creator` and user is personal, fallback to first visible category.

- [ ] **Step 4: Run checks**

```bash
node --check src/app/app-view-factory.js
node --check src/features/create-character/create-character-page.js
node --check src/features/create-character/create-character-template.js
node --input-type=module -e 'import {createCharacterPageHtml} from "./src/features/create-character/create-character-template.js"; const personal=createCharacterPageHtml({createState:{}, category:"Babe", user:{accountType:"personal"}}); const creator=createCharacterPageHtml({createState:{}, category:"Creator", user:{accountType:"creator"}}); if (personal.includes("Creator")) process.exit(1); if (!creator.includes("Creator")) process.exit(1); console.log("create category visibility ok");'
```

- [ ] **Step 5: Commit**

```bash
git add src/app/app-view-factory.js src/features/create-character/create-character-page.js src/features/create-character/create-character-template.js
git commit -m "feat: restrict creator category visibility"
```

---

## Task 6: Admin Site And Split Character Pages

**Files:**
- Create: `src/services/site-service.js`
- Create: `src/features/admin-console/admin-console-sites-template.js`
- Create: `src/features/admin-console/admin-sites-controller.js`
- Create: `src/features/admin-console/admin-console-creator-characters-template.js`
- Create: `src/features/admin-console/admin-creator-characters-controller.js`
- Create: `src/features/admin-console/admin-console-common-characters-template.js`
- Create: `src/features/admin-console/admin-common-characters-controller.js`
- Modify: `src/features/admin-console/admin-console-data.js`
- Modify: `src/features/admin-console/admin-console-content.js`
- Modify: `src/features/admin-console/admin-console-page.js`
- Modify: `src/services/character-admin-service.js`

- [ ] **Step 1: Update admin nav**

In `admin-console-data.js`, replace `agents` with:

```js
["creatorCharacters", ICONS.star, "网红角色"],
["commonCharacters", ICONS.spark, "通用角色"],
["sites", ICONS.globe, "站点管理"],
["mascot", ICONS.spark, "看板娘管理（待）"],
```

- [ ] **Step 2: Add site service frontend**

Create `src/services/site-service.js`:

```js
import { API_ENDPOINTS } from "../config/api-config.js";
import { requestJson } from "./http-client.js";

export function listAdminSites() {
  return requestJson(API_ENDPOINTS.admin.sites).then((result) => ({ ...result, items: Array.isArray(result.items) ? result.items : [] }));
}

export function updateAdminSite(siteId, payload) {
  return requestJson(`${API_ENDPOINTS.admin.sites}/${encodeURIComponent(siteId)}`, {
    method: "PATCH",
    body: payload,
  }).then((result) => ({ ...result, items: Array.isArray(result.items) ? result.items : [] }));
}
```

Add endpoint:

```js
sites: "/api/admin/sites",
```

- [ ] **Step 3: Add basic site page template/controller**

Template renders table columns:

```txt
站点 / 路径 / 默认语言 / 货币 / 默认看板娘 / 状态 / 操作
```

Controller loads `listAdminSites()` and displays rows. Editing can be read-only in the first slice if needed, but the page must show real data.

- [ ] **Step 4: Split character services by kind**

In `src/services/character-admin-service.js`, add optional kind:

```js
export function listAdminCharacters({ kind = "" } = {}) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson(`${API_ENDPOINTS.admin.characters}${suffix}`);
}
```

- [ ] **Step 5: Backend admin character list supports kind**

In `server/admin-routes.js`, pass query kind to `listAdminCharacters({ kind })`.

In `server/character-admin-service.js`, filter:

```sql
WHERE (? = '' OR c.character_kind = ?)
```

- [ ] **Step 6: Add creator/common controllers**

Creator controller calls:

```js
listAdminCharacters({ kind: "creator" })
```

Common controller calls:

```js
listAdminCharacters({ kind: "common" })
```

Creator template includes site column. Common template does not.

- [ ] **Step 7: Bind controllers in admin page**

In `admin-console-page.js`:

```js
if (activeView === "sites") bindAdminSites(shell);
if (activeView === "creatorCharacters") bindAdminCreatorCharacters(shell);
if (activeView === "commonCharacters") bindAdminCommonCharacters(shell);
```

- [ ] **Step 8: Run checks**

```bash
for file in src/features/admin-console/*.js src/services/site-service.js src/services/character-admin-service.js; do node --check "$file" || exit 1; done
node --check server/admin-routes.js
node --check server/character-admin-service.js
```

- [ ] **Step 9: Commit**

```bash
git add src/features/admin-console src/services/site-service.js src/services/character-admin-service.js src/config/api-config.js server/admin-routes.js server/character-admin-service.js
git commit -m "feat: add site admin and split character admin"
```

---

## Task 7: Account Site Assignment

**Files:**
- Modify: `server/admin-account-shared.js`
- Modify: `server/admin-account-mapper.js`
- Modify: `server/admin-account-write-service.js`
- Modify: `src/features/admin-console/admin-console-accounts-template.js`
- Modify: `src/features/admin-console/admin-account-form-modal.js`
- Modify: `src/features/admin-console/admin-accounts-controller.js`

- [ ] **Step 1: Include site in admin account SQL**

Add to `accountSelectSql()`:

```sql
u.site_id,
site.name AS site_name,
site.slug AS site_slug,
LEFT JOIN sites site ON site.id = u.site_id
```

- [ ] **Step 2: Map account site**

In mapper:

```js
siteId: row.site_id || "",
site: {
  id: row.site_id || "",
  name: row.site_name || "",
  slug: row.site_slug || "",
},
```

- [ ] **Step 3: Show site column**

Account table header adds `所属站点` after email. Rows show `account.site.name || '-'`.

- [ ] **Step 4: Allow admin edit site**

Edit profile modal includes site dropdown using `listAdminSites()` data.

Update API payload includes `siteId`.

Backend `updateAdminAccountProfile` allows `site_id` update for admin only. After update, call mascot activation helper for new site.

- [ ] **Step 5: Run checks and API test**

Use local admin token to update a test account's site and restore it.

Expected:

- Account list shows site.
- Profile update changes `users.site_id`.
- Mascot activation exists for the user after site assignment.

- [ ] **Step 6: Commit**

```bash
git add server/admin-account-* src/features/admin-console/admin-console-accounts-template.js src/features/admin-console/admin-account-form-modal.js src/features/admin-console/admin-accounts-controller.js
git commit -m "feat: add account site assignment"
```

---

## Task 8: Navigation Site Slug Guard

**Files:**
- Modify: `src/app/app-navigation.js`
- Modify: `src/app/main.js`
- Modify: `server/http-utils.js` or static fallback if server-side path handling is needed

- [ ] **Step 1: Define URL behavior**

Frontend route guard:

```js
function ensureOwnSitePath(appState) {
  const slug = appState.session.siteSlug;
  if (!appState.session.authenticated || !slug) return;
  const firstSegment = window.location.pathname.split("/").filter(Boolean)[0] || "";
  if (firstSegment && firstSegment !== slug) {
    window.history.replaceState({}, "", `/${slug}`);
  }
  if (!firstSegment) {
    window.history.replaceState({}, "", `/${slug}`);
  }
}
```

- [ ] **Step 2: Call after session hydration and login/register**

After session sync and before mount, call `ensureOwnSitePath(appState)`.

- [ ] **Step 3: Preserve app internal views**

Do not break current app view routing. Site slug is the first URL segment; app view remains internal state/path after that only if currently supported. First implementation can keep app views in state and only normalize base path.

- [ ] **Step 4: Run checks**

Manual browser check:

- Logged-in Latam user at `/japan` is replaced to `/latam`.
- Root `/` redirects/replaces to assigned site slug.
- Admin backend remains reachable.

- [ ] **Step 5: Commit**

```bash
git add src/app/app-navigation.js src/app/main.js
git commit -m "feat: guard logged-in users to assigned site path"
```

---

## Task 9: Final Verification

**Files:**
- Modify: `logs/updates/YYYY-MM-DD.md`

- [ ] **Step 1: Run full syntax checks**

```bash
for file in server/*.js; do node --check "$file" || exit 1; done
for file in src/**/*.js; do node --check "$file" || exit 1; done
```

If shell globstar is not enabled, use:

```bash
find src server -name '*.js' -print0 | xargs -0 -n1 node --check
```

- [ ] **Step 2: Run multi-site self-check**

```bash
node scripts/multi-site-self-check.mjs
```

Expected:

```txt
multi-site schema ok
```

Plus any added API assertions.

- [ ] **Step 3: Restart service**

```bash
./scripts/local/stop-app.sh && ./scripts/local/start-app.sh
```

Expected:

```txt
App is ready at http://127.0.0.1:4173
```

- [ ] **Step 4: API smoke checks**

Use local admin cookie and verify:

```bash
curl -s http://127.0.0.1:4173/api/admin/sites --cookie "aiove_auth_token=<token>"
curl -s http://127.0.0.1:4173/api/admin/characters?kind=creator --cookie "aiove_auth_token=<token>"
curl -s http://127.0.0.1:4173/api/admin/accounts?page=1\&limit=3 --cookie "aiove_auth_token=<token>"
```

Expected: each returns `ok: true`.

- [ ] **Step 5: UI smoke checks**

Open `http://127.0.0.1:4173` and verify:

- Admin nav shows site management and split character pages.
- Personal account cannot see Creator category.
- Creator account can see Creator category.
- Account list shows site column.
- Site list renders seeded sites.

- [ ] **Step 6: Update log**

Add update log section covering:

- schema changes
- service/API changes
- frontend admin changes
- create page restrictions
- verification results
- known out-of-scope items: product API, ads, real slug redirect mapping, creator migration

- [ ] **Step 7: Final diff check**

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add logs/updates/YYYY-MM-DD.md
git commit -m "docs: record multi-site foundation implementation"
```

---

## Self-Review

Spec coverage:

- User site grouping: Task 1, 2, 3, 7, 8.
- URL slug routing: Task 2 and 8.
- Creator character site filtering: Task 4 and 6.
- Ordinary users create common characters without approval: Task 4 and 5.
- Creator category hidden from ordinary users: Task 5.
- Creator one-character limit: Task 4.
- Admin exemptions: Task 4 and 6.
- Mascot as real `ai_characters` record and auto-activation: Task 3.
- Product API and ads excluded: architecture doc and out-of-scope list.

No placeholders remain for first-phase implementation. Later product API and ads are intentionally out of scope.
