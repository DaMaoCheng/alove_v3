import { isValidEmail, normalizeAccountType, normalizeEmail, normalizeNickname } from "./auth-service.js";
import { getDbPool, withTransaction } from "./db.js";
import { syncMascotActivationForSiteChange } from "./mascot-site-guard-service.js";
import { createId, hashSecret } from "./security.js";
import { getAdminAccountById, normalizeAccountId, throwNotFound, throwUserError } from "./admin-account-shared.js";

export async function createAdminAccount(payload = {}) {
  const email = normalizeEmail(payload.email);
  const nickname = normalizeNickname(payload.nickname || email.split("@")[0]);
  const accountType = normalizeAccountType(payload.accountType);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");
  assertAdminAccountEmail(email);
  if (!nickname) throwUserError("请输入昵称");
  assertAdminPassword({ password, confirmPassword });

  const [[existing]] = await getDbPool().execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if (existing) throwUserError("该邮箱已存在");

  const userId = createId("u");
  await withTransaction(async (db) => {
    await db.execute(
      `INSERT INTO users (
         id, platform, platform_uid, locale, username, password_hash, nickname,
         email, email_verified_at, email_auth_provider, account_type
       ) VALUES (?, 'web', ?, 'cn', ?, ?, ?, ?, NOW(3), 'admin', ?)`,
      [userId, email, email, hashSecret(password), nickname, email, accountType]
    );
    await db.execute(
      "INSERT INTO billing_accounts (internal_uid, balance, currency) VALUES (?, 0, 'credits')",
      [userId]
    );
  });

  return { ok: true, item: await getAdminAccountById(userId) };
}

export async function updateAdminAccountProfile(accountId, payload = {}, actor = null) {
  const userId = normalizeAccountId(accountId);
  const nickname = normalizeNickname(payload.nickname);
  const accountType = normalizeAccountType(payload.accountType);
  if (!nickname) throwUserError("请输入昵称");
  if (actor?.id === userId && accountType !== "admin") throwUserError("不能修改当前管理员自己的身份");

  const [result] = await getDbPool().execute(
    `UPDATE users
     SET nickname = ?, account_type = ?, updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [nickname, accountType, userId]
  );
  if (!result.affectedRows) throwNotFound("账号不存在");

  return { ok: true, item: await getAdminAccountById(userId) };
}

export async function resetAdminAccountPassword(accountId, payload = {}, actor = null) {
  const userId = normalizeAccountId(accountId);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");
  assertAdminPassword({ password, confirmPassword });
  const shouldClearToken = actor?.id !== userId;

  const [result] = await getDbPool().execute(
    `UPDATE users
     SET password_hash = ?, auth_token = CASE WHEN ? THEN NULL ELSE auth_token END, token_expires_at = CASE WHEN ? THEN NULL ELSE token_expires_at END, updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [hashSecret(password), shouldClearToken, shouldClearToken, userId]
  );
  if (!result.affectedRows) throwNotFound("账号不存在");

  return { ok: true };
}

export async function updateAdminAccountStatus(accountId, { status = "" } = {}, actor = null) {
  const userId = normalizeAccountId(accountId);
  const nextStatus = normalizeWritableAccountStatus(status);
  if (actor?.id === userId && nextStatus !== "active") throwUserError("不能封禁当前登录的管理员账号");

  const note = nextStatus === "active" ? null : "后台手动封禁";
  const [result] = await getDbPool().execute(
    `UPDATE users
     SET account_status = ?, account_status_note = ?, auth_token = CASE WHEN ? = 'active' THEN auth_token ELSE NULL END, token_expires_at = CASE WHEN ? = 'active' THEN token_expires_at ELSE NULL END, updated_at = NOW(3)
     WHERE id = ?
     LIMIT 1`,
    [nextStatus, note, nextStatus, nextStatus, userId]
  );
  if (!result.affectedRows) throwNotFound("账号不存在");

  return { ok: true, item: await getAdminAccountById(userId) };
}

export async function updateAdminAccountSite(accountIds = [], siteId = "") {
  const ids = normalizeAccountIds(accountIds);
  if (!ids.length) throwUserError("请选择账号");
  const nextSiteId = normalizeWritableSiteId(siteId);
  if (nextSiteId) await assertSiteExists(nextSiteId);

  const result = await withTransaction(async (db) => {
    const placeholders = ids.map(() => "?").join(", ");
    const [updateResult] = await db.execute(
      `UPDATE users SET site_id = ?, updated_at = NOW(3) WHERE id IN (${placeholders})`,
      [nextSiteId || null, ...ids]
    );

    const mascotSyncResults = [];
    for (const id of ids) {
      mascotSyncResults.push(await syncMascotActivationForSiteChange(db, { userId: id, nextSiteId }));
    }

    return {
      updatedCount: Number(updateResult.affectedRows || 0),
      mascotSyncResults,
    };
  });

  const items = [];
  for (const id of ids) {
    try {
      items.push(await getAdminAccountById(id));
    } catch {}
  }

  return { ok: true, updatedCount: result.updatedCount, items, mascotSyncResults: result.mascotSyncResults };
}

function normalizeWritableAccountStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["active", "banned"].includes(value)) return value;
  throwUserError("账号状态无效");
}

function normalizeAccountIds(accountIds) {
  const source = Array.isArray(accountIds) ? accountIds : [accountIds];
  return Array.from(new Set(source.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 1000);
}

function normalizeWritableSiteId(siteId) {
  const value = String(siteId || "").trim();
  if (!value || value === "unassigned") return "";
  return value.slice(0, 64);
}

async function assertSiteExists(siteId) {
  const [[site]] = await getDbPool().execute("SELECT id FROM sites WHERE id = ? LIMIT 1", [siteId]);
  if (!site) throwUserError("站点不存在");
}

function assertAdminAccountEmail(email) {
  if (!isValidEmail(email)) throwUserError("请输入正确的邮箱");
}

function assertAdminPassword({ password, confirmPassword }) {
  if (!password) throwUserError("请输入密码");
  if (password.length < 8) throwUserError("密码长度不能少于 8 个字符");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throwUserError("密码必须包含字母和数字");
  if (!confirmPassword) throwUserError("请再次输入密码");
  if (password !== confirmPassword) throwUserError("两次输入的密码不一致");
}
