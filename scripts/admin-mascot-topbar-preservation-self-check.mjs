import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/admin-console/admin-mascot-controller.js", "utf8");

assert.doesNotMatch(
  source,
  /const\s+body\s*=\s*shell\.querySelector\("\.admin-body"\)\?\.parentElement/,
  "mascot controller should not use .admin-body parentElement as the render target because that replaces admin topbar",
);

assert.match(
  source,
  /const\s+body\s*=\s*shell\.querySelector\("\.admin-body"\)/,
  "mascot controller should render inside the admin body content area",
);

assert.match(
  source,
  /body\.innerHTML\s*=\s*adminMascotBodyHtml\(state\)/,
  "mascot controller should refresh only the mascot body HTML, not the whole admin-main shell",
);

console.log("admin mascot topbar preservation self-check passed");
