import { createHash } from "node:crypto";
import { getDbPool } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { createId } from "./security.js";

const SUBJECT_MAX_LENGTH = 120;
const CONTENT_MAX_LENGTH = 1200;
const FEEDBACK_GUARD_WINDOW_MS = 10 * 60 * 1000;
const USER_FEEDBACK_LIMIT = 5;
const IP_FEEDBACK_LIMIT = 20;
const FEEDBACK_GUARD_PRUNE_THRESHOLD = 1000;

const userSubmissionTimestamps = new Map();
const ipSubmissionTimestamps = new Map();
const duplicateSubmissionTimestamps = new Map();

export async function createUserFeedback(user, payload = {}, context = {}) {
  const principal = normalizeFeedbackPrincipal(user);
  const subject = normalizeSubject(payload.subject);
  const content = normalizeContent(payload.content);
  const pagePath = normalizePagePath(payload.pagePath);
  const userAgent = normalizeString(context.userAgent, 500);
  const feedbackId = createId("ufb");
  const requestIp = normalizeString(context.ip, 64);
  const now = Number(context.now || Date.now());

  enforceFeedbackGuard({ principalId: principal.guardKey, requestIp, subject, content, now });

  await getDbPool().execute(
    `INSERT INTO user_feedback (
       id, internal_uid, guest_session_id, user_email, account_type, site_id, site_slug, client_ip, client_ip_region,
       subject, content, page_path, user_agent, feedback_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [
      feedbackId,
      principal.internalUid || null,
      principal.guestSessionId || null,
      principal.email || null,
      principal.accountType || null,
      principal.siteId || null,
      principal.siteSlug || null,
      requestIp || null,
      normalizeString(context.region, 96) || null,
      subject,
      content,
      pagePath || null,
      userAgent || null,
    ]
  );
  recordFeedbackSubmission({ principalId: principal.guardKey, requestIp, subject, content, now });

  return {
    ok: true,
    feedback: {
      id: feedbackId,
      status: "new",
    },
  };
}

export function resetFeedbackGuardState() {
  userSubmissionTimestamps.clear();
  ipSubmissionTimestamps.clear();
  duplicateSubmissionTimestamps.clear();
}

function normalizeFeedbackPrincipal(user) {
  const internalUid = normalizeString(user?.id, 64);
  const email = normalizeEmail(user?.email);
  if (internalUid) {
    return {
      internalUid,
      email,
      accountType: normalizeString(user.account_type || user.accountType, 32),
      siteId: normalizeString(user.site_id || user.siteId, 64),
      siteSlug: normalizeString(user.site_slug || user.siteSlug, 96),
      guardKey: `user:${internalUid}`,
    };
  }
  if (!email) throw createPublicError("Enter a valid contact email.", 400, "FEEDBACK_CONTACT_EMAIL_INVALID");
  return {
    internalUid: "",
    guestSessionId: normalizeString(user?.guest_session_id || user?.guestSessionId, 64),
    email,
    accountType: "guest",
    siteId: normalizeString(user?.site_id || user?.siteId, 64),
    siteSlug: normalizeString(user?.site_slug || user?.siteSlug, 96),
    guardKey: `guest:${createHash("sha256").update(email).digest("hex")}`,
  };
}

function normalizeEmail(value) {
  const email = normalizeString(value, 255).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeSubject(value) {
  const subject = String(value || "").replace(/\s+/g, " ").trim();
  if (!subject) throw createPublicError("Please add a feedback subject.", 400, "FEEDBACK_SUBJECT_REQUIRED");
  if (subject.length > SUBJECT_MAX_LENGTH) {
    throw createPublicError("Feedback subject is too long.", 400, "FEEDBACK_SUBJECT_TOO_LONG");
  }
  return subject;
}

function normalizeContent(value) {
  const content = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!content) throw createPublicError("Please add feedback details.", 400, "FEEDBACK_CONTENT_REQUIRED");
  if (content.length > CONTENT_MAX_LENGTH) {
    throw createPublicError("Feedback details are too long.", 400, "FEEDBACK_CONTENT_TOO_LONG");
  }
  return content;
}

function normalizePagePath(value) {
  const pagePath = normalizeString(value, 512);
  if (!pagePath) return "";
  if (!pagePath.startsWith("/") || pagePath.startsWith("//")) return "";
  return pagePath;
}

function normalizeString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function enforceFeedbackGuard({ principalId, requestIp, subject, content, now }) {
  const userTimestamps = pruneTimestamps(userSubmissionTimestamps.get(principalId), now);
  userSubmissionTimestamps.set(principalId, userTimestamps);
  if (userTimestamps.length >= USER_FEEDBACK_LIMIT) {
    throw createPublicError(
      "You have sent several feedback messages recently. Please try again later.",
      429,
      "FEEDBACK_USER_RATE_LIMITED"
    );
  }

  if (requestIp) {
    const ipTimestamps = pruneTimestamps(ipSubmissionTimestamps.get(requestIp), now);
    ipSubmissionTimestamps.set(requestIp, ipTimestamps);
    if (ipTimestamps.length >= IP_FEEDBACK_LIMIT) {
      throw createPublicError(
        "Too many feedback messages were sent from this network. Please try again later.",
        429,
        "FEEDBACK_IP_RATE_LIMITED"
      );
    }
  }

  const duplicateKey = createDuplicateKey(principalId, subject, content);
  const duplicateAt = Number(duplicateSubmissionTimestamps.get(duplicateKey) || 0);
  if (duplicateAt && now - duplicateAt < FEEDBACK_GUARD_WINDOW_MS) {
    throw createPublicError(
      "This feedback was already sent. Please wait before sending the same message again.",
      409,
      "FEEDBACK_DUPLICATE"
    );
  }
  if (duplicateAt) duplicateSubmissionTimestamps.delete(duplicateKey);
}

function recordFeedbackSubmission({ principalId, requestIp, subject, content, now }) {
  appendTimestamp(userSubmissionTimestamps, principalId, now);
  if (requestIp) appendTimestamp(ipSubmissionTimestamps, requestIp, now);
  duplicateSubmissionTimestamps.set(createDuplicateKey(principalId, subject, content), now);
  pruneRateLimitMap(userSubmissionTimestamps, now);
  pruneRateLimitMap(ipSubmissionTimestamps, now);
  pruneDuplicateTimestamps(now);
}

function appendTimestamp(map, key, now) {
  const timestamps = pruneTimestamps(map.get(key), now);
  timestamps.push(now);
  map.set(key, timestamps);
}

function pruneTimestamps(value, now) {
  const timestamps = Array.isArray(value) ? value : [];
  return timestamps.filter((timestamp) => now - Number(timestamp || 0) < FEEDBACK_GUARD_WINDOW_MS);
}

function pruneDuplicateTimestamps(now) {
  for (const [key, timestamp] of duplicateSubmissionTimestamps.entries()) {
    if (now - Number(timestamp || 0) >= FEEDBACK_GUARD_WINDOW_MS) {
      duplicateSubmissionTimestamps.delete(key);
    }
  }
}

function pruneRateLimitMap(map, now) {
  if (map.size < FEEDBACK_GUARD_PRUNE_THRESHOLD) return;
  for (const [key, timestamps] of map.entries()) {
    const active = pruneTimestamps(timestamps, now);
    if (active.length) map.set(key, active);
    else map.delete(key);
  }
}

function createDuplicateKey(principalId, subject, content) {
  return `${principalId}\n${subject}\n${content}`;
}
