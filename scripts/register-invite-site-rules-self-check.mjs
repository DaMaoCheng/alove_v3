import assert from "node:assert/strict";
import { getDbPool, closeDbPool } from "../server/db.js";
import { registerUser } from "../server/auth-service.js";
import { hashSecret } from "../server/security.js";

const db = getDbPool();
const CODE = "246810";
const PASSWORD = "InviteRule123";
const INVITER_ID = "u_invite_site_rule_inviter";
const INVITER_EMAIL = "invite-site-rule-inviter@example.local";
const INVITE_CODE = "AIOVE-SITE2468";
const REGISTER_EMAILS = [
  "invite-site-rule-gg@example.local",
  "invite-site-rule-fkk@example.local",
  "invite-site-rule-plain@example.local",
];

try {
  await cleanup();
  await seedInviter();

  await seedEmailCode(REGISTER_EMAILS[0]);
  const invited = await registerUser({
    email: REGISTER_EMAILS[0],
    nickname: "Invite GG User",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    verificationCode: CODE,
    inviteCode: INVITE_CODE,
    siteSlug: "gogoalshop",
  });
  assert.equal(invited.user.siteId, "site_gg", "matching invite should register to current GG site");
  await assertUserInvite(REGISTER_EMAILS[0], { siteId: "site_gg", usedReferralCode: INVITE_CODE });

  await seedEmailCode(REGISTER_EMAILS[1]);
  await assert.rejects(
    () => registerUser({
      email: REGISTER_EMAILS[1],
      nickname: "Invite FKK User",
      password: PASSWORD,
      confirmPassword: PASSWORD,
      verificationCode: CODE,
      inviteCode: INVITE_CODE,
      siteSlug: "footballkituk",
    }),
    /invite code.*current site|does not belong to the current site/i,
    "invite code from another site should be rejected instead of silently redirecting"
  );

  await seedEmailCode(REGISTER_EMAILS[2]);
  const plain = await registerUser({
    email: REGISTER_EMAILS[2],
    nickname: "Plain FKK User",
    password: PASSWORD,
    confirmPassword: PASSWORD,
    verificationCode: CODE,
    siteSlug: "footballkituk",
  });
  assert.equal(plain.user.siteId, "site_fkk", "plain registration should use current path site");
  await assertUserInvite(REGISTER_EMAILS[2], { siteId: "site_fkk", usedReferralCode: "" });

  console.log("register invite site rules self-check passed");
} finally {
  await cleanup();
  await closeDbPool();
}

async function seedInviter() {
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, locale, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id, referral_code, last_seen_at
     ) VALUES (?, 'web', ?, 'cn', ?, ?, 'Invite Rule Inviter', ?, NOW(3), 'email', 'personal', 'site_gg', ?, NOW(3))`,
    [INVITER_ID, INVITER_EMAIL, INVITER_EMAIL, hashSecret(PASSWORD), INVITER_EMAIL, INVITE_CODE]
  );
  await db.execute("INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')", [INVITER_ID]);
}

async function seedEmailCode(email) {
  await db.execute(
    `INSERT INTO email_verification_codes (email, scene, code_hash, provider, request_ip, expires_at)
     VALUES (?, 'register', ?, 'self-check', '127.0.0.1', DATE_ADD(NOW(3), INTERVAL 10 MINUTE))`,
    [email, hashSecret(CODE)]
  );
}

async function assertUserInvite(email, { siteId, usedReferralCode }) {
  const [[row]] = await db.execute(
    "SELECT site_id, used_referral_code FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  assert.equal(row?.site_id || "", siteId);
  assert.equal(row?.used_referral_code || "", usedReferralCode);
}

async function cleanup() {
  const emails = [INVITER_EMAIL, ...REGISTER_EMAILS];
  await db.execute("DELETE FROM email_verification_codes WHERE email IN (?, ?, ?, ?)", emails);
  await db.execute("DELETE FROM billing_accounts WHERE internal_uid = ? OR internal_uid IN (SELECT id FROM users WHERE email IN (?, ?, ?, ?))", [INVITER_ID, ...emails]);
  await db.execute("DELETE FROM users WHERE id = ? OR email IN (?, ?, ?, ?)", [INVITER_ID, ...emails]);
}
