import { SERVER_CONFIG } from "./config.js";
import { getDbPool, withTransaction } from "./db.js";
import { createPublicError } from "./public-error-utils.js";
import { createId, decryptSecret, encryptSecret } from "./security.js";
import { safeString } from "./product-source-shared-service.js";
import { isEnabledTtmallAccess, resolveTtmallRuntimeAccess } from "./ttmall-runtime-access-service.js";

export async function getTtmallAccountBinding({ userId = "", siteSlug = "" } = {}) {
  const access = await resolveBindingAccess({ userId, siteSlug });
  if (!isEnabledTtmallAccess(access)) return { ok: true, mode: "not_ttmall", requiresBinding: false, binding: null };
  const binding = await readBinding({ userId: access.userId, siteId: access.site.id });
  const candidate = isActiveBinding(binding, access.source)
    ? null
    : await readBindingCandidate({ userId: access.userId, siteId: access.site.id, sourceCacheKey: access.source.cacheKey });
  return {
    ok: true,
    mode: "ttmall",
    requiresBinding: !isActiveBinding(binding, access.source),
    binding: toPublicBinding(binding, access.source, candidate),
  };
}

// Registration may remember that this ALOVE email needs a TTMall sign-in, but
// it must never treat an email match as an authenticated provider account.
export async function recordTtmallBindingCandidate({ userId = "", email = "", siteSlug = "" } = {}) {
  let access;
  try {
    access = await resolveBindingAccess({ userId, siteSlug });
  } catch (error) {
    // Registration is shared by every site. A local-only TTMall test flow must
    // never make unrelated site registration look or behave like a failure.
    if (error?.publicCode === "TTMALL_RUNTIME_DISABLED") return { status: "not_applicable" };
    throw error;
  }
  if (!isEnabledTtmallAccess(access)) return { status: "not_applicable" };
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { status: "not_applicable" };
  const current = await readBinding({ userId: access.userId, siteId: access.site.id });
  if (isActiveBinding(current, access.source)) return { status: "already_active" };
  await getDbPool().execute(
    `INSERT INTO ttmall_binding_candidates (id, user_id, site_id, source_cache_key, email, candidate_status)
     VALUES (?, ?, ?, ?, ?, 'pending_auth')
     ON DUPLICATE KEY UPDATE
       source_cache_key = VALUES(source_cache_key), email = VALUES(email), candidate_status = 'pending_auth',
       updated_at = CURRENT_TIMESTAMP(3)`,
    [createId("tbc"), access.userId, access.site.id, access.source.cacheKey, normalizedEmail],
  );
  return { status: "pending_auth" };
}

export async function saveTtmallAccountBinding({ userId = "", siteSlug = "", externalUserId = "", email = "", token = "", providerCode = "" } = {}) {
  const access = await resolveBindingAccess({ userId, siteSlug });
  if (!isEnabledTtmallAccess(access)) throw createPublicError("This site does not use the TTMall account flow.", 409, "TTMALL_BINDING_NOT_REQUIRED");
  const normalizedExternalUserId = safeString(externalUserId);
  const normalizedEmail = normalizeEmail(email);
  const normalizedToken = safeString(token);
  const accessTokenExpiresAt = readJwtExpiry(normalizedToken);
  if (!normalizedExternalUserId || !normalizedEmail || !normalizedToken) {
    throw createPublicError("TTMall did not return valid account details. Please try again.", 422, "TTMALL_BINDING_DATA_INVALID");
  }
  const secretKey = requireBindingSecret();
  try {
    await withTransaction(async (db) => {
      const [ownerRows] = await db.execute(
        "SELECT id FROM ttmall_account_bindings WHERE site_id = ? AND ttmall_user_id = ? LIMIT 1 FOR UPDATE",
        [access.site.id, normalizedExternalUserId],
      );
      const currentBindingId = await readBindingId(db, access.userId, access.site.id);
      if (ownerRows[0] && ownerRows[0].id !== currentBindingId) {
        throw createPublicError("This TTMall account is already linked to another AIOVE account for this site.", 409, "TTMALL_ACCOUNT_ALREADY_BOUND");
      }
      const bindingId = currentBindingId || createId("tab");
      await db.execute(
        `INSERT INTO ttmall_account_bindings (
          id, user_id, site_id, source_cache_key, ttmall_user_id, ttmall_email,
          access_token_encrypted, token_status, provider_code, access_token_expires_at,
          last_checked_at, last_error_code, verified_at, stale_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NOW(3), NULL, NOW(3), NULL)
        ON DUPLICATE KEY UPDATE
          source_cache_key = VALUES(source_cache_key), ttmall_user_id = VALUES(ttmall_user_id),
          ttmall_email = VALUES(ttmall_email), access_token_encrypted = VALUES(access_token_encrypted),
          token_status = 'active', provider_code = VALUES(provider_code), access_token_expires_at = VALUES(access_token_expires_at),
          last_checked_at = NOW(3), last_error_code = NULL, verified_at = NOW(3), stale_at = NULL,
          updated_at = CURRENT_TIMESTAMP(3)`,
        [bindingId, access.userId, access.site.id, access.source.cacheKey, normalizedExternalUserId, normalizedEmail, encryptSecret(normalizedToken, secretKey), safeString(providerCode) || null, accessTokenExpiresAt],
      );
      await db.execute("DELETE FROM ttmall_binding_candidates WHERE user_id = ? AND site_id = ?", [access.userId, access.site.id]);
      await db.execute("DELETE FROM ttmall_cart_sessions WHERE user_id = ? AND site_id = ?", [access.userId, access.site.id]);
    });
  } catch (error) {
    if (error?.publicMessage) throw error;
    if (error?.code === "ER_DUP_ENTRY") {
      throw createPublicError("This TTMall account is already linked to another AIOVE account for this site.", 409, "TTMALL_ACCOUNT_ALREADY_BOUND");
    }
    throw error;
  }
  return getTtmallAccountBinding({ userId: access.userId, siteSlug });
}

export async function removeTtmallAccountBinding({ userId = "", siteSlug = "" } = {}) {
  const access = await resolveBindingAccess({ userId, siteSlug });
  if (!isEnabledTtmallAccess(access)) return { ok: true, mode: "not_ttmall", requiresBinding: false, binding: null };
  await withTransaction(async (db) => {
    await db.execute("DELETE FROM ttmall_cart_sessions WHERE user_id = ? AND site_id = ?", [access.userId, access.site.id]);
    await db.execute("DELETE FROM ttmall_account_bindings WHERE user_id = ? AND site_id = ?", [access.userId, access.site.id]);
    await db.execute("DELETE FROM ttmall_binding_candidates WHERE user_id = ? AND site_id = ?", [access.userId, access.site.id]);
  });
  return { ok: true, mode: "ttmall", requiresBinding: true, binding: null };
}

export async function readActiveTtmallAccountToken({ userId = "", siteSlug = "" } = {}) {
  return ensureActiveTtmallBinding({ userId, siteSlug });
}

export async function ensureActiveTtmallBinding({ userId = "", siteSlug = "" } = {}) {
  const access = await resolveBindingAccess({ userId, siteSlug });
  if (!isEnabledTtmallAccess(access)) return null;
  const binding = await readBinding({ userId: access.userId, siteId: access.site.id });
  if (!isActiveBinding(binding, access.source)) return null;
  if (isTokenExpired(binding)) {
    await markTtmallAccountBindingStale({ userId: access.userId, siteId: access.site.id, errorCode: "token_expired" });
    return null;
  }
  try {
    const token = decryptSecret(binding.access_token_encrypted, requireBindingSecret());
    if (!token) throw new Error("missing token");
    await touchBindingCheckedAt({ id: binding.id });
    return { token, source: access.source, site: access.site, binding };
  } catch {
    await markTtmallAccountBindingStale({ userId: access.userId, siteId: access.site.id, errorCode: "token_unreadable" });
    return null;
  }
}

export async function markTtmallAccountBindingStale({ userId = "", siteId = "", errorCode = "token_rejected" } = {}) {
  if (!safeString(userId) || !safeString(siteId)) return;
  await getDbPool().execute(
    `UPDATE ttmall_account_bindings
     SET token_status = 'stale', access_token_encrypted = NULL, stale_at = NOW(3),
         last_checked_at = NOW(3), last_error_code = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE user_id = ? AND site_id = ?`,
    [safeString(errorCode).slice(0, 64) || "token_rejected", safeString(userId), safeString(siteId)],
  );
}

async function resolveBindingAccess({ userId, siteSlug }) {
  const normalizedUserId = safeString(userId);
  if (!normalizedUserId) throw createPublicError("Please sign in first.", 401, "AUTH_REQUIRED");
  const resolved = await resolveTtmallRuntimeAccess(siteSlug);
  return { ...resolved, userId: normalizedUserId };
}

async function readBinding({ userId, siteId }) {
  const [rows] = await getDbPool().execute(
    `SELECT id, user_id, site_id, source_cache_key, ttmall_user_id, ttmall_email,
            access_token_encrypted, token_status, provider_code, access_token_expires_at,
            last_checked_at, last_error_code, verified_at, stale_at, updated_at
       FROM ttmall_account_bindings WHERE user_id = ? AND site_id = ? LIMIT 1`,
    [userId, siteId],
  );
  return rows[0] || null;
}

async function readBindingId(db, userId, siteId) {
  const [rows] = await db.execute("SELECT id FROM ttmall_account_bindings WHERE user_id = ? AND site_id = ? LIMIT 1 FOR UPDATE", [userId, siteId]);
  return rows[0]?.id || "";
}

function isActiveBinding(binding, source) {
  return Boolean(binding
    && binding.token_status === "active"
    && binding.source_cache_key === source?.cacheKey
    && binding.access_token_encrypted);
}

function toPublicBinding(binding, source, candidate = null) {
  if (!binding && !candidate) return null;
  if (!isActiveBinding(binding, source) && candidate?.candidate_status === "pending_auth") {
    return {
      status: "pending_auth",
      email: maskEmail(candidate.email),
      prefillEmail: normalizeEmail(candidate.email),
      updatedAt: candidate.updated_at || null,
    };
  }
  return {
    status: isActiveBinding(binding, source) ? "active" : "stale",
    email: maskEmail(binding.ttmall_email),
    updatedAt: binding.updated_at || null,
  };
}

async function readBindingCandidate({ userId, siteId, sourceCacheKey }) {
  const [rows] = await getDbPool().execute(
    `SELECT id, email, candidate_status, updated_at
       FROM ttmall_binding_candidates
      WHERE user_id = ? AND site_id = ? AND source_cache_key = ? LIMIT 1`,
    [userId, siteId, sourceCacheKey],
  );
  return rows[0] || null;
}

function isTokenExpired(binding = {}) {
  const expiresAt = binding.access_token_expires_at ? new Date(binding.access_token_expires_at).getTime() : 0;
  return Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now();
}

// TTMall documents show JWT access tokens with an `exp` claim. Decoding it
// locally does not verify or expose the token; provider 401/403 responses are
// still the authority when no expiry is present or a token is revoked early.
function readJwtExpiry(token = "") {
  const payload = safeString(token).split(".")[1];
  if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    const seconds = Number(decoded?.exp);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const expiresAt = new Date(Math.trunc(seconds) * 1000);
    return Number.isFinite(expiresAt.getTime()) ? expiresAt : null;
  } catch {
    return null;
  }
}

async function touchBindingCheckedAt({ id = "" } = {}) {
  if (!safeString(id)) return;
  await getDbPool().execute(
    `UPDATE ttmall_account_bindings
        SET last_checked_at = NOW(3), updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND (last_checked_at IS NULL OR last_checked_at < DATE_SUB(NOW(3), INTERVAL 5 MINUTE))`,
    [safeString(id)],
  );
}

function requireBindingSecret() {
  const secret = safeString(SERVER_CONFIG.ttmallAccountBinding?.secretKey);
  if (!secret) throw createPublicError("TTMall account binding is not configured.", 503, "TTMALL_BINDING_SECRET_REQUIRED");
  return secret;
}

function normalizeEmail(value) {
  const email = safeString(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 254) : "";
}

function maskEmail(value = "") {
  const [name, domain] = normalizeEmail(value).split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}${name.length > 2 ? "•••" : "•"}@${domain}`;
}
