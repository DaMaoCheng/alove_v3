import { securityHeaders } from "./security-response-utils.js";
import { isPublicError, normalizePublicCode } from "./public-error-utils.js";

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export function sendError(res, error, fallback = "Request failed. Please try again later.") {
  const statusCode = normalizeErrorStatusCode(error?.statusCode);
  sendJson(res, statusCode, {
    ok: false,
    error: resolvePublicErrorMessage(error, fallback, statusCode),
    code: resolvePublicErrorCode(error, statusCode),
  });
}

export function redirect(res, location, statusCode = 302) {
  res.writeHead(statusCode, { ...securityHeaders(), Location: location });
  res.end();
}

export function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, htmlHeaders());
  res.end(html);
}

export function htmlHeaders() {
  return {
    ...securityHeaders(),
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

function normalizeErrorStatusCode(value) {
  const statusCode = Number(value || 500);
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) return 500;
  return statusCode;
}

function resolvePublicErrorMessage(error, fallback, statusCode) {
  if ((statusCode < 500 && isPublicError(error)) || isControlledTtmallError(error)) return String(error.publicMessage);
  if (statusCode >= 500) return fallback;
  return DEFAULT_PUBLIC_ERROR_MESSAGES[statusCode] || "Invalid request.";
}

function resolvePublicErrorCode(error, statusCode) {
  if ((statusCode < 500 && error?.publicCode) || isControlledTtmallError(error)) return normalizePublicCode(error.publicCode);
  return DEFAULT_PUBLIC_ERROR_CODES[statusCode] || `HTTP_${statusCode}`;
}

function isControlledTtmallError(error) {
  return isPublicError(error) && /^TTMALL_[A-Z0-9_]+$/.test(String(error?.publicCode || ""));
}

const DEFAULT_PUBLIC_ERROR_MESSAGES = Object.freeze({
  400: "Invalid request.",
  401: "Please sign in first.",
  403: "Access denied.",
  404: "Not found.",
  409: "Request conflict.",
  413: "Request content is too large.",
  422: "Unable to process request.",
  429: "Too many requests. Please try again later.",
});

const DEFAULT_PUBLIC_ERROR_CODES = Object.freeze({
  400: "INVALID_REQUEST",
  401: "AUTH_REQUIRED",
  403: "ACCESS_DENIED",
  404: "NOT_FOUND",
  409: "REQUEST_CONFLICT",
  413: "REQUEST_TOO_LARGE",
  422: "UNPROCESSABLE_REQUEST",
  429: "TOO_MANY_REQUESTS",
});
