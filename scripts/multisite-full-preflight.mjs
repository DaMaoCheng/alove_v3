import { spawn } from "node:child_process";

const COMMANDS = Object.freeze([
  ["node", ["--check", "server/geo-site-resolver-service.js"]],
  ["node", ["--check", "src/app/site-routing.js"]],
  ["node", ["--check", "src/features/admin-console/admin-console-sites-template.js"]],
  ["node", ["--check", "src/features/admin-console/admin-sites-controller.js"]],
  ["node", ["scripts/deployment-env-self-check.mjs"]],
  ["node", ["scripts/production-env-strict-self-check.mjs"]],
  ["node", ["scripts/multisite-preflight-self-check.mjs"]],
  ["node", ["scripts/geo-site-resolver-self-check.mjs"]],
  ["node", ["scripts/geo-ip-routing-mock-self-check.mjs"]],
  ["node", ["scripts/admin-site-region-picker-ui-self-check.mjs"]],
  ["node", ["scripts/admin-site-geo-regions-self-check.mjs"]],
  ["node", ["scripts/admin-site-mascot-sync-self-check.mjs"]],
  ["node", ["scripts/geo-region-online-search-self-check.mjs"]],
  ["node", ["scripts/admin-account-site-self-check.mjs"]],
  ["node", ["scripts/bound-site-login-self-check.mjs"]],
  ["node", ["scripts/site-routing-first-phase-self-check.mjs"]],
  ["node", ["scripts/register-invite-site-rules-self-check.mjs"]],
  ["node", ["scripts/site-character-filtering-self-check.mjs"]],
  ["node", ["scripts/contact-site-filtering-self-check.mjs"]],
  ["node", ["scripts/register-mascot-activation-self-check.mjs"]],
  ["node", ["scripts/creator-creation-rules-self-check.mjs"]],
]);

for (const [command, args] of COMMANDS) {
  const label = [command, ...args].join(" ");
  console.log(`\n[preflight] ${label}`);
  await run(command, args);
}

console.log("\nmultisite full preflight passed");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal || code}`));
    });
  });
}
