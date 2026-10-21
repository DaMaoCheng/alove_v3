import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closeDbPool, getDbPool } from "../server/db.js";
import { handleAuthRoute } from "../server/auth-routes.js";
import { createToken, hashSecret, hashSessionToken } from "../server/security.js";
import { GUEST_COOKIE_NAME } from "../server/guest-chat-service.js";
import { assertLocalMutatingSelfCheckEnvironment } from "./self-check-environment-guard.mjs";

await assertLocalMutatingSelfCheckEnvironment({ label: "guest Google claim self-check" });
const db = getDbPool();
const suffix = randomUUID().replaceAll("-", "");
const createdUsers = [];
const createdGuests = [];
const cleanupEmails = new Set();
const originalFetch = globalThis.fetch;

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

  const sameSite = await createGoogleUserAndGuest("same", fkk.id, fkk);
  const sameSiteResult = await runGoogleCallback({
    guest: sameSite.guest,
    siteSlug: fkk.slug,
    providerUserId: sameSite.providerUserId,
    email: sameSite.email,
  });
  assert.equal(sameSiteResult.statusCode, 302);
  assert.match(sameSiteResult.headers.Location, new RegExp(`^/${fkk.slug}/chat\\?agent=${encodeURIComponent(fkk.character_id)}$`));
  assertCookieSet(sameSiteResult, "aiove_auth_token", false);
  assertCookieSet(sameSiteResult, GUEST_COOKIE_NAME, true);
  assertCookieSet(sameSiteResult, "aiove_google_oauth_state", true);
  assertCookieSet(sameSiteResult, "aiove_google_oauth_site", true);
  const [[sameClaim]] = await db.execute("SELECT session_status, claimed_user_id FROM guest_sessions WHERE id = ?", [sameSite.guest.guestId]);
  assert.deepEqual({ status: sameClaim.session_status, userId: sameClaim.claimed_user_id }, { status: "claimed", userId: sameSite.userId });

  const crossSite = await createGoogleUserAndGuest("cross", gg.id, fkk);
  const crossSiteResult = await runGoogleCallback({
    guest: crossSite.guest,
    siteSlug: fkk.slug,
    providerUserId: crossSite.providerUserId,
    email: crossSite.email,
  });
  assert.equal(crossSiteResult.statusCode, 302);
  assert.match(crossSiteResult.headers.Location, new RegExp(`^/${gg.slug}/(?:chat|discover).*[?&]authNotice=guest-site-mismatch`));
  assertCookieSet(crossSiteResult, "aiove_auth_token", false);
  assert.equal(hasCookie(crossSiteResult, GUEST_COOKIE_NAME), false, "cross-site Google login must preserve the guest cookie");
  const [[crossState]] = await db.execute("SELECT session_status, claimed_user_id FROM guest_sessions WHERE id = ?", [crossSite.guest.guestId]);
  assert.deepEqual({ status: crossState.session_status, userId: crossState.claimed_user_id }, { status: "active", userId: null });

  const newMismatchGuest = await createGoogleGuest("new_mismatch", fkk);
  const newMismatchEmail = `guest-google-new-mismatch-${suffix}@example.com`;
  const newMismatchProviderId = `google-new-mismatch-${suffix}`;
  cleanupEmails.add(newMismatchEmail);
  const newMismatchResult = await runGoogleCallback({
    guest: newMismatchGuest,
    siteSlug: gg.slug,
    providerUserId: newMismatchProviderId,
    email: newMismatchEmail,
  });
  assert.equal(newMismatchResult.statusCode, 409);
  assert.match(newMismatchResult.body, /Google sign-in is temporarily unavailable\. Please try again later\./i);
  assert.doesNotMatch(newMismatchResult.body, /belongs to another site/i, "public OAuth failures must not expose internal site ownership details");
  assert.equal(hasCookie(newMismatchResult, "aiove_auth_token"), false, "strict mismatch must not issue an auth cookie");
  assert.equal(hasCookie(newMismatchResult, GUEST_COOKIE_NAME), false, "strict mismatch must preserve the guest cookie");
  const [[newMismatchUserCount]] = await db.execute("SELECT COUNT(*) AS count FROM users WHERE email = ?", [newMismatchEmail]);
  const [[newMismatchOAuthCount]] = await db.execute(
    "SELECT COUNT(*) AS count FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ?",
    [newMismatchProviderId]
  );
  const [[newMismatchGuestState]] = await db.execute(
    "SELECT session_status, claimed_user_id FROM guest_sessions WHERE id = ?",
    [newMismatchGuest.guestId]
  );
  assert.deepEqual(
    {
      users: Number(newMismatchUserCount.count),
      oauth: Number(newMismatchOAuthCount.count),
      guestStatus: newMismatchGuestState.session_status,
      claimedUserId: newMismatchGuestState.claimed_user_id,
    },
    { users: 0, oauth: 0, guestStatus: "active", claimedUserId: null },
    "new Google account strict mismatch must roll back identity creation and leave the guest active"
  );

  console.log("guest Google auth claim self-check passed");
} finally {
  globalThis.fetch = originalFetch;
  for (const userId of createdUsers) {
    await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM oauth_accounts WHERE internal_uid = ?", [userId]).catch(() => {});
    await db.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
  }
  for (const guest of createdGuests) {
    const [[row]] = await db.execute("SELECT chat_session_id, target_chat_session_id FROM guest_sessions WHERE id = ?", [guest.guestId]).catch(() => [[null]]);
    for (const sessionId of [row?.chat_session_id, row?.target_chat_session_id].filter(Boolean)) {
      await db.execute("DELETE FROM memory_jobs WHERE session_id = ?", [sessionId]).catch(() => {});
      await db.execute("DELETE FROM chat_sessions WHERE id = ?", [sessionId]).catch(() => {});
    }
    await db.execute("DELETE FROM guest_image_entitlements WHERE guest_session_id = ?", [guest.guestId]).catch(() => {});
    await db.execute("DELETE FROM guest_sessions WHERE id = ?", [guest.guestId]).catch(() => {});
  }
  for (const email of cleanupEmails) {
    const [[user]] = await db.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]).catch(() => [[null]]);
    if (!user?.id) continue;
    await db.execute("DELETE FROM memory_jobs WHERE internal_uid = ?", [user.id]).catch(() => {});
    await db.execute("DELETE FROM chat_sessions WHERE internal_uid = ?", [user.id]).catch(() => {});
    await db.execute("DELETE FROM user_character_activations WHERE internal_uid = ?", [user.id]).catch(() => {});
    await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ?", [user.id]).catch(() => {});
    await db.execute("DELETE FROM oauth_accounts WHERE internal_uid = ?", [user.id]).catch(() => {});
    await db.execute("DELETE FROM users WHERE id = ?", [user.id]).catch(() => {});
  }
  await closeDbPool();
}

async function createGoogleUserAndGuest(label, userSiteId, guestSite) {
  const userId = id(`u_google_${label}`);
  const email = `guest-google-${label}-${suffix}@example.com`;
  const providerUserId = `google-${label}-${suffix}`;
  createdUsers.push(userId);
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, last_seen_at
     ) VALUES (?, 'web', ?, 'en', ?, ?, ?, ?, NOW(3), 'google', 'personal', ?, 'active', NOW(3))`,
    [userId, email, email, hashSecret(createToken()), label, email, userSiteId]
  );
  await db.execute(
    `INSERT INTO oauth_accounts (internal_uid, provider, provider_user_id, email, display_name, raw_profile_json)
     VALUES (?, 'google', ?, ?, ?, ?)`,
    [userId, providerUserId, email, label, JSON.stringify({ sub: providerUserId, email })]
  );
  const guest = await createGoogleGuest(label, guestSite);
  return { userId, email, providerUserId, guest };
}

async function createGoogleGuest(label, guestSite) {
  const guest = {
    guestId: id(`guest_google_${label}`),
    sessionId: id(`chat_google_${label}`),
    token: createToken(),
  };
  createdGuests.push(guest);
  await db.execute(
    `INSERT INTO guest_sessions (id, token_hash, site_id, mascot_character_id, chat_session_id, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL 1 HOUR))`,
    [guest.guestId, hashSessionToken(guest.token), guestSite.id, guestSite.character_id, guest.sessionId]
  );
  await db.execute(
    `INSERT INTO chat_sessions (
       id, internal_uid, guest_session_id, character_id, session_title,
       session_status, source_type, source_ref, last_message_at
     ) VALUES (?, NULL, ?, ?, 'Guest Google claim', 'active', 'guest', 'guest-google-claim', NOW(3))`,
    [guest.sessionId, guest.guestId, guestSite.character_id]
  );
  await db.execute("INSERT INTO guest_image_entitlements (guest_session_id) VALUES (?)", [guest.guestId]);
  await db.execute(
    `INSERT INTO chat_messages (
       id, session_id, character_id, sender_type, sender_label, content_type,
       text_content, client_message_id, display_order, delivery_status, source_type, source_ref
     ) VALUES (?, ?, NULL, 'user', 'You', 'text', 'Google guest history', ?, 10, 'sent', 'guest', 'guest-google-claim')`,
    [id(`msg_google_${label}`), guest.sessionId, `client-${guest.guestId}`.slice(0, 128)]
  );
  return guest;
}

async function runGoogleCallback({ guest, siteSlug, providerUserId, email }) {
  const state = `state-${suffix}`;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-google-access-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target.includes("googleapis.com/oauth2/v3/userinfo")) {
      return new Response(JSON.stringify({ sub: providerUserId, email, name: "Google Claim" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected Google URL: ${target}`);
  };
  const req = {
    method: "GET",
    headers: {
      cookie: [
        `aiove_google_oauth_state=${encodeURIComponent(state)}`,
        `aiove_google_oauth_site=${encodeURIComponent(siteSlug)}`,
        `${GUEST_COOKIE_NAME}=${encodeURIComponent(guest.token)}`,
      ].join("; "),
    },
  };
  const res = createMockResponse();
  await handleAuthRoute(req, res, {
    path: "/api/auth/google/callback",
    requestUrl: new URL(`http://127.0.0.1:4173/api/auth/google/callback?state=${encodeURIComponent(state)}&code=fake-code`),
  });
  return res;
}

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers);
    },
    end(body = "") {
      this.body = String(body || "");
    },
  };
}

function assertCookieSet(response, name, cleared) {
  const value = cookieValues(response).find((cookie) => cookie.startsWith(`${name}=`));
  assert.ok(value, `${name} cookie should be set`);
  assert.equal(/Max-Age=0/.test(value), cleared, `${name} clear state should match`);
}

function hasCookie(response, name) {
  return cookieValues(response).some((cookie) => cookie.startsWith(`${name}=`));
}

function cookieValues(response) {
  const value = response.headers["Set-Cookie"];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function id(prefix) {
  return `${prefix}_${suffix}`.slice(0, 64);
}
