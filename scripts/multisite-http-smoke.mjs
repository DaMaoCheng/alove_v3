import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHAT_ATTACHMENT_UPLOAD_POLICY } from "../server/upload-policies.js";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4173";
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 10000);
const IS_LOCAL_BASE_URL = isLocalBaseUrl(BASE_URL);
const EXPECT_LOCAL_DEFAULT_SITE = String(process.env.SMOKE_EXPECT_LOCAL_DEFAULT_SITE || "true").trim().toLowerCase() !== "false";
const UPLOAD_SMOKE_FILE_NAME = "multisite-smoke.txt";
const UPLOAD_SMOKE_CONTENT = "multisite-upload-static-ok\n";
const SENSITIVE_STATIC_PATHS = [
  "/.env.local",
  "/server/config.js",
  "/.git/config",
  "/docs/current-workspace.md",
];

const checks = [
  {
    label: "health check returns ok",
    path: "/api/health",
    method: "GET",
    expectStatus: 200,
    validateJson: (body) => {
      assert.equal(body.ok, true, "health check should return ok=true");
      assert.equal(body.status, "ok", "health check should return status=ok");
      assert.equal(body.service, "aiove-page-rebuild", "health check should identify the service");
    },
  },
  {
    label: "site resolve returns a valid site",
    path: "/api/site/resolve",
    method: "GET",
    expectStatus: 200,
    validateJson: (body) => {
      assert.equal(body.ok, true, "site resolve should return ok=true");
      assert.ok(body.siteId, "site resolve should return siteId");
      assert.ok(body.siteSlug, "site resolve should return siteSlug");
      assert.ok(body.siteName, "site resolve should return siteName");
      if (IS_LOCAL_BASE_URL && EXPECT_LOCAL_DEFAULT_SITE) {
        assert.equal(body.siteId, "site_gg", "local/private smoke should resolve to GG default site");
        assert.equal(body.siteSlug, "gogoalshop", "local/private smoke should resolve to gogoalshop");
        assert.equal(body.matchLevel, "default", "local/private smoke should use default match level");
      }
    },
  },
  {
    label: "default site login page loads",
    path: "/gogoalshop/login",
    method: "HEAD",
    expectStatus: 200,
    expectContentType: "text/html",
  },
  {
    label: "UK site discover page loads",
    path: "/footballkituk/discover",
    method: "HEAD",
    expectStatus: 200,
    expectContentType: "text/html",
  },
  {
    label: "admin sites page shell requires auth",
    path: "/admin?view=sites",
    method: "HEAD",
    expectStatus: 401,
  },
  {
    label: "frontend entry module is served as JavaScript under site routing",
    path: "/src/app/main.js",
    method: "HEAD",
    expectStatus: 200,
    expectContentType: "javascript",
  },
  ...SENSITIVE_STATIC_PATHS.map((path) => ({
    label: `sensitive static path stays blocked: ${path}`,
    path,
    method: "HEAD",
    expectStatus: 404,
  })),
  ...(IS_LOCAL_BASE_URL
    ? [
        {
          label: "chat upload static path stays private",
          path: `${CHAT_ATTACHMENT_UPLOAD_POLICY.publicPath}/${UPLOAD_SMOKE_FILE_NAME}`,
          method: "GET",
          expectStatus: 404,
        },
      ]
    : []),
];

await setupLocalUploadSmokeFile();
try {
  for (const check of checks) {
    await runCheck(check);
  }
} finally {
  await cleanupLocalUploadSmokeFile();
}

console.log(`multisite HTTP smoke passed against ${BASE_URL}`);

function isLocalBaseUrl(value) {
  const url = new URL(value);
  return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

async function setupLocalUploadSmokeFile() {
  if (!IS_LOCAL_BASE_URL) return;
  await mkdir(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, { recursive: true });
  await writeFile(localUploadSmokeFilePath(), UPLOAD_SMOKE_CONTENT, "utf8");
}

async function cleanupLocalUploadSmokeFile() {
  if (!IS_LOCAL_BASE_URL) return;
  await rm(localUploadSmokeFilePath(), { force: true });
}

function localUploadSmokeFilePath() {
  return join(CHAT_ATTACHMENT_UPLOAD_POLICY.uploadDir, UPLOAD_SMOKE_FILE_NAME);
}

async function runCheck(check) {
  const url = new URL(check.path, BASE_URL);
  const response = await fetchWithTimeout(url, { method: check.method });
  assert.equal(response.status, check.expectStatus, `${check.label}: expected HTTP ${check.expectStatus}, got ${response.status}`);

  if (check.expectContentType) {
    const contentType = response.headers.get("content-type") || "";
    assert.ok(contentType.includes(check.expectContentType), `${check.label}: expected content-type to include ${check.expectContentType}, got ${contentType}`);
  }

  if (check.validateJson) {
    const body = await response.json();
    check.validateJson(body);
  }

  if (check.validateText) {
    const body = await response.text();
    check.validateText(body);
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
