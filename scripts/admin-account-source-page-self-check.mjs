import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminAccounts } from "../server/admin-account-service.js";
import { mapAdminSourcePage } from "../server/admin-account-mapper.js";
import { listAdminGuestSessions } from "../server/admin-guest-session-service.js";
import { createId, hashSecret } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "admin account source page self-check" });
await initializeDatabase();
const db = getDbPool();
const marker = randomUUID().replaceAll("-", "").slice(0, 16);
const email = `admin-source-${marker}@example.test`;
const userId = createId("u_admin_source");
const guestId = createId("guest_admin_source");
const olderGuestId = createId("guest_admin_source");
const chatSessionId = createId("chat_admin_source");
const olderChatSessionId = createId("chat_admin_source");
const sourceContext = {
  verified: true,
  siteId: "",
  siteSlug: "",
  mascotCharacterId: "",
  sourceOrigin: "https://shop.example.test",
  sourcePageUrl: "https://shop.example.test/productdetail/Runtime-Shirt/623621",
  sourcePageTitle: "Runtime Shirt",
  sourcePageType: "product",
  sourceProductId: "623621",
  capturedAt: new Date().toISOString(),
};

try {
  const [[site]] = await db.execute(
    `SELECT s.id AS site_id, s.slug AS site_slug, c.id AS mascot_character_id
     FROM sites s
     INNER JOIN ai_characters c ON c.id = COALESCE((
       SELECT ms.character_id FROM mascot_settings ms
       WHERE ms.site_id = s.id AND ms.setting_status = 'active' LIMIT 1
     ), s.mascot_character_id)
     WHERE s.site_status = 'active'
       AND s.guest_chat_enabled = 1
       AND c.visibility = 'public'
       AND c.character_status = 'published'
     ORDER BY s.is_default DESC, s.created_at ASC
     LIMIT 1`
  );
  assert.ok(site?.site_id && site?.site_slug && site?.mascot_character_id, "an active guest site is required");
  sourceContext.siteId = site.site_id;
  sourceContext.siteSlug = site.site_slug;
  sourceContext.mascotCharacterId = site.mascot_character_id;

  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, 'Admin source page check', ?, NOW(3), 'admin-source-page-self-check', 'personal', ?, NOW(3))`,
    [userId, email, email, hashSecret("AdminSource123"), email, site.site_id]
  );
  await db.execute(
    `INSERT INTO guest_sessions (
       id, token_hash, site_id, mascot_character_id, chat_session_id,
       session_status, claimed_user_id, claimed_at, external_source_context_json,
       expires_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'claimed', ?, DATE_SUB(NOW(3), INTERVAL 1 DAY), ?, DATE_ADD(NOW(3), INTERVAL 1 DAY), DATE_SUB(NOW(3), INTERVAL 1 DAY), NOW(3))`,
    [
      olderGuestId,
      `sha256:${`older${marker}`.padEnd(64, "0").slice(0, 64)}`,
      site.site_id,
      site.mascot_character_id,
      olderChatSessionId,
      userId,
      JSON.stringify(sourceContext),
    ]
  );
  await db.execute(
    `INSERT INTO guest_sessions (
       id, token_hash, site_id, mascot_character_id, chat_session_id,
       session_status, claimed_user_id, claimed_at, external_source_context_json,
       expires_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'claimed', ?, NOW(3), ?, DATE_ADD(NOW(3), INTERVAL 1 DAY), NOW(3), DATE_SUB(NOW(3), INTERVAL 2 HOUR))`,
    [guestId, `sha256:${marker.padEnd(64, "0")}`, site.site_id, site.mascot_character_id, chatSessionId, userId, JSON.stringify(sourceContext)]
  );

  const accountResult = await listAdminAccounts({ query: email, page: 1, limit: 10 });
  const account = accountResult.items.find((item) => item.id === userId);
  assert.ok(account, "fixture account should be listed");
  assert.equal(account.sourcePageUrl, sourceContext.sourcePageUrl, "formal account should expose latest claimed guest source URL");
  assert.equal(account.sourcePageTitle, sourceContext.sourcePageTitle, "formal account should expose source title");
  assert.equal(account.sourceProductId, sourceContext.sourceProductId, "formal account should expose verified source product id");
  assert.equal(accountResult.items.filter((item) => item.id === userId).length, 1, "multiple claimed guest sources must not duplicate an account row");

  const guestResult = await listAdminGuestSessions({ query: guestId, status: "all", page: 1, limit: 10 });
  const guest = guestResult.items.find((item) => item.id === guestId);
  assert.ok(guest, "fixture guest should be listed");
  assert.equal(guest.sourcePageUrl, sourceContext.sourcePageUrl, "guest should expose source URL");
  assert.equal(guest.sourcePageTitle, sourceContext.sourcePageTitle, "guest should expose source title");
  assert.equal(guest.sourceProductId, sourceContext.sourceProductId, "guest should expose verified source product id");
  assert.equal(mapAdminSourcePage("{malformed").sourcePageUrl, "", "malformed source JSON should map to an empty source page");
  assert.equal(mapAdminSourcePage(JSON.stringify({ ...sourceContext, verified: false })).sourcePageUrl, "", "unverified source JSON should map to an empty source page");

  const [accountTemplate, guestTemplate] = await Promise.all([
    readFile(new URL("../src/features/admin-console/admin-console-accounts-template.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-guest-sessions-template.js", import.meta.url), "utf8"),
  ]);
  assert.match(accountTemplate, /\["来源页面"/);
  assert.match(guestTemplate, /\["来源页面"/);
  assert.match(accountTemplate, /formatSourcePage/);
  assert.match(guestTemplate, /formatSourcePage/);
  assert.doesNotMatch(accountTemplate, /external_source_context_json/);
  assert.doesNotMatch(guestTemplate, /external_source_context_json/);
  console.log("admin account source page self-check passed");
} finally {
  await db.execute("DELETE FROM guest_sessions WHERE id IN (?, ?)", [guestId, olderGuestId]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  await closeDbPool();
}
