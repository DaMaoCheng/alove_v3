import { SERVER_CONFIG } from "./config.js";

export function setAuthCookie(res, token, maxAgeSeconds) {
  const cookie = [
    `${SERVER_CONFIG.authCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...secureCookieAttribute(),
    `Max-Age=${Math.max(0, Number(maxAgeSeconds || 0))}`,
  ];
  res.setHeader("Set-Cookie", cookie.join("; "));
}

export function setCookie(res, name, value, { maxAgeSeconds = 600, httpOnly = true } = {}) {
  appendSetCookie(res, [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    ...(httpOnly ? ["HttpOnly"] : []),
    "SameSite=Lax",
    ...secureCookieAttribute(),
    `Max-Age=${Math.max(0, Number(maxAgeSeconds || 0))}`,
  ].join("; "));
}

export function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", [
    `${SERVER_CONFIG.authCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...secureCookieAttribute(),
    "Max-Age=0",
  ].join("; "));
}

export function readAuthToken(req) {
  return readCookie(req, SERVER_CONFIG.authCookieName);
}

export function readCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || "");
  for (const segment of cookieHeader.split(/;\s*/)) {
    const index = segment.indexOf("=");
    if (index <= 0) continue;
    if (segment.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(segment.slice(index + 1).trim());
    } catch {
      return segment.slice(index + 1).trim();
    }
  }
  return "";
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  res.setHeader("Set-Cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function secureCookieAttribute() {
  return SERVER_CONFIG.security.cookieSecure ? ["Secure"] : [];
}
