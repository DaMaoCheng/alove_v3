import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { SERVER_CONFIG } from "../server/config.js";
import { createId, hashSecret } from "../server/security.js";
import { STALE_MASCOT_NOTICE_TEXT } from "../server/mascot-site-guard-service.js";

const BASE_URL = "http://127.0.0.1:4173";
const DB_CONFIG = SERVER_CONFIG.db;
const ADMIN_EMAIL = "admin@aiove.local";
const ADMIN_PASSWORD = process.env.ALOVE_TEST_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("Set ALOVE_TEST_ADMIN_PASSWORD to run this local self-check.");
const TEMP_PASSWORD = "MascotHttp123";
const TEMP_EMAIL = `mascot-http-self-check-${Date.now()}@example.test`;
const tempUserId = createId("u");

const db = await mysql.createConnection(DB_CONFIG);

try {
  await seedTempUser();

  const adminSession = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const userSession = await login(TEMP_EMAIL, TEMP_PASSWORD);

  await patchUserSite(adminSession.cookie, tempUserId, "site_gg");
  await assertActivationState({
    userId: tempUserId,
    expectedActiveId: "mascot_template",
    expectedInactiveId: "mascot_c938b082-d466-4c35-a4b2-0389e2d90e46",
  });

  await patchUserSite(adminSession.cookie, tempUserId, "site_fkk");
  await assertActivationState({
    userId: tempUserId,
    expectedActiveId: "mascot_c938b082-d466-4c35-a4b2-0389e2d90e46",
    expectedInactiveId: "mascot_template",
  });

  const messageResult = await requestJson(`/api/characters/${encodeURIComponent("mascot_template")}/messages`, {
    method: "POST",
    cookie: userSession.cookie,
    body: { text: "hello old mascot" },
  });
  const userMessage = messageResult.items.find((item) => item.senderType === "user");
  assert.ok(userMessage?.id, "user message should be created through HTTP route");

  const replyResult = await requestJson(`/api/characters/${encodeURIComponent("mascot_template")}/messages/reply`, {
    method: "POST",
    cookie: userSession.cookie,
    body: { sinceMessageId: userMessage.id },
  });
  const staleReply = replyResult.items.find((item) => item.senderType === "character");
  assert.ok(staleReply, "stale mascot should return a character-side notice through HTTP route");
  assert.equal(staleReply.text, STALE_MASCOT_NOTICE_TEXT, "stale mascot notice text should match");

  const [[storedNotice]] = await db.execute(
    `SELECT text_content
     FROM chat_messages
     WHERE session_id = ? AND sender_type = 'character'
     ORDER BY display_order DESC, created_at DESC
     LIMIT 1`,
    [replyResult.session.id]
  );
  assert.equal(storedNotice?.text_content, STALE_MASCOT_NOTICE_TEXT, "notice should be stored in chat history");

  console.log("mascot site guard HTTP self-check passed");
} finally {
  await cleanup();
  await db.end();
}

async function seedTempUser() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, 'Mascot HTTP Check', ?, NOW(3), 'self-check', 'personal', NULL, NOW(3))`,
    [tempUserId, TEMP_EMAIL, TEMP_EMAIL, hashSecret(TEMP_PASSWORD), TEMP_EMAIL]
  );
  await db.execute(
    "INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')",
    [tempUserId]
  );
}

async function login(email, password) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `login should succeed for ${email}`);
  const cookie = extractCookie(response);
  assert.ok(cookie, `auth cookie should be returned for ${email}`);
  assert.equal(payload.ok, true, `login payload should be ok for ${email}`);
  return { cookie, payload };
}

async function patchUserSite(cookie, userId, siteId) {
  const result = await requestJson("/api/admin/accounts/site", {
    method: "PATCH",
    cookie,
    body: {
      accountIds: [userId],
      siteId,
    },
  });
  assert.equal(result.ok, true, `site patch should succeed for ${siteId}`);
  assert.equal(result.updatedCount, 1, "exactly one account should be updated");
}

async function assertActivationState({ userId, expectedActiveId, expectedInactiveId }) {
  const [[activeRow]] = await db.execute(
    `SELECT activation_status
     FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     ORDER BY updated_at DESC, activated_at DESC
     LIMIT 1`,
    [userId, expectedActiveId]
  );
  assert.equal(activeRow?.activation_status, "active", `${expectedActiveId} should be active`);

  const [[inactiveRow]] = await db.execute(
    `SELECT activation_status
     FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     ORDER BY updated_at DESC, activated_at DESC
     LIMIT 1`,
    [userId, expectedInactiveId]
  );
  if (inactiveRow) {
    assert.equal(inactiveRow.activation_status, "inactive", `${expectedInactiveId} should be inactive`);
  }
}

async function requestJson(path, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `${method} ${path} should return 200, got ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

function extractCookie(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const authCookie = cookies.find((item) => item.startsWith("aiove_auth_token="));
  return authCookie ? authCookie.split(";")[0] : "";
}

async function cleanup() {
  await db.execute("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE internal_uid = ?)", [tempUserId]).catch(() => {});
  await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [tempUserId]).catch(() => {});
  await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ?", [tempUserId]).catch(() => {});
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [tempUserId]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [tempUserId]).catch(() => {});
}
