import { buildApiUrl } from "../config/api-config.js";

export class ApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function requestJson(path, { method = "GET", body = null, headers = {}, notifyUnauthorized = true, signal } = {}) {
  const response = await fetch(buildApiUrl(path), {
    method,
    signal,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : null,
  });

  const payload = await readJsonPayload(response);
  if (!response.ok || payload?.ok === false) {
    if (response.status === 401 && notifyUnauthorized) {
      notifyAuthExpired({ path, payload, status: response.status });
    }
    throw new ApiError(resolveErrorMessage(payload, response), {
      status: response.status,
      payload,
    });
  }

  return payload;
}

async function readJsonPayload(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("服务返回异常，请稍后再试", { status: response.status });
  }
}

function resolveErrorMessage(payload, response) {
  const message = String(payload?.error || payload?.message || "").trim();
  if (message) return message;
  if (response.status === 401) return "登录状态异常，请重新登录";
  return "服务暂时繁忙，请稍后再试";
}

function notifyAuthExpired(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("aiove:auth-expired", { detail }));
}
