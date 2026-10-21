export function createPublicError(message, statusCode = 400, code = "") {
  return markPublicError(new Error(message), { statusCode, message, code });
}

export function markPublicError(error, { statusCode, message, code = "" } = {}) {
  const target = error instanceof Error ? error : new Error(String(error || "Request failed"));
  if (statusCode) target.statusCode = statusCode;
  target.publicMessage = String(message || target.message || "").trim();
  target.publicCode = normalizePublicCode(code);
  return target;
}

export function isPublicError(error) {
  return Boolean(error?.publicMessage);
}

export function normalizePublicCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}
