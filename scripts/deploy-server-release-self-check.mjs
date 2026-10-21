import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "scripts/deploy-server-release.mjs";
assert.ok(existsSync(scriptPath), `release deploy script should exist: ${scriptPath}`);

const script = readFileSync(scriptPath, "utf8");

for (const text of [
  "Default mode is dry-run",
  "--execute",
  "DEPLOY_ROOT",
  "DEPLOY_SERVICE",
  "DEPLOY_LOCAL_BASE_URL",
  "DEPLOY_PUBLIC_BASE_URL",
  "DEPLOY_SSH_BIND_ADDRESS",
  "DEPLOY_USE_SUDO",
  "DEPLOY_PRUNE_RELEASES",
  "docs/releases/current-deployment.json",
  "archiveSha256",
  "sha256sum -c",
  "npm ci --omit=dev",
  "node scripts/creator-character-owner-audit.mjs",
  ".env.local",
  "SHARED_UPLOADS",
  "shared uploads",
  "SHARED_ENV",
  "mysqldump",
  "database backup:",
  "ln -sfn",
  "current ->",
  "serviceCtl restart",
  "waitForHealth",
  "set -Eeuo pipefail",
  "rollbackOnError",
  "CURRENT_SWITCHED=true",
  "previous release restored after failed verification",
  "$LOCAL_BASE_URL/api/health",
  "multisite-http-smoke.mjs",
  "SMOKE_BASE_URL",
  "curl -fsS \"$url\"",
  "rollback shape",
]) {
  assert.ok(script.includes(text), `release deploy script should include: ${text}`);
}

for (const forbidden of [
  "sk-",
  "GOCSPX-",
  "password:",
]) {
  assert.ok(!script.includes(forbidden), `release deploy script should not contain secret-like text: ${forbidden}`);
}

const fixture = createDryRunFixture();
const dryRun = spawnSync(process.execPath, [scriptPath], {
  encoding: "utf8",
  env: {
    ...process.env,
    DEPLOY_ARCHIVE: fixture.archivePath,
    DEPLOY_CHECKSUM: fixture.checksumPath,
    DEPLOY_VERSION: fixture.versionPath,
  },
});
const compatDryRun = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env: { ...process.env,
  DEPLOY_ARCHIVE: fixture.archivePath, DEPLOY_CHECKSUM: fixture.checksumPath, DEPLOY_VERSION: fixture.versionPath,
  DEPLOY_ROLLBACK_TARGET: "/srv/alove-new/releases/compat-rollback-fixture" } });
const outsideDryRun = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env: { ...process.env,
  DEPLOY_ARCHIVE: fixture.archivePath, DEPLOY_CHECKSUM: fixture.checksumPath, DEPLOY_VERSION: fixture.versionPath,
  DEPLOY_ROLLBACK_TARGET: "/srv/alove-new/releases/../../outside" } });
const pruneCompat = spawnSync(process.execPath, [scriptPath], { encoding: "utf8", env: { ...process.env,
  DEPLOY_ARCHIVE: fixture.archivePath, DEPLOY_CHECKSUM: fixture.checksumPath, DEPLOY_VERSION: fixture.versionPath,
  DEPLOY_ROLLBACK_TARGET: "/srv/alove-new/releases/compat-rollback-fixture", DEPLOY_PRUNE_RELEASES: "true" } });
rmSync(fixture.root, { recursive: true, force: true });

assert.notEqual(pruneCompat.status, 0, "Compatible rollback must keep its old dependency release");
assert.equal(compatDryRun.status, 0);
assert.match(compatDryRun.stdout, /compat-rollback-fixture/);
assert.notEqual(outsideDryRun.status, 0, "A compatibility target cannot escape this project releases directory");
assert.equal(dryRun.status, 0, "release deploy script dry-run should exit successfully");
assert.match(dryRun.stdout, /mode: dry-run/, "dry-run output should show dry-run mode");
assert.match(dryRun.stdout, /SSH bind address:/, "dry-run output should show the SSH route selection");
assert.match(dryRun.stdout, /No server changes were made/, "dry-run output should confirm no server changes");
assert.doesNotMatch(dryRun.stdout, /release deployment completed/, "dry-run should not report completed deployment");

const waitForHealthSource = script.match(/waitForHealth\(\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(waitForHealthSource, "release deploy script should expose the health wait function to the behavior check");
assert.match(waitForHealthSource, /return 1/, "health exhaustion should return failure so ERR trap can roll back");
assert.doesNotMatch(waitForHealthSource, /exit 1/, "health exhaustion must not bypass the ERR trap");

const rollbackMarkerRoot = mkdtempSync(join(tmpdir(), "alove-release-rollback-check-"));
const rollbackMarker = join(rollbackMarkerRoot, "rollback-triggered");
const rollbackBehavior = spawnSync("bash", ["-c", `
set -Eeuo pipefail
${waitForHealthSource.replace("attempts=30", "attempts=1").replace("delay=1", "delay=0")}
rollbackOnError() {
  printf 'triggered\\n' > "$ROLLBACK_MARKER"
}
trap rollbackOnError ERR
waitForHealth "forced" "http://127.0.0.1:1/unreachable"
`], {
  encoding: "utf8",
  env: { ...process.env, ROLLBACK_MARKER: rollbackMarker },
});
assert.notEqual(rollbackBehavior.status, 0, "failed health check should fail the deployment shell");
assert.ok(existsSync(rollbackMarker), "failed health check should trigger the rollback trap");
rmSync(rollbackMarkerRoot, { recursive: true, force: true });

const selector = script.match(/selectRollbackTarget\(\) \{[\s\S]*?\n\}/)?.[0];
assert(selector);
const compatibleRoot = mkdtempSync(join(tmpdir(), "alove-compatible-rollback-check-"));
const releases = join(compatibleRoot, "releases"); const good = join(releases, "good"); const outside = join(compatibleRoot, "outside");
mkdirSync(join(good, "server"), { recursive: true }); writeFileSync(join(good, "server/server.js"), "fixture");
mkdirSync(join(outside, "server"), { recursive: true }); writeFileSync(join(outside, "server/server.js"), "fixture");
const escape = join(releases, "escape"); symlinkSync(outside, escape);
try {
for (const [target, succeeds] of [["", true], [good, true], [join(releases, "missing"), false], [outside, false], [escape, false]]) {
  const result = spawnSync("bash", ["-c", `set -e
${selector}
PREVIOUS_TARGET=old
selectRollbackTarget
[ -z "$ROLLBACK_TARGET" ] || [ "$PREVIOUS_TARGET" = "$(readlink -f "$ROLLBACK_TARGET")" ]`],
    { encoding: "utf8", env: { ...process.env, ROLLBACK_TARGET: target, RELEASES_DIR: releases } });
  assert.equal(result.status === 0, succeeds, "verified rollback selector: " + target);
}
const legacyCurrent = join(compatibleRoot, "current"); mkdirSync(legacyCurrent);
const legacyDestination = join(releases, "legacy");
assert(script.indexOf("selectRollbackTarget\ncd") < script.indexOf('mv "$CURRENT_LINK" "$LEGACY_DIR"'));
const legacyFailure = spawnSync("bash", ["-c", `set -e
${selector}
PREVIOUS_TARGET=
selectRollbackTarget
mv "$CURRENT_LINK" "$LEGACY_DIR"`],
  { encoding: "utf8", env: { ...process.env, RELEASES_DIR: releases, ROLLBACK_TARGET: join(releases, "missing"), CURRENT_LINK: legacyCurrent, LEGACY_DIR: legacyDestination } });
assert.notEqual(legacyFailure.status, 0); assert(existsSync(legacyCurrent)); assert(!existsSync(legacyDestination));
} finally { rmSync(compatibleRoot, { recursive: true, force: true }); }
console.log("release deploy script self-check passed");

function createDryRunFixture() {
  const root = mkdtempSync(join(tmpdir(), "alove-release-dry-run-"));
  const archivePath = join(root, "fixture.tar.gz");
  const checksumPath = `${archivePath}.sha256`;
  const versionPath = join(root, "fixture.version.json");
  const sourcePath = join(root, "fixture.txt");
  writeFileSync(sourcePath, "dry-run fixture\n", "utf8");
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", root, "fixture.txt"], { encoding: "utf8" });
  assert.equal(tar.status, 0, `dry-run fixture archive should be created: ${tar.stderr || tar.stdout}`);
  const sha = spawnSync("shasum", ["-a", "256", archivePath], { encoding: "utf8" });
  assert.equal(sha.status, 0, `dry-run fixture checksum should be created: ${sha.stderr || sha.stdout}`);
  const archiveSha256 = String(sha.stdout || "").trim().split(/\s+/)[0];
  writeFileSync(checksumPath, `${archiveSha256}  fixture.tar.gz\n`, "utf8");
  writeFileSync(versionPath, `${JSON.stringify({ releaseId: "deploy-self-check", archiveSha256 }, null, 2)}\n`, "utf8");
  return { root, archivePath, checksumPath, versionPath };
}
