import assert from "node:assert/strict";
import { closeDbPool } from "../server/db.js";
import { loginUser } from "../server/auth-service.js";

const ADMIN_EMAIL = "admin@aiove.local";
const ADMIN_PASSWORD = process.env.ALOVE_TEST_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error("Set ALOVE_TEST_ADMIN_PASSWORD to run this local self-check.");
const GENERIC_LOGIN_ERROR = "Invalid email or password.";
const THROTTLE_ERROR = "Too many sign-in attempts. Please try again later.";
const suffix = Date.now().toString(36);

try {
  const wrongPassword = await captureLoginError({
    email: ADMIN_EMAIL,
    password: `wrong-${suffix}`,
    requestIp: `203.0.113.${Number(suffix.length) + 10}`,
  });
  assert.equal(wrongPassword.statusCode, 401, "wrong password should return 401");
  assert.equal(wrongPassword.message, GENERIC_LOGIN_ERROR, "wrong password should not reveal password-specific errors");

  const missingAccount = await captureLoginError({
    email: `missing-${suffix}@example.test`,
    password: "WrongPassword123",
    requestIp: "203.0.113.80",
  });
  assert.equal(missingAccount.statusCode, 401, "missing account should return 401");
  assert.equal(missingAccount.message, GENERIC_LOGIN_ERROR, "missing account should not reveal account existence");

  const success = await loginUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    requestIp: "203.0.113.81",
  });
  assert.equal(success.authResponse.ok, true, "valid credentials should still sign in");
  assert.equal(success.authResponse.user.email, ADMIN_EMAIL, "valid login should return the expected user");

  const throttledEmail = `throttle-${suffix}@example.test`;
  const throttledIp = "203.0.113.82";
  for (let index = 0; index < 5; index += 1) {
    const failure = await captureLoginError({
      email: throttledEmail,
      password: "WrongPassword123",
      requestIp: throttledIp,
    });
    assert.equal(failure.statusCode, 401, "pre-lock failures should return normal login failure");
    assert.equal(failure.message, GENERIC_LOGIN_ERROR, "pre-lock failures should stay generic");
  }

  const throttled = await captureLoginError({
    email: throttledEmail,
    password: "WrongPassword123",
    requestIp: throttledIp,
  });
  assert.equal(throttled.statusCode, 429, "too many failures should return 429");
  assert.equal(throttled.message, THROTTLE_ERROR, "too many failures should return the throttle message");

  console.log("auth login throttle self-check passed");
} finally {
  await closeDbPool();
}

async function captureLoginError(payload) {
  try {
    await loginUser(payload);
  } catch (error) {
    return {
      statusCode: Number(error?.statusCode || 500),
      message: String(error?.message || ""),
    };
  }
  throw new Error("Expected login to fail");
}
