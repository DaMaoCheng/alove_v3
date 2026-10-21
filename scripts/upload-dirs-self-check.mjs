import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AVATAR_UPLOAD_POLICY,
  CAROUSEL_UPLOAD_POLICY,
  CHAT_ATTACHMENT_UPLOAD_POLICY,
  CHAT_VOICE_UPLOAD_POLICY,
  MASCOT_GREETING_IMAGE_UPLOAD_POLICY,
  MASCOT_GREETING_VIDEO_UPLOAD_POLICY,
} from "../server/upload-policies.js";

const POLICIES = Object.freeze([
  ["avatar uploads", AVATAR_UPLOAD_POLICY],
  ["carousel uploads", CAROUSEL_UPLOAD_POLICY],
  ["chat attachment uploads", CHAT_ATTACHMENT_UPLOAD_POLICY],
  ["voice uploads", CHAT_VOICE_UPLOAD_POLICY],
  ["mascot greeting image uploads", MASCOT_GREETING_IMAGE_UPLOAD_POLICY],
  ["mascot greeting video uploads", MASCOT_GREETING_VIDEO_UPLOAD_POLICY],
]);

for (const [label, policy] of POLICIES) {
  assert.ok(policy.uploadDir, `${label} should define uploadDir`);
  assert.ok(policy.publicPath?.startsWith("/uploads/"), `${label} should expose /uploads public path`);

  await mkdir(policy.uploadDir, { recursive: true });
  const checkFile = join(policy.uploadDir, ".upload-dir-self-check");
  await writeFile(checkFile, `ok:${label}\n`, "utf8");
  await rm(checkFile, { force: true });
}

console.log("upload dirs self-check passed");
