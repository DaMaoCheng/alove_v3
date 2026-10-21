import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const STRICT_NPM_CI = String(process.env.STRICT_NPM_CI || "false").trim().toLowerCase() === "true";
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));

const packageDeps = normalizeDeps(packageJson.dependencies);
const lockDeps = normalizeDeps(packageLock.packages?.[""]?.dependencies);

assert.deepEqual(lockDeps, packageDeps, "package-lock root dependencies must match package.json dependencies");
assert.equal(packageLock.packages?.[""]?.engines?.node, packageJson.engines?.node, "package-lock root node engine must match package.json engines.node");

if (STRICT_NPM_CI) {
  const result = spawnSync("npm", ["ci", "--omit=dev", "--dry-run"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error("npm ci --omit=dev --dry-run failed");
  }
}

console.log(`npm lockfile self-check passed${STRICT_NPM_CI ? " with npm ci dry-run" : ""}`);

function normalizeDeps(value) {
  return Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
}
