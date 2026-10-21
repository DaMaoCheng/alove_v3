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
const TEMP_PASSWORD = "MascotHttpVoice123";
const TEMP_EMAIL = `mascot-http-voice-self-check-${Date.now()}@example.test`;
const tempUserId = createId("u");
const OLD_MASCOT_ID = "mascot_template";
const NEW_MASCOT_ID = "mascot_c938b082-d466-4c35-a4b2-0389e2d90e46";

const db = await mysql.createConnection(DB_CONFIG);

try {
  await seedTempUser();

  const adminSession = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const userSession = await login(TEMP_EMAIL, TEMP_PASSWORD);

  await patchUserSite(adminSession.cookie, tempUserId, "site_gg");
  await assertActivationState({ userId: tempUserId, expectedActiveId: OLD_MASCOT_ID, expectedInactiveId: NEW_MASCOT_ID });
  await assertContacts(userSession.cookie, {
    expectedIds: [OLD_MASCOT_ID],
    missingIds: [NEW_MASCOT_ID],
  });

  await patchUserSite(adminSession.cookie, tempUserId, "site_fkk");
  await assertActivationState({ userId: tempUserId, expectedActiveId: NEW_MASCOT_ID, expectedInactiveId: OLD_MASCOT_ID });
  await assertContacts(userSession.cookie, {
    expectedIds: [NEW_MASCOT_ID],
    missingIds: [OLD_MASCOT_ID],
  });

  await assertTextReplyGuard(userSession.cookie);
  await assertVoiceReplyGuard(userSession.cookie);

  console.log("mascot site guard HTTP voice-contact self-check passed");
} finally {
  await cleanup();
  await db.end();
}

async function seedTempUser() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, 'Mascot HTTP Voice Check', ?, NOW(3), 'self-check', 'personal', NULL, NOW(3))`,
    [tempUserId, TEMP_EMAIL, TEMP_EMAIL, hashSecret(TEMP_PASSWORD), TEMP_EMAIL]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [tempUserId]);
}

async function login(email, password) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, `login should succeed for ${email}`);
  const cookie = extractCookie(response);
  assert.ok(cookie, `auth cookie should be returned for ${email}`);
  return { cookie, payload };
}

async function patchUserSite(cookie, userId, siteId) {
  const result = await requestJson("/api/admin/accounts/site", {
    method: "PATCH",
    cookie,
    body: { accountIds: [userId], siteId },
  });
  assert.equal(result.ok, true, `site patch should succeed for ${siteId}`);
  assert.equal(result.updatedCount, 1, "exactly one account should be updated");
  assert.ok(Array.isArray(result.mascotSyncResults), "site patch should return mascotSyncResults");
}

async function assertActivationState({ userId, expectedActiveId, expectedInactiveId }) {
  const [[activeRow]] = await db.execute(
    `SELECT activation_status FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     ORDER BY updated_at DESC, activated_at DESC LIMIT 1`,
    [userId, expectedActiveId]
  );
  assert.equal(activeRow?.activation_status, "active", `${expectedActiveId} should be active`);

  const [[inactiveRow]] = await db.execute(
    `SELECT activation_status FROM user_character_activations
     WHERE internal_uid = ? AND character_id = ?
     ORDER BY updated_at DESC, activated_at DESC LIMIT 1`,
    [userId, expectedInactiveId]
  );
  if (inactiveRow) {
    assert.equal(inactiveRow.activation_status, "inactive", `${expectedInactiveId} should be inactive`);
  }
}

async function assertContacts(cookie, { expectedIds = [], missingIds = [] } = {}) {
  const result = await requestJson("/api/chat/contacts?siteSlug=footballkituk", {
    method: "GET",
    cookie,
  });
  const ids = new Set((result.items || []).map((item) => item.characterId));
  for (const id of expectedIds) {
    assert.ok(ids.has(id), `contacts should include ${id}`);
  }
  for (const id of missingIds) {
    assert.ok(!ids.has(id), `contacts should not include ${id}`);
  }
}

async function assertTextReplyGuard(cookie) {
  const messageResult = await requestJson(`/api/characters/${encodeURIComponent(OLD_MASCOT_ID)}/messages`, {
    method: "POST",
    cookie,
    body: { text: "hello old mascot text" },
  });
  const userMessage = messageResult.items.find((item) => item.senderType === "user");
  assert.ok(userMessage?.id, "text user message should be created");

  const replyResult = await requestJson(`/api/characters/${encodeURIComponent(OLD_MASCOT_ID)}/messages/reply`, {
    method: "POST",
    cookie,
    body: { sinceMessageId: userMessage.id },
  });
  const staleReply = replyResult.items.find((item) => item.senderType === "character");
  assert.equal(staleReply?.text, STALE_MASCOT_NOTICE_TEXT, "text reply should use stale mascot notice");
}

async function assertVoiceReplyGuard(cookie) {
  const sessionId = await ensureSessionForCharacter(OLD_MASCOT_ID);
  const voiceMessageId = createId("msg");
  const nextOrder = await getNextOrder(sessionId);
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type, text_content,
       voice_asset_id, product_payload_json, display_order, delivery_status, source_type, source_ref, sent_at
     ) VALUES (?, ?, NULL, 'user', 'You', 'voice', ?, NULL, NULL, ?, 'sent', 'user', 'user-voice', NOW(3))`,
    [voiceMessageId, sessionId, "voice stale mascot", nextOrder]
  );

  const replyResult = await requestJson(`/api/characters/${encodeURIComponent(OLD_MASCOT_ID)}/voices/${encodeURIComponent(voiceMessageId)}/reply`, {
    method: "POST",
    cookie,
  });
  const staleReply = replyResult.items.find((item) => item.senderType === "character");
  assert.equal(staleReply?.text, STALE_MASCOT_NOTICE_TEXT, "voice reply should use stale mascot notice");

  const [[storedNotice]] = await db.execute(
    `SELECT text_content FROM chat_messages
     WHERE session_id = ? AND sender_type = 'character'
     ORDER BY display_order DESC, sent_at DESC LIMIT 1`,
    [replyResult.session.id]
  );
  assert.equal(storedNotice?.text_content, STALE_MASCOT_NOTICE_TEXT, "voice stale notice should be stored in chat history");
}

async function ensureSessionForCharacter(characterId) {
  const [[session]] = await db.execute(
    `SELECT id FROM chat_sessions
     WHERE internal_uid = ? AND character_id = ? AND session_status = 'active' AND source_type = 'user'
     ORDER BY last_message_at DESC, updated_at DESC LIMIT 1`,
    [tempUserId, characterId]
  );
  if (session?.id) return session.id;
  const sessionId = createId("chat");
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, character_id, session_title, session_status, source_type, source_ref, preferred_language, last_message_at
     ) VALUES (?, ?, ?, ?, 'active', 'user', 'http-self-check', NULL, NOW(3))`,
    [sessionId, tempUserId, characterId, `${characterId} conversation`]
  );
  return sessionId;
}

async function getNextOrder(sessionId) {
  const [[row]] = await db.execute(
    `SELECT COALESCE(MAX(display_order), 0) + 10 AS next_order FROM chat_messages WHERE session_id = ?`,
    [sessionId]
  );
  return Number(row?.next_order || 10);
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
