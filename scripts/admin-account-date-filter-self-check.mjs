import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminAccounts } from "../server/admin-account-service.js";
import { listAdminGuestSessions } from "../server/admin-guest-session-service.js";
import { accountSiteFilterItems } from "../src/features/admin-console/admin-account-sites.js";
import { createId, hashSecret } from "../server/security.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "admin account date filter self-check" });
await initializeDatabase();
const db = getDbPool();
const marker = Date.now().toString(36);
const dayOffsets = [0, 8, 20, 31];
const accountIds = dayOffsets.map((days) => createId(`u_date_${days}`));
const guestIds = dayOffsets.map((days) => createId(`guest_date_${days}`));
const email = (days) => `admin-date-${days}-${marker}@example.test`;

try {
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

  for (const days of dayOffsets) {
    const index = dayOffsets.indexOf(days);
    await db.execute(
      `INSERT INTO users (
         id, platform_uid, locale, username, password_hash, nickname, email,
         email_verified_at, email_auth_provider, account_type, site_id, created_at, last_seen_at
       ) VALUES (?, ?, 'en', ?, ?, ?, ?, NOW(3), 'admin-date-filter-self-check', 'personal', ?,
         DATE_SUB(NOW(3), INTERVAL ? DAY), DATE_SUB(NOW(3), INTERVAL ? DAY))`,
      [accountIds[index], `date-${days}-${marker}`, `date-${days}-${marker}`, hashSecret("AdminDate123"), `Date ${days}`, email(days), site.site_id, days, days]
    );
    await db.execute(
      `INSERT INTO guest_sessions (
         id, token_hash, site_id, mascot_character_id, session_status,
         expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', DATE_ADD(NOW(3), INTERVAL 1 DAY),
         DATE_SUB(NOW(3), INTERVAL ? DAY), DATE_SUB(NOW(3), INTERVAL ? DAY))`,
      [guestIds[index], `sha256:${guestIds[index].padEnd(64, "0").slice(0, 64)}`, site.site_id, site.mascot_character_id, days, days]
    );
  }

  const listedAccountIds = (result) => result.items.filter((item) => item.email.includes(marker)).map((item) => item.email);
  const listedGuestIds = (result) => result.items.filter((item) => guestIds.includes(item.id)).map((item) => item.id);
  assert.equal(listedAccountIds(await listAdminAccounts({ query: marker, dateRange: "today" })).length, 1);
  assert.equal(listedAccountIds(await listAdminAccounts({ query: marker, dateRange: "7d" })).length, 1);
  assert.equal(listedAccountIds(await listAdminAccounts({ query: marker, dateRange: "30d" })).length, 3);
  assert.equal(listedAccountIds(await listAdminAccounts({ query: marker, dateRange: "custom", startDate: dateDaysAgo(20), endDate: dateDaysAgo(8) })).length, 2);
  assert.equal(listedAccountIds(await listAdminAccounts({ query: marker, dateRange: "custom", startDate: dateDaysAgo(8), endDate: dateDaysAgo(20) })).length, 4, "invalid reversed range should safely fall back to all");

  const guestFilter = (dateRange, extra = {}) => listAdminGuestSessions({ site: site.site_id, limit: 50, dateRange, ...extra });
  assert.equal(listedGuestIds(await guestFilter("today")).length, 1);
  assert.equal(listedGuestIds(await guestFilter("7d")).length, 1);
  assert.equal(listedGuestIds(await guestFilter("30d")).length, 3);
  assert.equal(listedGuestIds(await guestFilter("custom", { startDate: dateDaysAgo(20), endDate: dateDaysAgo(8) })).length, 2);

  const accountSiteCounts = await listAdminAccounts({ query: marker, page: 1, limit: 10 });
  assert.ok(Array.isArray(accountSiteCounts.siteCounts), "account response should expose site session counts");
  assert.ok(accountSiteCounts.siteCounts.some((item) => item.siteId === "all" && Number.isFinite(item.active) && Number.isFinite(item.total)), "account site counts should expose active/total values");
  const guestSiteCounts = await listAdminGuestSessions({ query: marker, page: 1, limit: 10 });
  assert.ok(Array.isArray(guestSiteCounts.siteCounts), "guest response should expose site session counts");
  assert.ok(guestSiteCounts.siteCounts.some((item) => item.siteId === "all" && Number.isFinite(item.active) && Number.isFinite(item.total)), "guest site counts should expose active/total values");

  const [accountTemplate, guestTemplate, filterSource, guestController, dropdownSource] = await Promise.all([
    readFile(new URL("../src/features/admin-console/admin-console-accounts-template.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-guest-sessions-template.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-date-range-filter.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/admin-console/admin-guest-sessions-controller.js", import.meta.url), "utf8"),
    readFile(new URL("../src/features/shared-ui/dropdown.js", import.meta.url), "utf8"),
  ]);
  for (const source of [accountTemplate, guestTemplate]) assert.match(source, /adminDateRangeFilterHtml/);
  assert.match(accountTemplate, /siteCounts/);
  assert.match(guestTemplate, /siteCounts/);
  assert.match(dropdownSource, /dd-count/);
  const emptySiteCounts = accountSiteFilterItems([{ id: "site_empty", name: "空站点" }], []);
  assert.ok(emptySiteCounts.every(([, , , count]) => count && count.active === 0 && count.total === 0), "site options should keep a visible 0/0 count before or without API data");
  assert.match(filterSource, /自定义时间/);
  assert.match(filterSource, /data-admin-date-apply/);
  assert.match(filterSource, /data-admin-date-start value=.*max=/s);
  assert.match(filterSource, /data-admin-date-end value=.*min=/s);
  assert.match(filterSource, /startField\.max = endField\.value/);
  assert.match(filterSource, /endField\.min = startField\.value/);
  assert.match(guestController, /const sharedDateState = \(\) =>/);
  assert.match(guestController, /adminGuestSessionsHtml\(\{ \.\.\.guestSessionPageState, \.\.\.sharedDateState\(\) \}\)/);
  assert.doesNotMatch(guestController, /adminGuestSessionsHtml\(\{ \.\.\.guestSessionPageState, \.\.\.dateState \}\)/);
  console.log(`admin account date filter self-check passed`);
} finally {
  const guestPlaceholders = guestIds.map(() => "?").join(",");
  const accountPlaceholders = accountIds.map(() => "?").join(",");
  await db.execute(`DELETE FROM guest_sessions WHERE id IN (${guestPlaceholders})`, guestIds).catch(() => {});
  await db.execute(`DELETE FROM users WHERE id IN (${accountPlaceholders})`, accountIds).catch(() => {});
  await closeDbPool();
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - Number(days || 0));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
