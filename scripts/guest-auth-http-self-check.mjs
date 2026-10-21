import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool } from "../server/db.js";
import { createToken, hashSecret, hashSessionToken } from "../server/security.js";
import { GUEST_COOKIE_NAME } from "../server/guest-chat-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

const BASE_URL = "http://127.0.0.1:4173";
await assertLocalMutatingSelfCheckEnvironment({ label: "guest auth HTTP self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const password = "GuestHttp123";
const guestIds = [];
const userIds = [];
const emails = [];

try {
  const [[fkk]] = await db.execute(
    `SELECT s.id, s.slug, COALESCE(ms.character_id, s.mascot_character_id) AS character_id
     FROM sites s
     LEFT JOIN mascot_settings ms ON ms.site_id = s.id AND ms.setting_status = 'active'
     WHERE s.slug = 'footballkituk'
     LIMIT 1`
  );
  const [[gg]] = await db.execute(
    "SELECT id, slug FROM sites WHERE id <> ? AND site_status = 'active' ORDER BY is_default DESC LIMIT 1",
    [fkk.id]
  );
  assert.ok(fkk?.character_id && gg?.id);

  const registerGuest = await createGuest("register", fkk);
  const registerEmail = email("register");
  await db.execute(
    `INSERT INTO email_verification_codes (email, scene, code_hash, provider, expires_at)
     VALUES (?, 'register', ?, 'self-check', DATE_ADD(NOW(3), INTERVAL 10 MINUTE))`,
    [registerEmail, hashSecret("246810")]
  );
  const registerResponse = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: authHeaders(registerGuest.token),
    body: JSON.stringify({
      email: registerEmail,
      nickname: "Guest HTTP Register",
      verificationCode: "246810",
      password,
      confirmPassword: password,
      siteSlug: fkk.slug,
      locale: "en",
    }),
  });
  const registerPayload = await registerResponse.json();
  assert.equal(registerResponse.status, 200);
  assert.equal(registerPayload.guestClaim?.status, "claimed");
  assert.equal("guestSessionId" in registerPayload.guestClaim, false);
  assert.equal("targetSessionId" in registerPayload.guestClaim, false);
  assert.equal("clearGuestCookie" in registerPayload.guestClaim, false);
  assertAuthAndGuestClearCookies(registerResponse);
  userIds.push(registerPayload.userId);

  const loginUser = await createUser("login", fkk.id);
  const loginGuest = await createGuest("login", fkk);
  const loginResponse = await postLogin(loginUser.email, loginGuest.token, { origin: true });
  assert.equal(loginResponse.response.status, 200);
  assert.equal(loginResponse.payload.guestClaim?.status, "claimed");
  assertAuthAndGuestClearCookies(loginResponse.response);
  const alreadyClaimedUser = await createUser("already_claimed", fkk.id);
  const alreadyClaimed = await postLogin(alreadyClaimedUser.email, loginGuest.token, { origin: true });
  assert.equal(alreadyClaimed.response.status, 200);
  assert.equal(alreadyClaimed.payload.guestClaim?.status, "already_claimed");
  assertAuthAndGuestClearCookies(alreadyClaimed.response);

  const noOriginUser = await createUser("no_origin", fkk.id);
  const noOriginGuest = await createGuest("no_origin", fkk);
  const noOrigin = await postLogin(noOriginUser.email, noOriginGuest.token, { origin: false });
  assert.equal(noOrigin.response.status, 403, "guest claim writes must require the public app origin");
  const [[noOriginState]] = await db.execute("SELECT session_status FROM guest_sessions WHERE id = ?", [noOriginGuest.guestId]);
  assert.equal(noOriginState.session_status, "active");

  const crossUser = await createUser("cross", gg.id);
  const crossGuest = await createGuest("cross", fkk);
  const cross = await postLogin(crossUser.email, crossGuest.token, { origin: true });
  assert.equal(cross.response.status, 200);
  assert.equal(cross.payload.guestClaim?.status, "site_mismatch");
  assert.ok(getSetCookies(cross.response).some((value) => value.startsWith("aiove_auth_token=")));
  assert.equal(
    getSetCookies(cross.response).some((value) => value.startsWith(`${GUEST_COOKIE_NAME}=`) && /Max-Age=0/.test(value)),
    false,
    "cross-site login must preserve the unclaimed guest cookie"
  );

  const invalidUser = await createUser("invalid", fkk.id);
  const invalid = await postLogin(invalidUser.email, createToken(), { origin: true });
  assert.equal(invalid.response.status, 200);
  assert.equal(invalid.payload.guestClaim?.status, "invalid");
  assertAuthAndGuestClearCookies(invalid.response);

  console.log("guest auth HTTP self-check passed");
} finally {
  for (const userId of userIds) {
    await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  }
  for (const guestId of guestIds) {
    const [[guest]] = await db.execute("SELECT chat_session_id, target_chat_session_id FROM guest_sessions WHERE id = ?", [guestId]).catch(() => [[null]]);
    for (const sessionId of [guest?.chat_session_id, guest?.target_chat_session_id].filter(Boolean)) {
      await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [sessionId]).catch(() => {});
      await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
    }
    await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guestId]).catch(() => {});
  }
  for (const value of emails) {
    await db.execute("DELETE FROM email_verification_codes WHERE email = ?", [value]).catch(() => {});
    await db.execute("DELETE FROM users WHERE email = ?", [value]).catch(() => {});
  }
  await closeDbPool();
}

async function createUser(label, siteId) {
  const user = { id: id(`u_${label}`), email: email(label) };
  userIds.push(user.id);
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, ?, ?, NOW(3), 'email', 'personal', ?, 'active', NOW(3))`,
    [user.id, user.email, user.email, hashSecret(password), label, user.email, siteId]
  );
  return user;
}

async function createGuest(label, site) {
  const guest = { guestId: id(`guest_${label}`), sessionId: id(`chat_${label}`), token: createToken() };
  guestIds.push(guest.guestId);
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [guest.guestId, hashSessionToken(guest.token), site.id, site.character_id, guest.sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Guest auth HTTP', 'active', 'guest', 'guest-auth-http', NOW(3))`,
    [guest.sessionId, guest.guestId, site.character_id]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guest.guestId]);
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type,
       text_content, client_message_id, display_order, delivery_status, source_type, source_ref
     ) VALUES (?, ?, NULL, 'user', 'You', 'text', 'HTTP claim history', ?, 10, 'sent', 'guest', 'guest-auth-http')`,
    [id(`msg_${label}`), guest.sessionId, `client-${guest.guestId}`.slice(0, 128)]
  );
  return guest;
}

async function postLogin(userEmail, guestToken, { origin }) {
  const headers = { "Content-Type": "application/json", Cookie: `${GUEST_COOKIE_NAME}=${encodeURIComponent(guestToken)}` };
  if (origin) headers.Origin = BASE_URL;
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify({ username: userEmail, password, remember: true }),
  });
  return { response, payload: await response.json() };
}

function authHeaders(guestToken) {
  return {
    "Content-Type": "application/json",
    Origin: BASE_URL,
    Cookie: `${GUEST_COOKIE_NAME}=${encodeURIComponent(guestToken)}`,
  };
}

function assertAuthAndGuestClearCookies(response) {
  const cookies = getSetCookies(response);
  assert.ok(cookies.some((value) => value.startsWith("aiove_auth_token=")));
  assert.ok(cookies.some((value) => value.startsWith(`${GUEST_COOKIE_NAME}=`) && /Max-Age=0/.test(value)));
}

function getSetCookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""].filter(Boolean);
}

function email(label) {
  const value = `guest-auth-http-${label}-${suffix}@example.com`;
  emails.push(value);
  return value;
}

function id(prefix) {
  return `${prefix}_${suffix}`.slice(0, 64);
}
