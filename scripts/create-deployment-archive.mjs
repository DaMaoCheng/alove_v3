import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = process.env.DEPLOY_ARCHIVE_DIR || "dist";
const OUTPUT_NAME = process.env.DEPLOY_ARCHIVE_NAME || "alove-page-rebuild-deploy.tar.gz";
const OUTPUT_PATH = join(OUTPUT_DIR, OUTPUT_NAME);
const CHECKSUM_PATH = `${OUTPUT_PATH}.sha256`;
const OUTPUT_VERSION_PATH = `${OUTPUT_PATH.replace(/\.tar\.gz$/, "")}.version.json`;
const RELEASE_ID = process.env.DEPLOY_RELEASE_ID || "2026-06-15-local-multisite-baseline";
const RELEASE_NOTES_PATH = `docs/releases/${RELEASE_ID}.md`;
const VERSION_METADATA_PATH = "docs/releases/current-deployment.json";

const INCLUDE_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  ".env.example",
  ".gitignore",
  "README.md",
  "index.html",
  "assets",
  "embed",
  "database/create-database.sql",
  "database/schema.sql",
  "docs/deployment-checklist-2026-06-10.md",
  "docs/deployment/alove-page-rebuild.service.example",
  "docs/deployment/nginx-alove-page-rebuild.conf.example",
  "docs/deployment/server-runbook.md",
  "docs/knowledge-base",
  "docs/releases",
  "logs/bugs/README.md",
  "logs/updates/2026-06-15.md",
  "scripts",
  "server",
  "shared",
  "src",
  "uploads/.gitkeep",
  "uploads/avatars/.gitkeep",
  "uploads/carousel/.gitkeep",
  "uploads/chat/.gitkeep",
  "uploads/voice/.gitkeep",
  "uploads/voice/presets",
]);

const FORBIDDEN_ARCHIVE_PATTERNS = [
  /^__MACOSX\//,
  /(^|\/)\._[^/]+$/,
  /^\.env$/,
  /^\.env\.local$/,
  /^\.env\..*\.local$/,
  /^node_modules\//,
  /^docs\/project-todo\.md$/,
  /^database\/.*\.sql\.gz$/,
  /^uploads\/(?!\.gitkeep$|avatars\/\.gitkeep$|carousel\/\.gitkeep$|chat\/\.gitkeep$|voice\/\.gitkeep$|voice\/presets\/|voice\/presets\/.*\.mp3$)/,
  /^dist\//,
  /^\.git\//,
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.codex-artifacts(\/|$)/,
  /\.backup-[^/]+$/,
  /\.bak(?:\.[^/]+|-[^/]+)?$/,
];

await run("npm", ["run", "check:deployment"]);

mkdirSync(OUTPUT_DIR, { recursive: true });
rmSync(OUTPUT_PATH, { force: true });
rmSync(CHECKSUM_PATH, { force: true });
rmSync(OUTPUT_VERSION_PATH, { force: true });
const sourceMetadata = buildVersionMetadata({ archiveChecksum: "" });
writeVersionMetadata(VERSION_METADATA_PATH, sourceMetadata);

for (const path of INCLUDE_PATHS) {
  assert.ok(existsSync(path), `deployment archive input is missing: ${path}`);
}

await run("tar", [
  "-czf",
  OUTPUT_PATH,
  "--exclude=*.backup-*",
  "--exclude=*.bak",
  "--exclude=*.bak-*",
  "--exclude=.DS_Store",
  "--exclude=.codex-artifacts",
  ...INCLUDE_PATHS,
], { env: { COPYFILE_DISABLE: "1" } });
const checksum = createHash("sha256").update(readFileSync(OUTPUT_PATH)).digest("hex");
assert.match(checksum, /^[a-f0-9]{64}$/, "deployment archive checksum should be a SHA-256 hex digest");
const packageMetadata = buildVersionMetadata({ archiveChecksum: checksum });
writeVersionMetadata(OUTPUT_VERSION_PATH, packageMetadata);
writeFileSync(CHECKSUM_PATH, `${checksum}  ${OUTPUT_NAME}\n`, "utf8");
const checksumFile = readFileSync(CHECKSUM_PATH, "utf8").trim();
assert.equal(checksumFile, `${checksum}  ${OUTPUT_NAME}`, "deployment checksum file should match archive checksum and basename");
const archiveEntries = (await capture("tar", ["-tzf", OUTPUT_PATH])).trim().split(/\r?\n/).filter(Boolean);

for (const entry of archiveEntries) {
  const normalized = entry.replace(/^\.\//, "");
  for (const pattern of FORBIDDEN_ARCHIVE_PATTERNS) {
    assert.ok(!pattern.test(normalized), `deployment archive contains forbidden entry: ${normalized}`);
  }
}

for (const requiredEntry of [
  "package.json",
  "embed/v1.js",
  "server/server.js",
  "shared/voice-presets.js",
  "database/schema.sql",
  "database/create-database.sql",
  "docs/releases/current-deployment.json",
  "docs/knowledge-base/sources/football-epic-moments.md",
  "docs/knowledge-base/sources/football-tactics-managers.md",
  "docs/knowledge-base/sources/football-stadiums-kits.md",
  "docs/knowledge-base/sources/football-culture-awards.md",
  RELEASE_NOTES_PATH,
  "uploads/avatars/.gitkeep",
  "uploads/carousel/.gitkeep",
  "uploads/chat/.gitkeep",
  "uploads/voice/.gitkeep",
  "uploads/voice/presets/nova.mp3",
]) {
  assert.ok(archiveEntries.includes(requiredEntry), `deployment archive should include ${requiredEntry}`);
}

console.log(`deployment archive created: ${OUTPUT_PATH}`);
console.log(`deployment archive checksum created: ${CHECKSUM_PATH}`);
console.log(`deployment source metadata included: ${VERSION_METADATA_PATH}`);
console.log(`deployment package metadata created: ${OUTPUT_VERSION_PATH}`);

function buildVersionMetadata({ archiveChecksum }) {
  mkdirSync("docs/releases", { recursive: true });
  assert.ok(existsSync(RELEASE_NOTES_PATH), `release notes are missing: ${RELEASE_NOTES_PATH}`);
  return {
    releaseId: RELEASE_ID,
    releaseNotes: RELEASE_NOTES_PATH,
    packageName: OUTPUT_NAME,
    packagePath: OUTPUT_PATH,
    archiveSha256: archiveChecksum,
    createdAt: new Date().toISOString(),
    git: {
      branch: captureSync("git", ["branch", "--show-current"]),
      commit: captureSync("git", ["rev-parse", "HEAD"]),
      shortCommit: captureSync("git", ["rev-parse", "--short", "HEAD"]),
      dirtyFileCount: captureSync("git", ["status", "--short"]).split(/\r?\n/).filter(Boolean).length,
    },
    verification: [
      "npm run check:deployment",
      "npm run package:deployment",
      `cd ${JSON.stringify(OUTPUT_DIR)} && sha256sum -c ${JSON.stringify(`${OUTPUT_NAME}.sha256`)}`,
    ],
  };
}

function writeVersionMetadata(path, metadata) {
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function captureSync(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...(options.env || {}) },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed with ${signal || code}: ${stderr}`));
    });
  });
}
