import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const RELEASE_ID = "2026-06-15-local-multisite-baseline";
const RELEASE_NOTES_PATH = `docs/releases/${RELEASE_ID}.md`;
const archiveScript = readFileSync("scripts/create-deployment-archive.mjs", "utf8");
const checklist = readFileSync("docs/deployment-checklist-2026-06-10.md", "utf8");

assert.ok(existsSync(RELEASE_NOTES_PATH), `release notes should exist: ${RELEASE_NOTES_PATH}`);
const releaseNotes = readFileSync(RELEASE_NOTES_PATH, "utf8");

for (const text of [
  RELEASE_ID,
  "Known Not Complete",
  "Verification Commands",
  "Suggested Git Marker",
  "npm run check:deployment",
  "npm run package:deployment",
]) {
  assert.ok(releaseNotes.includes(text), `release notes should include ${text}`);
}

for (const text of [
  "VERSION_METADATA_PATH",
  "docs/releases/current-deployment.json",
  ".version.json",
  "archiveSha256",
  "dirtyFileCount",
  "rev-parse",
  "--show-current",
  "docs/releases",
  "RELEASE_NOTES_PATH",
]) {
  assert.ok(archiveScript.includes(text), `deployment archive script should include version metadata support: ${text}`);
}

assert.ok(checklist.includes("dist/alove-page-rebuild-deploy.tar.gz.sha256"), "deployment checklist should mention package checksum");

console.log("deployment version self-check passed");
