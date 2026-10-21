import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminAccounts, updateAdminAccountSite } from "../server/admin-account-service.js";
import { createId, hashSecret } from "../server/security.js";

const email = `site-self-check-${Date.now()}@example.test`;
const userId = createId("u");

await initializeDatabase();
const db = getDbPool();

try {
  const [[site]] = await db.execute("SELECT id, name FROM sites ORDER BY is_default DESC, created_at ASC LIMIT 1");
  assert.ok(site?.id, "self-check requires at least one site");

  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Site Self Check', ?, NOW(3), 'admin-self-check', 'personal', NULL, NOW(3))`,
    [userId, email, email, hashSecret("AdminSite123"), email]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [userId]);

  const unassigned = await listAdminAccounts({ query: email, site: "unassigned" });
  assert.equal(unassigned.items.some((item) => item.id === userId), true, "new account should be listed as unassigned");

  const updated = await updateAdminAccountSite([userId], site.id);
  assert.equal(updated.ok, true, "site update should succeed");
  assert.equal(updated.updatedCount, 1, "one account should be updated");

  const assigned = await listAdminAccounts({ query: email, site: site.id });
  const account = assigned.items.find((item) => item.id === userId);
  assert.ok(account, "updated account should be listed by real site filter");
  assert.equal(account.siteId, site.id, "mapped account site id should match");
  assert.equal(account.siteName, site.name, "mapped account site name should match");

  const noLongerUnassigned = await listAdminAccounts({ query: email, site: "unassigned" });
  assert.equal(noLongerUnassigned.items.some((item) => item.id === userId), false, "assigned account should not remain unassigned");

  console.log("admin account site self-check passed");
} finally {
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  await closeDbPool();
}
