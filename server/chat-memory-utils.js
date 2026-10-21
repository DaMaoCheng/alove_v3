export function normalizeCharacterId(value) {
  return String(value || "").trim();
}

export function nullableText(value, maxLength = 0) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return maxLength ? normalized.slice(0, maxLength) : normalized;
}

export function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
