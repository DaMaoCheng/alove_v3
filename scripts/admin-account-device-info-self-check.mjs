import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminAccounts } from "../server/admin-account-service.js";
import { listAdminGuestSessions } from "../server/admin-guest-session-service.js";
import { issueUserSession, requireAuth } from "../server/auth-session-service.js";
import { recordGuestLastAccess } from "../server/access-location-service.js";
import { describeUserAgent } from "../server/device-info-service.js";
import { createId, hashSecret } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

await assertLocalMutatingSelfCheckEnvironment({ label: "admin account device info self-check" });
await initializeDatabase();
const db = getDbPool();
const marker = Date.now().toString(36);
const userId = createId("u_device_check");
const guestId = createId("guest_device_check");
const email = `device-${marker}@example.test`;

try {
  assert.equal(describeUserAgent(IPHONE_SAFARI), "手机 · iOS · Safari");
  assert.equal(describeUserAgent(ANDROID_CHROME), "手机 · Android · Chrome");
  assert.equal(describeUserAgent(WINDOWS_EDGE), "电脑 · Windows · Edge");
  assert.equal(describeUserAgent(""), "");

  const [[site]] = await db.execute(
    `SELECT s.id AS site_id, c.id AS mascot_character_id
     FROM sites s
     INNER JOIN ai_characters c ON c.id = COALESCE((
       SELECT ms.character_id FROM mascot_settings ms
       WHERE ms.site_id = s.id AND ms.setting_status = 'active' LIMIT 1
     ), s.mascot_character_id)
     WHERE s.site_status = 'active'
     ORDER BY s.is_default DESC, s.created_at ASC
     LIMIT 1`
  );
  assert.ok(site?.site_id && site?.mascot_character_id, "an active site and mascot are required");

  await db.execute(
    `INSERT INTO users (
       id, platform_uid, locale, username, password_hash, nickname, email,
       email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, ?, 'en', ?, ?, ?, ?, NOW(3), 'device-self-check', 'personal', ?, NOW(3))`,
    [userId, email, email, hashSecret("DeviceCheck123"), "Device check", email, site.site_id]
  );
  const issuedSession = await issueUserSession({ id: userId, email, nickname: "Device check", account_type: "personal", site_id: site.site_id }, {
    db,
    access: { ip: "127.0.0.1", region: "本地", userAgent: IPHONE_SAFARI },
  });

  const beforeAuthRefresh = (await listAdminAccounts({ query: email })).items.find((item) => item.id === userId);
  assert.equal(beforeAuthRefresh?.lastLoginDevice, "手机 · iOS · Safari", "successful login should record the login device");

  await requireAuth({ headers: { "user-agent": WINDOWS_EDGE }, socket: { remoteAddress: "127.0.0.1" } }, () => issuedSession.sessionToken);
  const afterAuthRefresh = (await listAdminAccounts({ query: email })).items.find((item) => item.id === userId);
  assert.equal(afterAuthRefresh?.lastLoginDevice, "手机 · iOS · Safari", "ordinary authenticated requests must not overwrite the login device");

  await db.execute(
    `INSERT INTO guest_sessions (
       id, token_hash, site_id, mascot_character_id, session_status, expires_at
     ) VALUES (?, ?, ?, ?, 'active', DATE_ADD(NOW(3), INTERVAL 1 DAY))`,
    [guestId, `sha256:${marker.padEnd(64, "0").slice(0, 64)}`, site.site_id, site.mascot_character_id]
  );
  await recordGuestLastAccess(db, {
    guestSessionId: guestId,
    access: { ip: "127.0.0.1", region: "本地", userAgent: ANDROID_CHROME },
  });
  const guest = (await listAdminGuestSessions({ query: guestId, status: "all" })).items.find((item) => item.id === guestId);
  assert.equal(guest?.lastDevice, "手机 · Android · Chrome", "guest access should update the recent device");

  const [accountTemplate, guestTemplate] = await Promise.all([
    readFile(new URL("../src/features/admin-console/admin-console-accounts-template.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-guest-sessions-template.js", import.meta.url), "utf8"),
  ]);
  assert.match(accountTemplate, /最后登录设备/);
  assert.match(guestTemplate, /最近访问设备/);
  console.log("admin account device info self-check passed");
} finally {
  await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guestId]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  await closeDbPool();
}
