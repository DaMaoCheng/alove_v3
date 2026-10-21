import { createPublicError } from "./public-error-utils.js";

export function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function normalizeNickname(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 64);
}

export function normalizeLocale(locale = "cn") {
  return String(locale || "").trim().toLowerCase() === "en" ? "en" : "cn";
}

export function normalizeSiteSlug(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 96);
}

export function normalizeInviteCode(value = "") {
  return String(value || "").replace(/\s+/g, "").trim().toUpperCase().slice(0, 64);
}

export function normalizeAccountType(value = "personal") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["personal", "creator", "admin"].includes(normalized) ? normalized : "personal";
}

export function normalizeCodeScene(scene = "register") {
  return String(scene || "").trim() === "forgot_password" ? "forgot_password" : "register";
}

export function normalizeRequestIp(value = "") {
  return String(value || "").split(",")[0].trim().slice(0, 64);
}

export function throwUserError(message, statusCode = 400) {
  throw createPublicError(message, statusCode);
}
