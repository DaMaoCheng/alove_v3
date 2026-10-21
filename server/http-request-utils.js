import { isIP } from "node:net";
import { SERVER_CONFIG } from "./config.js";

export async function readJson(req, maxBytes = 1024 * 1024) {
  const raw = await readRequestBody(req, maxBytes);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求格式不正确");
    error.statusCode = 400;
    throw error;
  }
}

export async function readRequestBuffer(req, maxBytes = 1024 * 1024) {
  return readRequestBody(req, maxBytes, { asBuffer: true });
}

export function getRequestIp(req) {
  const remoteAddress = normalizeIp(req.socket?.remoteAddress || "");
  if (isTrustedProxyRequest(remoteAddress)) {
    const cloudflareIp = normalizeIp(req.headers["cf-connecting-ip"] || "");
    if (cloudflareIp) return cloudflareIp.slice(0, 64);

    const forwarded = readFirstForwardedIp(req.headers["x-forwarded-for"]);
    if (forwarded) return forwarded.slice(0, 64);
  }
  return remoteAddress.slice(0, 64);
}

export function isTrustedProxyRequest(remoteAddress) {
  if (!SERVER_CONFIG.security.trustProxy) return false;
  const normalizedRemote = normalizeIp(remoteAddress);
  if (!normalizedRemote) return false;
  return SERVER_CONFIG.security.trustedProxyIps.some((trustedIp) => matchesTrustedIp(normalizedRemote, trustedIp));
}

function readFirstForwardedIp(value) {
  return normalizeIp(String(value || "").split(",")[0] || "");
}

function matchesTrustedIp(remoteAddress, trustedIp) {
  if (String(trustedIp || "").includes("/")) {
    return matchesIpv4Cidr(remoteAddress, String(trustedIp || "").trim());
  }
  const normalizedTrusted = normalizeIp(trustedIp);
  if (!normalizedTrusted) return false;
  if (remoteAddress === normalizedTrusted) return true;
  return false;
}

function matchesIpv4Cidr(remoteAddress, trustedIp) {
  const [rangeIp, bitsText] = String(trustedIp || "").split("/");
  if (!rangeIp || bitsText == null) return false;
  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const remoteNumber = ipv4ToNumber(remoteAddress);
  const rangeNumber = ipv4ToNumber(rangeIp);
  if (remoteNumber == null || rangeNumber == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (remoteNumber & mask) === (rangeNumber & mask);
}

function normalizeIp(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const withoutMappedPrefix = text.startsWith("::ffff:") ? text.slice(7) : text;
  if (isIP(withoutMappedPrefix)) return withoutMappedPrefix;
  return "";
}

function ipv4ToNumber(value) {
  if (isIP(value) !== 4) return null;
  return value.split(".").reduce((result, part) => ((result << 8) + Number(part)) >>> 0, 0);
}

function readRequestBody(req, maxBytes, { asBuffer = false } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      chunks.push(chunk);
      if (totalBytes > maxBytes) {
        const error = new Error("请求内容过大");
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve(asBuffer ? buffer : buffer.toString("utf8"));
    });
    req.on("error", reject);
  });
}
