import { normalizeEmail, normalizeRequestIp, throwUserError } from "./auth-normalizers.js";

export const LOGIN_ERROR_MESSAGE = "Invalid email or password.";
export const LOGIN_THROTTLE_MESSAGE = "Too many sign-in attempts. Please try again later.";

const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LOCK_MS = 15 * 60 * 1000;
export const LOGIN_EMAIL_FAILURE_LIMIT = 5;
export const LOGIN_IP_FAILURE_LIMIT = 20;
const loginFailureBuckets = new Map();

export function assertLoginAllowed({ email = "", requestIp = "" } = {}) {
  for (const key of loginFailureKeys({ email, requestIp })) {
    const bucket = getActiveLoginFailureBucket(key);
    if (bucket?.lockedUntil && bucket.lockedUntil > Date.now()) {
      throwUserError(LOGIN_THROTTLE_MESSAGE, 429);
    }
  }
}

export function recordLoginFailure({ email = "", requestIp = "" } = {}) {
  pruneLoginFailureBuckets();
  const now = Date.now();
  for (const { key, limit } of loginFailureKeysWithLimits({ email, requestIp })) {
    const bucket = getActiveLoginFailureBucket(key) || { count: 0, firstFailureAt: now, lockedUntil: 0 };
    bucket.count += 1;
    if (bucket.count >= limit) {
      bucket.lockedUntil = now + LOGIN_FAILURE_LOCK_MS;
    }
    loginFailureBuckets.set(key, bucket);
  }
}

export function clearLoginFailures({ email = "", requestIp = "" } = {}) {
  for (const key of loginFailureKeys({ email, requestIp })) {
    loginFailureBuckets.delete(key);
  }
}

function getActiveLoginFailureBucket(key) {
  const bucket = loginFailureBuckets.get(key);
  if (!bucket) return null;
  const now = Date.now();
  const expired = bucket.lockedUntil
    ? bucket.lockedUntil <= now
    : bucket.firstFailureAt + LOGIN_FAILURE_WINDOW_MS <= now;
  if (expired) {
    loginFailureBuckets.delete(key);
    return null;
  }
  return bucket;
}

function loginFailureKeys({ email = "", requestIp = "" } = {}) {
  return loginFailureKeysWithLimits({ email, requestIp }).map((item) => item.key);
}

function loginFailureKeysWithLimits({ email = "", requestIp = "" } = {}) {
  return [
    email ? { key: `email:${normalizeEmail(email)}`, limit: LOGIN_EMAIL_FAILURE_LIMIT } : null,
    requestIp ? { key: `ip:${normalizeRequestIp(requestIp)}`, limit: LOGIN_IP_FAILURE_LIMIT } : null,
  ].filter(Boolean);
}

function pruneLoginFailureBuckets() {
  if (loginFailureBuckets.size < 5000) return;
  for (const key of loginFailureBuckets.keys()) {
    getActiveLoginFailureBucket(key);
  }
}
