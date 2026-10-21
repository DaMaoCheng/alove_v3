import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const STRICT_DEPLOYMENT_FILES = String(process.env.STRICT_DEPLOYMENT_FILES || "false").trim().toLowerCase() === "true";

const REQUIRED_FILES = [
  "package.json",
  "package-lock.json",
  "embed/v1.js",
  "server/server.js",
  "database/schema.sql",
  "database/create-database.sql",
  "docs/deployment-checklist-2026-06-10.md",
  "docs/deployment/alove-page-rebuild.service.example",
  "docs/deployment/nginx-alove-page-rebuild.conf.example",
  "docs/deployment/server-runbook.md",
  "docs/knowledge-base/sources/football-epic-moments.md",
  "docs/knowledge-base/sources/football-tactics-managers.md",
  "docs/knowledge-base/sources/football-stadiums-kits.md",
  "docs/knowledge-base/sources/football-culture-awards.md",
  "docs/releases/2026-06-15-local-multisite-baseline.md",
  "scripts/create-deployment-archive.mjs",
  "scripts/deploy-server-release.mjs",
  "scripts/deploy-server-release-self-check.mjs",
  "scripts/deployment-runbook-self-check.mjs",
  "scripts/deployment-version-self-check.mjs",
  "uploads/.gitkeep",
  "uploads/avatars/.gitkeep",
  "uploads/carousel/.gitkeep",
  "uploads/chat/.gitkeep",
  "uploads/voice/.gitkeep",
];

for (const path of REQUIRED_FILES) {
  assert.ok(existsSync(path), `required deployment file is missing: ${path}`);
}

const gitignore = readFileSync(".gitignore", "utf8");
const requiredGitignoreRules = [
  "/uploads/**",
  "!/uploads/",
  "!/uploads/avatars/",
  "!/uploads/carousel/",
  "!/uploads/chat/",
  "!/uploads/voice/",
  "!/uploads/.gitkeep",
  "!/uploads/avatars/.gitkeep",
  "!/uploads/carousel/.gitkeep",
  "!/uploads/chat/.gitkeep",
  "!/uploads/voice/.gitkeep",
  "/database/*.sql.gz",
  "/dist/",
];

assert.equal(packageJson.scripts?.["package:deployment"], "node scripts/create-deployment-archive.mjs", "package.json should expose package:deployment");
assert.equal(packageJson.scripts?.["deploy:release"], "node scripts/deploy-server-release.mjs", "package.json should expose deploy:release");
runSelfCheck("scripts/deploy-server-release-self-check.mjs");
runSelfCheck("scripts/deployment-runbook-self-check.mjs");
runSelfCheck("scripts/deployment-version-self-check.mjs");

for (const rule of requiredGitignoreRules) {
  assert.ok(gitignore.includes(rule), `.gitignore should include ${rule}`);
}

const ignoredArtifacts = listIgnoredDeploymentArtifacts();
if (ignoredArtifacts.length) {
  const message = `ignored deployment artifacts exist locally and should not be uploaded: ${ignoredArtifacts.join(", ")}`;
  if (STRICT_DEPLOYMENT_FILES) {
    assert.fail(message);
  }
  console.warn(`[warn] ${message}`);
}

console.log("deployment files self-check passed");

function listIgnoredDeploymentArtifacts() {
  const artifacts = [];
  if (existsSync("database")) {
    for (const entry of readdirSync("database", { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".sql.gz")) artifacts.push(`database/${entry.name}`);
    }
  }
  return artifacts.sort();
}

function runSelfCheck(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], { stdio: "inherit" });
  assert.equal(result.status, 0, `${scriptPath} should pass`);
}
