import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  ".git",
  ".codex-backups",
  "node_modules",
  "uploads",
  "dist",
  "build",
  "coverage",
  ".next",
  ".inspect_",
  "test-results",
]);
const SKIP_FILES = new Set([
  ".env",
  ".env.local",
  "package-lock.json",
]);
const SKIP_SUFFIXES = [
  ".local",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp3",
  ".mp4",
  ".m4a",
  ".webm",
  ".ogg",
  ".wav",
  ".gz",
  ".zip",
  ".tar",
];
const ALLOWED_VALUES = new Set([
  "replace_with_clcl_key",
  "replace_with_elevenlabs_key",
  "change_me",
]);

const WHOLE_FILE_PATTERNS = [
  ["OpenAI-compatible API key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]+\b/g],
  ["Shopify access token", /\bshp(?:at|ca|ua|ss)_[A-Za-z0-9]{20,}\b/g],
];
const SECRET_ENV_ASSIGNMENT = /^\s*(OPENAI_API_KEY|OPENAI_FALLBACK_API_KEY|VENICE_API_KEY|BRAVE_SEARCH_API_KEY|GOOGLE_CLIENT_SECRET|SMTP_PASSWORD|IMAGE_GENERATION_API_KEY|ELEVENLABS_API_KEY|ELEVENLABS_STT_API_KEY|SHOPIFY_ADMIN_ACCESS_TOKEN|PRODUCT_API_SECRET_KEY|APP_SECRET)\s*=\s*([^#\r\n]*)/;
const MYSQL_IDENTIFIED_BY = /\bIDENTIFIED\s+BY\s+(['"])(.*?)\1/i;
const GMAIL_APP_PASSWORD = /\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b/;
const LOCAL_ENV_PATH = join(ROOT, ".env.local");
const LOCAL_SECRET_ENV_KEYS = new Set([
  "OPENAI_API_KEY",
  "OPENAI_FALLBACK_API_KEY",
  "VENICE_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "SMTP_PASSWORD",
  "IMAGE_GENERATION_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_STT_API_KEY",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "PRODUCT_API_SECRET_KEY",
  "APP_SECRET",
  "DB_PASSWORD",
]);

const findings = [];
const localSecretValues = await loadLocalSecretValues();
for await (const filePath of walk(ROOT)) {
  const text = await readFile(filePath, "utf8").catch(() => "");
  if (!text) continue;
  const rel = relative(ROOT, filePath);
  scanWholeFilePatterns({ rel, text });
  scanLinePatterns({ rel, text });
  scanLocalSecretValueLeaks({ rel, text });
}

assert.deepEqual(findings, [], `potential secret leaks found:\n${findings.join("\n")}`);
console.log("secret leak self-check passed");

function scanWholeFilePatterns({ rel, text }) {
  for (const [label, pattern] of WHOLE_FILE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[1] || match[0];
      if (isAllowedPlaceholder(value)) continue;
      findings.push(`${rel}: ${label}`);
    }
  }
}

function scanLinePatterns({ rel, text }) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const assignment = line.match(SECRET_ENV_ASSIGNMENT);
    if (assignment && !isAllowedPlaceholder(assignment[2])) {
      findings.push(`${rel}:${index + 1}: filled secret env assignment`);
    }
    if (/SMTP_PASSWORD|app password/i.test(line) && GMAIL_APP_PASSWORD.test(line)) {
      findings.push(`${rel}:${index + 1}: Gmail app password`);
    }
    const mysqlPassword = line.match(MYSQL_IDENTIFIED_BY);
    if (mysqlPassword && !isAllowedPlaceholder(mysqlPassword[2])) {
      findings.push(`${rel}:${index + 1}: MySQL password literal`);
    }
  }
}

function scanLocalSecretValueLeaks({ rel, text }) {
  if (!localSecretValues.length) return;
  for (const secret of localSecretValues) {
    if (!text.includes(secret.value)) continue;
    findings.push(`${rel}: leaked value from local env key ${secret.key}`);
  }
}

async function loadLocalSecretValues() {
  if (!existsSync(LOCAL_ENV_PATH)) return [];
  const text = await readFile(LOCAL_ENV_PATH, "utf8").catch(() => "");
  if (!text) return [];
  const values = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const assignment = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
    if (!assignment) continue;
    const key = assignment[1];
    const value = normalizeEnvValue(assignment[2]);
    if (!LOCAL_SECRET_ENV_KEYS.has(key)) continue;
    if (!value || isAllowedPlaceholder(value)) continue;
    if (value.length < 8) continue;
    values.push({ key, value });
  }
  return dedupeSecretValues(values);
}

function dedupeSecretValues(values) {
  const seen = new Set();
  return values.filter(({ key, value }) => {
    const marker = `${key}:${value}`;
    if (seen.has(marker)) return false;
    seen.add(marker);
    return true;
  });
}

function normalizeEnvValue(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldSkipEntry(entry)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (!entry.isFile() || shouldSkipFile(entry.name)) continue;
    yield path;
  }
}

function shouldSkipEntry(entry) {
  if (!entry?.name) return true;
  if (SKIP_DIRS.has(entry.name)) return true;
  return entry.isDirectory() && entry.name.startsWith(".inspect_");
}

function shouldSkipFile(name) {
  if (SKIP_FILES.has(name)) return true;
  if (name.startsWith(".env.")) return true;
  return SKIP_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isAllowedPlaceholder(value) {
  const normalized = normalizeEnvValue(value);
  if (!normalized) return true;
  if (ALLOWED_VALUES.has(normalized)) return true;
  return normalized.startsWith("replace_with_");
}
