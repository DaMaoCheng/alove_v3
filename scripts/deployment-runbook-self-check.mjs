import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runbook = readFileSync("docs/deployment/server-runbook.md", "utf8");

const REQUIRED_TEXT = Object.freeze([
  ["fresh package command", "npm run package:deployment"],
  ["release deploy dry-run command", "npm run deploy:release"],
  ["release deploy execute command", "npm run deploy:release -- --execute"],
  ["archive output", "dist/alove-page-rebuild-deploy.tar.gz"],
  ["checksum output", "dist/alove-page-rebuild-deploy.tar.gz.sha256"],
  ["version metadata output", "dist/alove-page-rebuild-deploy.version.json"],
  ["server root", "/srv/alove-new"],
  ["current symlink", "current -> /srv/alove-new/releases/<release-id-timestamp>"],
  ["shared uploads", "/srv/alove-new/shared/uploads"],
  ["backups directory", "/srv/alove-new/backups"],
  ["checksum verification", "sha256sum -c alove-page-rebuild-deploy.tar.gz.sha256"],
  ["production dependency install", "npm ci --omit=dev"],
  ["current switch", "ln -sfn"],
  ["sudo service restart", "sudo systemctl restart alove-new.service"],
  ["database backup command", "mysqldump"],
  ["database backup path", "/srv/alove-new/backups/db-before-<release>.sql.gz"],
  ["local health check", "curl -fsS http://127.0.0.1:4173/api/health"],
  ["public health check", "curl -fsS https://alove.fans/api/health"],
  ["local smoke command", "SMOKE_BASE_URL=http://127.0.0.1:4173 node scripts/multisite-http-smoke.mjs"],
  ["public smoke command", "SMOKE_BASE_URL=https://alove.fans npm run smoke:multisite"],
  ["legacy conversion", "legacy-current-before-<release>"],
  ["rollback section", "## 5. Rollback"],
  ["release cleanup section", "## 6. Optional Release Cleanup"],
  ["secret rule", "Never place real secrets in source files or deployment archives."],
  ["forwarded IP header", "X-Forwarded-For"],
  ["real IP header", "X-Real-IP"],
  ["cloudflare country header", "CF-IPCountry"],
  ["readlink verification", "readlink -f /srv/alove-new/current"],
]);

for (const [label, text] of REQUIRED_TEXT) {
  assert.ok(runbook.includes(text), `server runbook should mention ${label}: ${text}`);
}

const orderedSteps = [
  "## 1. Create Local Package",
  "## 2. Dry-Run Release Plan",
  "## 3. Execute Release Deployment",
  "## 4. First Conversion From Directory Current",
  "## 5. Rollback",
  "## 6. Optional Release Cleanup",
  "## 7. Server Environment Rules",
  "## 8. Nginx And IP Routing",
  "## 9. Verification",
];

let previousIndex = -1;
for (const heading of orderedSteps) {
  const index = runbook.indexOf(heading);
  assert.ok(index > previousIndex, `server runbook step order is wrong or missing: ${heading}`);
  previousIndex = index;
}

console.log("deployment runbook self-check passed");
