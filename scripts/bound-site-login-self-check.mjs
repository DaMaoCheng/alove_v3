import assert from "node:assert/strict";
import { getDbPool, closeDbPool } from "../server/db.js";
import { loginUser } from "../server/auth-service.js";
import { hashSecret } from "../server/security.js";
import { pathForSiteView } from "../src/app/site-routing.js";

const db = getDbPool();
const PASSWORD = "BoundSite123";
const BOUND_ID = "u_bound_site_login_check";
const UNBOUND_ID = "u_unbound_site_login_check";
const BOUND_EMAIL = "bound-site-login@example.local";
const UNBOUND_EMAIL = "unbound-site-login@example.local";

try {
  await cleanup();
  await seedUser({ id: BOUND_ID, email: BOUND_EMAIL, siteId: "site_fkk" });
  await seedUser({ id: UNBOUND_ID, email: UNBOUND_EMAIL, siteId: null });

  const bound = await loginUser({ email: BOUND_EMAIL, password: PASSWORD });
  assert.equal(bound.user.siteId, "site_fkk", "bound user login should return assigned site id");
  assert.equal(bound.user.siteSlug, "footballkituk", "bound user login should return assigned site slug");
  assert.equal(pathForSiteView(bound.user.siteSlug, "discover"), "/footballkituk/discover", "bound user should be routed to assigned site path");

  const unbound = await loginUser({ email: UNBOUND_EMAIL, password: PASSWORD });
  assert.equal(unbound.user.siteId || "", "", "unbound user login should not receive a forced site id");
  assert.equal(unbound.user.siteSlug || "", "", "unbound user login should not receive a forced site slug");

  console.log("bound site login self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seedUser({ id, email, siteId }) {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Bound Site Check', ?, NOW(3), 'email', 'personal', ?, NOW(3))`,
    [id, email, email, hashSecret(PASSWORD), email, siteId]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [id]);
}

async function cleanup() {
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid IN (?, ?)", [BOUND_ID, UNBOUND_ID]);
  await db.execute("DELETE FROM users WHERE id IN (?, ?)", [BOUND_ID, UNBOUND_ID]);
}
