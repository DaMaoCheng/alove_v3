import assert from "node:assert/strict";
import { closeDbPool, getDbPool, initializeDatabase } from "../server/db.js";
import { createUserFeedback, resetFeedbackGuardState } from "../server/feedback-service.js";
import { hashSecret } from "../server/security.js";

const USER_ID = "u_feedback_self_check";
const EMAIL = "feedback-self-check@example.local";
const PASSWORD = "Feedback1234";

await initializeDatabase();
const db = getDbPool();

try {
  await cleanup();
  resetFeedbackGuardState();
  await db.execute(
    `INSERT INTO users (
       id, platform, platform_uid, username, password_hash, nickname,
       email, email_verified_at, email_auth_provider, account_type, site_id,
       account_status, last_seen_at
     ) VALUES (?, 'web', ?, ?, ?, 'Feedback Check', ?, NOW(3), 'email', 'personal', 'site_fkk', 'active', NOW(3))`,
    [USER_ID, EMAIL, EMAIL, hashSecret(PASSWORD), EMAIL]
  );

  const result = await createUserFeedback(
    {
      id: USER_ID,
      email: EMAIL,
      account_type: "personal",
      site_id: "site_fkk",
      site_slug: "footballkituk",
    },
    {
      subject: "  Feedback   subject  ",
      content: "This is a feedback self-check.\nIt should be stored.",
      pagePath: "/footballkituk/discover?from=self-check",
    },
    {
      ip: "127.0.0.10",
      userAgent: "feedback-self-check-agent",
      now: Date.now(),
    }
  );

  assert.equal(result.ok, true, "feedback service should return ok");
  assert.match(result.feedback.id, /^ufb_/, "feedback id should use ufb prefix");
  assert.equal(result.feedback.status, "new", "new feedback should default to new status");

  const [[row]] = await db.execute("SELECT * FROM user_feedback WHERE id = ? LIMIT 1", [result.feedback.id]);
  assert.ok(row, "feedback row should be inserted");
  assert.equal(row.internal_uid, USER_ID, "feedback should store user id");
  assert.equal(row.user_email, EMAIL, "feedback should snapshot user email");
  assert.equal(row.account_type, "personal", "feedback should snapshot account type");
  assert.equal(row.site_id, "site_fkk", "feedback should snapshot site id");
  assert.equal(row.site_slug, "footballkituk", "feedback should snapshot site slug");
  assert.equal(row.client_ip, "127.0.0.10", "feedback should snapshot client IP");
  assert.equal(row.subject, "Feedback subject", "feedback subject should be normalized");
  assert.equal(row.content, "This is a feedback self-check.\nIt should be stored.", "feedback content should be stored");
  assert.equal(row.page_path, "/footballkituk/discover?from=self-check", "feedback should store page path");
  assert.equal(row.user_agent, "feedback-self-check-agent", "feedback should store user agent");
  assert.equal(row.feedback_status, "new", "feedback status should be new");

  const guestResult = await createUserFeedback(
    {
      guest_session_id: "guest_feedback_self_check",
      email: "Guest.Feedback@example.local ",
      account_type: "guest",
      site_id: "site_fkk",
      site_slug: "footballkituk",
    },
    {
      subject: "Guest feedback",
      content: "This feedback was sent without a registered account.",
      pagePath: "/footballkituk/discover?from=guest-self-check",
    },
    {
      ip: "127.0.0.15",
      userAgent: "guest-feedback-self-check-agent",
      now: Date.now() + 1,
    }
  );
  const [[guestRow]] = await db.execute("SELECT * FROM user_feedback WHERE id = ? LIMIT 1", [guestResult.feedback.id]);
  assert.ok(guestRow, "guest feedback row should be inserted");
  assert.equal(guestRow.internal_uid, null, "guest feedback must not create or impersonate a user account");
  assert.equal(guestRow.guest_session_id, "guest_feedback_self_check", "guest feedback should keep the guest session id");
  assert.equal(guestRow.user_email, "guest.feedback@example.local", "guest feedback should store the normalized contact email");
  assert.equal(guestRow.account_type, "guest", "guest feedback should be marked as guest");
  assert.equal(guestRow.site_slug, "footballkituk", "guest feedback should keep the resolved site context");
  assert.equal(guestRow.client_ip, "127.0.0.15", "guest feedback should snapshot client IP");

  await assert.rejects(
    () => createUserFeedback({ email: "not-an-email", account_type: "guest" }, { subject: "subject", content: "details" }),
    (error) => error?.statusCode === 400 && /contact email/i.test(error.publicMessage || error.message),
    "guest feedback without a valid contact email should be rejected"
  );

  await assert.rejects(
    () => createUserFeedback({ id: USER_ID }, { subject: "", content: "details" }),
    /subject/i,
    "empty subject should be rejected"
  );
  await assert.rejects(
    () => createUserFeedback({ id: USER_ID }, { subject: "subject", content: "" }),
    /details/i,
    "empty content should be rejected"
  );
  await assert.rejects(
    () => createUserFeedback({ id: USER_ID }, { subject: "x".repeat(121), content: "details" }),
    /subject is too long/i,
    "too long subject should be rejected"
  );
  await assert.rejects(
    () => createUserFeedback({ id: USER_ID }, { subject: "subject", content: "x".repeat(1201) }),
    /details are too long/i,
    "too long content should be rejected"
  );

  const invalidPathResult = await createUserFeedback(
    {
      id: USER_ID,
      email: EMAIL,
      account_type: "personal",
      site_id: "site_fkk",
      site_slug: "footballkituk",
    },
    {
      subject: "Invalid path check",
      content: "Absolute URLs should not be stored as page paths.",
      pagePath: "https://example.test/footballkituk/discover",
    },
    {
      ip: "127.0.0.11",
      userAgent: "feedback-self-check-agent",
      now: Date.now() + 1,
    }
  );
  const [[invalidPathRow]] = await db.execute("SELECT page_path FROM user_feedback WHERE id = ? LIMIT 1", [invalidPathResult.feedback.id]);
  assert.equal(invalidPathRow.page_path, null, "non-site page path should be stored as NULL");

  const duplicatePayload = {
    subject: "Duplicate feedback",
    content: "This duplicate payload should be rejected on the second try.",
    pagePath: "/footballkituk/discover",
  };
  await createUserFeedback(
    { id: USER_ID, email: EMAIL, account_type: "personal", site_id: "site_fkk", site_slug: "footballkituk" },
    duplicatePayload,
    { ip: "127.0.0.12", userAgent: "feedback-self-check-agent", now: Date.now() + 2 }
  );
  await assert.rejects(
    () => createUserFeedback(
      { id: USER_ID, email: EMAIL, account_type: "personal", site_id: "site_fkk", site_slug: "footballkituk" },
      duplicatePayload,
      { ip: "127.0.0.12", userAgent: "feedback-self-check-agent", now: Date.now() + 3 }
    ),
    (error) => error?.statusCode === 409 && /already sent/i.test(error.publicMessage || error.message),
    "duplicate subject and content should be rejected"
  );

  resetFeedbackGuardState();
  for (let index = 0; index < 5; index += 1) {
    await createUserFeedback(
      { id: USER_ID, email: EMAIL, account_type: "personal", site_id: "site_fkk", site_slug: "footballkituk" },
      {
        subject: `Rate limit ${index}`,
        content: `Rate limit feedback ${index}`,
        pagePath: "/footballkituk/discover",
      },
      { ip: "127.0.0.13", userAgent: "feedback-self-check-agent", now: Date.now() + index }
    );
  }
  await assert.rejects(
    () => createUserFeedback(
      { id: USER_ID, email: EMAIL, account_type: "personal", site_id: "site_fkk", site_slug: "footballkituk" },
      {
        subject: "Rate limit overflow",
        content: "The sixth feedback in the guard window should be rejected.",
        pagePath: "/footballkituk/discover",
      },
      { ip: "127.0.0.13", userAgent: "feedback-self-check-agent", now: Date.now() + 6 }
    ),
    (error) => error?.statusCode === 429 && /recently/i.test(error.publicMessage || error.message),
    "sixth feedback in the guard window should be rate limited"
  );

  resetFeedbackGuardState();
  for (let index = 0; index < 20; index += 1) {
    await createUserFeedback(
      {
        id: `u_feedback_ip_self_check_${index}`,
        email: `feedback-ip-${index}@example.local`,
        account_type: "personal",
        site_id: "site_fkk",
        site_slug: "footballkituk",
      },
      {
        subject: `IP limit ${index}`,
        content: `IP limit feedback ${index}`,
        pagePath: "/footballkituk/discover",
      },
      { ip: "127.0.0.14", userAgent: "feedback-self-check-agent", now: Date.now() + index }
    );
  }
  await assert.rejects(
    () => createUserFeedback(
      {
        id: "u_feedback_ip_self_check_overflow",
        email: "feedback-ip-overflow@example.local",
        account_type: "personal",
        site_id: "site_fkk",
        site_slug: "footballkituk",
      },
      {
        subject: "IP limit overflow",
        content: "The twenty-first feedback from the same IP should be rejected.",
        pagePath: "/footballkituk/discover",
      },
      { ip: "127.0.0.14", userAgent: "feedback-self-check-agent", now: Date.now() + 21 }
    ),
    (error) => error?.statusCode === 429 && /network/i.test(error.publicMessage || error.message),
    "twenty-first feedback from the same IP should be rate limited"
  );

  console.log("user feedback submit self-check passed");
} finally {
  resetFeedbackGuardState();
  await cleanup();
  await closeDbPool();
}

async function cleanup() {
  await db.execute("DELETE FROM user_feedback WHERE internal_uid = ?", [USER_ID]).catch(() => {});
  await db.execute("DELETE FROM user_feedback WHERE internal_uid LIKE 'u_feedback_ip_self_check_%'").catch(() => {});
  await db.execute("DELETE FROM user_feedback WHERE user_email = ?", ["guest.feedback@example.local"]).catch(() => {});
  await db.execute("DELETE FROM users WHERE id = ?", [USER_ID]).catch(() => {});
}
