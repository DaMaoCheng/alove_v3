import { SERVER_CONFIG } from "./config.js";
import { getDbPool } from "./db.js";
import { resolveEmailProvider, sendVerificationEmail } from "./email-service.js";
import { createNumericCode, hashSecret, verifySecret } from "./security.js";
import { findUserByEmail } from "./auth-user-service.js";
import { isValidEmail, normalizeCodeScene, normalizeEmail, normalizeRequestIp, throwUserError } from "./auth-normalizers.js";

const CODE_EXPIRES_MINUTES = 10;
const CODE_RESEND_COOLDOWN_SECONDS = 60;
const CODE_EMAIL_HOURLY_LIMIT = 6;
const CODE_IP_HOURLY_LIMIT = 30;
const CODE_MAX_ATTEMPTS = 5;
const EXPIRED_CODE_RETENTION_HOURS = 24;

export async function sendEmailCode(payload = {}) {
  const normalizedEmail = normalizeEmail(payload.email);
  const normalizedScene = normalizeCodeScene(payload.scene);
  const requestIp = normalizeRequestIp(payload.requestIp);
  if (!isValidEmail(normalizedEmail)) throwUserError("Please enter a valid email address.");

  if (normalizedScene === "register") {
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) throwUserError("This email is already registered. Please sign in.");
  }

  if (normalizedScene === "forgot_password") {
    const existing = await findUserByEmail(normalizedEmail);
    if (!existing) throwUserError("No account exists for this email.");
  }

  const lockName = buildEmailCodeLockName(normalizedEmail, normalizedScene);
  const releaseLock = await acquireEmailCodeLock(lockName);
  let delivery;
  try {
    await cleanupExpiredEmailCodes();
    await assertEmailCodeSendAllowed({ email: normalizedEmail, scene: normalizedScene, requestIp });

    const provider = resolveEmailProvider();
    const code = createNumericCode(6);
    const expiresAt = new Date(Date.now() + CODE_EXPIRES_MINUTES * 60 * 1000);
    const [insertResult] = await getDbPool().execute(
      `INSERT INTO email_verification_codes (email, scene, code_hash, provider, request_ip, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [normalizedEmail, normalizedScene, hashSecret(code), provider, requestIp, expiresAt]
    );
    try {
      delivery = await sendVerificationEmail({
        email: normalizedEmail,
        code,
        scene: normalizedScene,
        expiresInSeconds: CODE_EXPIRES_MINUTES * 60,
      });
    } catch (error) {
      await getDbPool().execute("DELETE FROM email_verification_codes WHERE id = ? AND consumed_at IS NULL", [insertResult.insertId]);
      throw error;
    }
  } finally {
    await releaseLock();
  }

  return {
    ok: true,
    expiresInSeconds: CODE_EXPIRES_MINUTES * 60,
    ...(SERVER_CONFIG.emailAuthDevMode && delivery.devCode ? { devCode: delivery.devCode } : {}),
  };
}

export async function checkEmailAvailability({ email } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throwUserError("Please enter a valid email address.");

  return {
    ok: true,
    available: !(await findUserByEmail(normalizedEmail)),
  };
}

export async function consumeEmailCode(db, { email, scene, code }) {
  const [rows] = await db.execute(
    `SELECT id, code_hash, attempts_count
     FROM email_verification_codes
     WHERE email = ? AND scene = ? AND consumed_at IS NULL AND expires_at > NOW(3)
     ORDER BY id DESC
     LIMIT 1`,
    [normalizeEmail(email), normalizeCodeScene(scene)]
  );
  const record = rows[0] || null;
  if (!record) throwUserError("The verification code is incorrect or expired.");
  if (Number(record.attempts_count || 0) >= CODE_MAX_ATTEMPTS) throwUserError("Too many verification attempts. Please request a new code.");
  if (!verifySecret(code, record.code_hash)) {
    await db.execute(
      "UPDATE email_verification_codes SET attempts_count = attempts_count + 1, last_attempt_at = NOW(3) WHERE id = ?",
      [record.id]
    );
    throwUserError("The verification code is incorrect or expired.");
  }

  await db.execute(
    "UPDATE email_verification_codes SET consumed_at = NOW(3) WHERE id = ?",
    [record.id]
  );
}

function buildEmailCodeLockName(email, scene) {
  return `email_code:${scene}:${email}`.slice(0, 64);
}

async function acquireEmailCodeLock(lockName) {
  const connection = await getDbPool().getConnection();
  const [rows] = await connection.execute("SELECT GET_LOCK(?, 5) AS locked", [lockName]);
  if (Number(rows[0]?.locked || 0) !== 1) {
    connection.release();
    throwUserError("Verification codes are being requested too often. Please try again later.");
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await connection.execute("SELECT RELEASE_LOCK(?)", [lockName]);
    } finally {
      connection.release();
    }
  };
}

async function cleanupExpiredEmailCodes() {
  await getDbPool().execute(
    `DELETE FROM email_verification_codes
     WHERE expires_at < DATE_SUB(NOW(3), INTERVAL ? HOUR)`,
    [EXPIRED_CODE_RETENTION_HOURS]
  );
}

async function assertEmailCodeSendAllowed({ email, scene, requestIp }) {
  const [recentEmailRows] = await getDbPool().execute(
    `SELECT COUNT(*) AS count
     FROM email_verification_codes
     WHERE email = ? AND scene = ? AND created_at > DATE_SUB(NOW(3), INTERVAL ? SECOND)`,
    [email, scene, CODE_RESEND_COOLDOWN_SECONDS]
  );
  if (Number(recentEmailRows[0]?.count || 0) > 0) throwUserError("Verification codes are being requested too often. Please try again later.");

  const [emailHourRows] = await getDbPool().execute(
    `SELECT COUNT(*) AS count
     FROM email_verification_codes
     WHERE email = ? AND scene = ? AND created_at > DATE_SUB(NOW(3), INTERVAL 1 HOUR)`,
    [email, scene]
  );
  if (Number(emailHourRows[0]?.count || 0) >= CODE_EMAIL_HOURLY_LIMIT) throwUserError("Too many verification code requests for this email. Please try again later.");

  if (!requestIp) return;
  const [ipHourRows] = await getDbPool().execute(
    `SELECT COUNT(*) AS count
     FROM email_verification_codes
     WHERE request_ip = ? AND created_at > DATE_SUB(NOW(3), INTERVAL 1 HOUR)`,
    [requestIp]
  );
  if (Number(ipHourRows[0]?.count || 0) >= CODE_IP_HOURLY_LIMIT) throwUserError("Too many requests from this network. Please try again later.");
}
