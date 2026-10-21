import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { listAdminFeedback, updateAdminFeedbackStatus } from "../server/admin-feedback-service.js";
import { SERVER_CONFIG } from "../server/config.js";
import { ADMIN_SCOPES, requireAdmin } from "../server/route-utils.js";
import { createId, createToken, hashSecret, hashSessionToken } from "../server/security.js";

const ADMIN_ID = "u_admin_feedback_self_check";
const USER_ID = "u_feedback_list_self_check";
const ADMIN_EMAIL = "admin-feedback-self-check@example.local";
const USER_EMAIL = "feedback-list-self-check@example.local";
const SUPER_ADMIN_ID = "u_admin_feedback_super_self_check";
const SUPER_ADMIN_EMAIL = SERVER_CONFIG.security.superAdminEmails[0] || "admin@aiove.local";
const GUEST_SESSION_ID = "guest_feedback_list_self_check";

await initializeDatabase();
const db = getDbPool();
let superAdminRestore = null;

try {
  const feedbackTemplate = await readFile(new URL("../src/features/admin-console/admin-feedback-template.js", import.meta.url), "utf8");
  assert.match(feedbackTemplate, /accountSiteLabel\(item\)/, "feedback table should reuse account site label");
  assert.match(feedbackTemplate, /class="pill site"/, "feedback table should reuse account site pill styling");
  assert.match(feedbackTemplate, /\[\"账号\", feedbackAccountLabel\(item\)\]/, "feedback detail should show account");
  assert.match(feedbackTemplate, /\[\"反馈内容\", \[\s*\[\"账号\", feedbackAccountLabel\(item\)\],\s*\[\"内容\", item\.content/, "feedback detail should group account with content");
  assert.match(feedbackTemplate, /\[\"IP\", formatFeedbackIp\(item\)\]/, "feedback detail should show formatted IP and region");
  assert.match(feedbackTemplate, /data-feedback-guest/, "feedback detail should expose guest locator");
  assert.match(feedbackTemplate, /data-feedback-account=.*定位会话/, "account feedback locator should use session wording");
  assert.match(feedbackTemplate, /data-feedback-guest=.*定位会话/, "guest feedback locator should use session wording");
  assert.match(feedbackTemplate, /guestSessionExists/, "feedback detail should distinguish cleaned guest sessions");
  assert.match(feedbackTemplate, /会话已清理/, "cleaned guest sessions should disable the locator");
  const feedbackController = await readFile(new URL("../src/features/admin-console/admin-feedback-controller.js", import.meta.url), "utf8");
  assert.match(feedbackController, /onOpenGuestSession/, "feedback controller should bind guest locator");
  await cleanup();
  const adminToken = createToken();
  const userToken = createToken();
  const superAdminToken = createToken();
  superAdminRestore = await ensureSuperAdminSession(superAdminToken);
  await insertUser({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    accountType: "admin",
    token: adminToken,
  });
  await insertUser({
    id: USER_ID,
    email: USER_EMAIL,
    accountType: "personal",
    token: userToken,
  });

  const newestFeedbackId = createId("ufb");
  const olderFeedbackId = createId("ufb");
  await insertFeedback({
    id: olderFeedbackId,
    subject: "Older feedback",
    content: "This older row verifies sort order.",
    pagePath: "/footballkituk/discover?older=1",
    createdSql: "DATE_ADD(NOW(3), INTERVAL 9 SECOND)",
  });
  await insertFeedback({
    id: newestFeedbackId,
    subject: "Newest feedback",
    content: "This newest row should be listed first.",
    pagePath: "/footballkituk/discover?newest=1",
    clientIp: "203.0.113.42",
    clientIpRegion: "测试地区",
    createdSql: "DATE_ADD(NOW(3), INTERVAL 10 SECOND)",
  });
  await insertGuestFeedback();

  const allResult = await listAdminFeedback({ page: 1, limit: 1, status: "all" });
  assert.equal(allResult.ok, true, "admin feedback list should return ok");
  assert.equal(allResult.items.length, 1, "limit should apply");
  assert.ok(allResult.total >= 2, "total should include both feedback rows");
  assert.equal(allResult.pages, allResult.total, "pages should respect limit");
  assert.equal(allResult.items[0].id, newestFeedbackId, "newest feedback should sort first");
  assert.equal(allResult.items[0].userEmail, USER_EMAIL, "feedback should map user email");
  assert.equal(allResult.items[0].userName, "Feedback User Check", "feedback should map user name");
  assert.equal(allResult.items[0].accountType, "personal", "feedback should map account type");
  assert.equal(allResult.items[0].siteSlug, "footballkituk", "feedback should map site slug");
  assert.equal(allResult.items[0].clientIp, "203.0.113.42", "feedback should map client IP");
  assert.equal(allResult.items[0].clientIpRegion, "测试地区", "feedback should map client IP region");
  assert.equal(allResult.items[0].status, "new", "feedback should map status");
  assert.equal(allResult.items[0].pagePath, "/footballkituk/discover?newest=1", "feedback should map page path");
  assert.equal(allResult.items[0].userAgent, "admin-feedback-list-self-check", "feedback should map user agent");
  const guestResult = await listAdminFeedback({ page: 1, limit: 20, query: "Guest feedback locator" });
  assert.equal(guestResult.items[0]?.guestSessionId, GUEST_SESSION_ID, "feedback should map guest session id");
  assert.equal(guestResult.items[0]?.guestSessionExists, false, "cleaned or missing guest session should be marked unavailable");

  const newResult = await listAdminFeedback({ page: 1, limit: 20, status: "new" });
  assert.ok(newResult.total >= 2, "new status filter should include new rows");
  assert.ok(newResult.items.some((item) => item.id === newestFeedbackId), "new status filter should include newest self-check row");
  assert.ok(newResult.items.every((item) => item.status === "new"), "new status filter should only return new rows");
  assert.ok(Number(newResult.total) >= 2, "admin feedback indicator must receive the total number of unresolved feedback records");

  const queryResult = await listAdminFeedback({ page: 1, limit: 20, query: "Newest feedback" });
  assert.ok(queryResult.items.some((item) => item.id === newestFeedbackId), "query filter should match feedback subject");

  const nameQueryResult = await listAdminFeedback({ page: 1, limit: 20, query: "Feedback User Check" });
  assert.ok(nameQueryResult.items.some((item) => item.id === newestFeedbackId), "query filter should match feedback user name");

  const contentQueryResult = await listAdminFeedback({ page: 1, limit: 20, query: "listed first" });
  assert.ok(contentQueryResult.items.some((item) => item.id === newestFeedbackId), "query filter should match feedback content");

  const siteResult = await listAdminFeedback({ page: 1, limit: 20, site: "site_fkk" });
  assert.ok(siteResult.items.some((item) => item.id === newestFeedbackId), "site filter should match feedback site id");

  const doneResult = await updateAdminFeedbackStatus(newestFeedbackId, { status: "done" });
  assert.equal(doneResult.ok, true, "feedback status update should return ok");
  assert.equal(doneResult.item.id, newestFeedbackId, "feedback status update should return updated item");
  assert.equal(doneResult.item.status, "done", "feedback status should become done");

  const afterDoneAllResult = await listAdminFeedback({ page: 1, limit: 20, status: "all" });
  assert.ok(afterDoneAllResult.items.some((item) => item.id === newestFeedbackId && item.status === "done"), "all filter should include done feedback");

  const afterDoneNewResult = await listAdminFeedback({ page: 1, limit: 20, status: "new" });
  assert.ok(!afterDoneNewResult.items.some((item) => item.id === newestFeedbackId), "new filter should not include done feedback");

  await assert.rejects(
    () => updateAdminFeedbackStatus(olderFeedbackId, { status: "reviewed" }),
    (error) => error?.statusCode === 400 && /反馈状态不支持/.test(error.message),
    "unsupported feedback status should be rejected"
  );

  const admin = await requireAdmin(fakeRequest(adminToken));
  assert.equal(admin.id, ADMIN_ID, "admin token should pass requireAdmin");

  await assert.rejects(
    () => requireAdmin(fakeRequest(adminToken), ADMIN_SCOPES.FEEDBACK_WRITE),
    /当前管理员没有执行该操作的权限/,
    "admin without feedback write scope should not mark feedback done"
  );
  await assert.rejects(
    () => requireAdmin(fakeRequest(userToken), ADMIN_SCOPES.FEEDBACK_WRITE),
    /无权访问管理后台/,
    "personal user should not mark feedback done"
  );
  await assert.rejects(
    () => requireAdmin(fakeRequest(""), ADMIN_SCOPES.FEEDBACK_WRITE),
    /Please sign in first/,
    "missing token should not mark feedback done"
  );

  const superAdmin = await requireAdmin(fakeRequest(superAdminToken), ADMIN_SCOPES.FEEDBACK_WRITE);
  assert.equal(superAdmin.email, SUPER_ADMIN_EMAIL, "super admin should pass feedback write scope");
  const authorizedDoneResult = await updateAdminFeedbackStatus(olderFeedbackId, { status: "done" });
  assert.equal(authorizedDoneResult.item.status, "done", "feedback write admin should mark feedback done");

  console.log("admin feedback list self-check passed");
} finally {
  if (typeof superAdminRestore === "function") await superAdminRestore();
  await cleanup();
  await closeDbPool();
}

async function insertUser({ id, email, accountType, token }) {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, auth_token, token_expires_at, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, ?, ?, NOW(3), 'email', ?, 'site_fkk',
       'active', ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR), NOW(3))`,
    [
      id,
      email,
      email,
      hashSecret("FeedbackAdmin1234"),
      accountType === "admin" ? "Feedback Admin Check" : "Feedback User Check",
      email,
      accountType,
      hashSessionToken(token),
    ]
  );
}

async function insertFeedback({ id, subject, content, pagePath, clientIp = "203.0.113.41", clientIpRegion = "测试地区", createdSql }) {
  await db.execute(
    `INSERT INTO user_feedback (
       id, internal_uid, user_email, account_type, site_id, site_slug, client_ip, client_ip_region,
       subject, content, page_path, user_agent, feedback_status,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'personal', 'site_fkk', 'footballkituk', ?, ?, ?, ?, ?, 'admin-feedback-list-self-check', 'new',
       ${createdSql}, ${createdSql})`,
    [id, USER_ID, USER_EMAIL, clientIp, clientIpRegion, subject, content, pagePath]
  );
}

async function insertGuestFeedback() {
  await db.execute(
    `INSERT INTO user_feedback (
       id, internal_uid, guest_session_id, user_email, account_type, site_id, site_slug,
       subject, content, page_path, user_agent, feedback_status
     ) VALUES (?, NULL, ?, NULL, 'guest', 'site_fkk', 'footballkituk', ?, ?, '/footballkituk', 'admin-feedback-list-self-check', 'new')`,
    ["ufb_guest_feedback_list_self_check", GUEST_SESSION_ID, "Guest feedback locator", "Guest feedback locator content"]
  );
}

async function ensureSuperAdminSession(token) {
  const [[existing]] = await db.execute(
    "SELECT id, account_type, auth_token, token_expires_at FROM users WHERE email = ? LIMIT 1",
    [SUPER_ADMIN_EMAIL]
  );
  const tokenHash = hashSessionToken(token);
  if (existing?.id) {
    await db.execute(
      "UPDATE users SET account_type = 'admin', auth_token = ?, token_expires_at = DATE_ADD(NOW(3), INTERVAL 1 HOUR), account_status = 'active' WHERE id = ?",
      [tokenHash, existing.id]
    );
    return async () => {
      await db.execute(
        "UPDATE users SET account_type = ?, auth_token = ?, token_expires_at = ? WHERE id = ?",
        [existing.account_type, existing.auth_token, existing.token_expires_at, existing.id]
      ).catch(() => {});
    };
  }

  await insertUser({
    id: SUPER_ADMIN_ID,
    email: SUPER_ADMIN_EMAIL,
    accountType: "admin",
    token,
  });
  return async () => {
    await db.execute("DELETE FROM users WHERE id = ?", [SUPER_ADMIN_ID]).catch(() => {});
  };
}

function fakeRequest(token) {
  return {
    headers: {
      cookie: token ? `aiove_auth_token=${encodeURIComponent(token)}` : "",
    },
  };
}

async function cleanup() {
  await db.execute("DELETE FROM user_feedback WHERE id = ? OR internal_uid IN (?, ?) OR user_email IN (?, ?)", [
    "ufb_guest_feedback_list_self_check",
    ADMIN_ID,
    USER_ID,
    ADMIN_EMAIL,
    USER_EMAIL,
  ]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id IN (?, ?) OR email IN (?, ?)", [
    ADMIN_ID,
    USER_ID,
    ADMIN_EMAIL,
    USER_EMAIL,
  ]).catch(() => {});
}
