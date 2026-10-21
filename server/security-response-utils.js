import { SERVER_CONFIG } from "./config.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
    "Content-Security-Policy": cspEnforcedPolicy(),
    ...(SERVER_CONFIG.security.cspReportOnlyEnabled
      ? { "Content-Security-Policy-Report-Only": cspReportOnlyPolicy() }
      : {}),
    "X-Frame-Options": "SAMEORIGIN",
    ...(SERVER_CONFIG.security.hstsEnabled && SERVER_CONFIG.security.hstsMaxAgeSeconds > 0
      ? { "Strict-Transport-Security": `max-age=${SERVER_CONFIG.security.hstsMaxAgeSeconds}; includeSubDomains` }
      : {}),
  };
}

function cspEnforcedPolicy() {
  return [
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

function cspReportOnlyPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
    "font-src 'self' data: https://cdn.fontshare.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' ws: wss:",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export function shouldRedirectToHttps(req) {
  if (!SERVER_CONFIG.security.forceHttps) return false;
  const host = requestHost(req);
  if (!host || LOCAL_HOSTS.has(host)) return false;
  return !isHttpsRequest(req);
}

export function buildHttpsRedirectUrl(req) {
  const host = req.headers.host || new URL(SERVER_CONFIG.publicBaseUrl).host;
  return `https://${host}${req.url || "/"}`;
}

function isHttpsRequest(req) {
  if (req.socket?.encrypted) return true;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (forwardedProto.includes("https")) return true;

  const cloudflareScheme = readCloudflareVisitorScheme(req);
  if (cloudflareScheme === "https") return true;

  const forwardedSsl = String(req.headers["x-forwarded-ssl"] || "").trim().toLowerCase();
  if (forwardedSsl === "on") return true;

  const frontendHttps = String(req.headers["front-end-https"] || "").trim().toLowerCase();
  return frontendHttps === "on" || frontendHttps === "https";
}

function requestHost(req) {
  const rawHost = String(req.headers.host || "").trim();
  if (!rawHost) return "";
  try {
    return new URL(`http://${rawHost}`).hostname;
  } catch {
    return rawHost.split(":")[0].toLowerCase();
  }
}

function readCloudflareVisitorScheme(req) {
  const rawValue = String(req.headers["cf-visitor"] || "").trim();
  if (!rawValue) {
    return req.headers["cf-ray"] ? "https" : "";
  }
  try {
    const parsed = JSON.parse(rawValue);
    return String(parsed?.scheme || "").trim().toLowerCase();
  } catch {
    return "";
  }
}
