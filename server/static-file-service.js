import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { PROJECT_ROOT } from "./config.js";
import { htmlHeaders, sendJson } from "./http-response-utils.js";
import { securityHeaders } from "./security-response-utils.js";

const STATIC_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".rtf": "application/rtf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});

const ROOT_INDEX_FILE = "index.html";
const NORMALIZED_PROJECT_ROOT = resolve(PROJECT_ROOT);
const PUBLIC_STATIC_PREFIXES = Object.freeze([
  "assets/",
  "embed/",
  "src/",
  "shared/",
  "uploads/avatars/",
  "uploads/mascot-greetings/",
  "uploads/carousel/",
  "uploads/voice/presets/",
  "privacy/",
  "terms/",
]);
const BLOCKED_STATIC_PREFIXES = Object.freeze([
  "server/",
  "logs/",
  "database/",
  "docs/",
  "scripts/",
  "node_modules/",
  "dist/",
  "test-results/",
]);

export async function serveStatic(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(requestUrl.pathname || "/");
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const relativePath = safePath === "/" ? "index.html" : safePath.replace(/^[/\\]/, "");
  if (!isPublicStaticPath(relativePath)) {
    if (shouldServeAppShell(pathname, relativePath)) {
      return sendRootIndexHtml(res);
    }
    sendJson(res, 404, { ok: false, error: "Not found" });
    return true;
  }

  const candidatePaths = resolvePublicStaticCandidates(relativePath);
  for (const filePath of candidatePaths) {
    try {
      const content = await readFile(filePath);
      const contentType = STATIC_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, staticHeaders(contentType));
      res.end(content);
      return true;
    } catch {
      continue;
    }
  }

  if (shouldServeAppShell(pathname)) {
    return sendRootIndexHtml(res);
  }
  sendJson(res, 404, { ok: false, error: "Not found" });
  return true;
}

function staticHeaders(contentType) {
  const shouldAvoidCache = contentType.startsWith("text/html") || contentType.startsWith("text/javascript") || contentType.startsWith("text/css");
  return {
    ...securityHeaders(),
    "Content-Type": contentType,
    ...(shouldAvoidCache ? { "Cache-Control": "no-store" } : {}),
  };
}

function isPublicStaticPath(relativePath = "") {
  if (!relativePath || hasHiddenPathSegment(relativePath)) return false;
  if (relativePath === ROOT_INDEX_FILE) return true;
  return PUBLIC_STATIC_PREFIXES.some((prefix) => relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix));
}

function resolvePublicStaticCandidates(relativePath = "") {
  if (relativePath === ROOT_INDEX_FILE) {
    return [resolve(PROJECT_ROOT, ROOT_INDEX_FILE)];
  }

  const normalizedPath = relativePath.replace(/[/\\]+$/, "");
  const filePath = resolve(PROJECT_ROOT, normalizedPath);
  if (!isWithinProjectRoot(filePath)) return [];
  if (!extname(normalizedPath)) {
    return [resolve(filePath, ROOT_INDEX_FILE), filePath];
  }
  return [filePath];
}

function isWithinProjectRoot(filePath = "") {
  return filePath === NORMALIZED_PROJECT_ROOT || filePath.startsWith(`${NORMALIZED_PROJECT_ROOT}${sep}`);
}

function hasHiddenPathSegment(relativePath = "") {
  return String(relativePath || "")
    .split(/[/\\]+/)
    .some((segment) => segment.startsWith("."));
}

function shouldServeAppShell(pathname = "", relativePath = "") {
  const normalizedPath = String(pathname || "").trim();
  if (hasHiddenPathSegment(relativePath)) return false;
  if (BLOCKED_STATIC_PREFIXES.some((prefix) => relativePath.startsWith(prefix) || relativePath === prefix.slice(0, -1))) {
    return false;
  }
  if (!normalizedPath || normalizedPath === "/") return true;
  return !extname(normalizedPath);
}

async function sendRootIndexHtml(res) {
  const html = await readFile(resolve(PROJECT_ROOT, ROOT_INDEX_FILE));
  res.writeHead(200, htmlHeaders());
  res.end(html);
  return true;
}
