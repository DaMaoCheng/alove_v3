import assert from "node:assert/strict";
import { AVATAR_UPLOAD_POLICY, CAROUSEL_UPLOAD_POLICY, CHAT_ATTACHMENT_UPLOAD_POLICY } from "../src/config/upload-policies.js";
import { AVATAR_UPLOAD_POLICY as SERVER_AVATAR_POLICY, CAROUSEL_UPLOAD_POLICY as SERVER_CAROUSEL_POLICY, CHAT_ATTACHMENT_UPLOAD_POLICY as SERVER_CHAT_POLICY } from "../server/upload-policies.js";

assert.match(AVATAR_UPLOAD_POLICY.accept, /\.jfif/);
assert.match(CAROUSEL_UPLOAD_POLICY.accept, /\.jfif/);
assert.match(CHAT_ATTACHMENT_UPLOAD_POLICY.accept, /\.jfif/);
assert.ok(AVATAR_UPLOAD_POLICY.allowedImageTypes.includes("image/jpeg"));
assert.ok(CAROUSEL_UPLOAD_POLICY.allowedImageTypes.includes("image/jpeg"));
assert.ok(CHAT_ATTACHMENT_UPLOAD_POLICY.imageTypes.includes("image/jpeg"));
assert.ok(SERVER_AVATAR_POLICY.allowedTypes["image/jpeg"].extensions.includes(".jfif"));
assert.ok(SERVER_CAROUSEL_POLICY.allowedTypes["image/jpeg"].extensions.includes(".jfif"));
assert.ok(SERVER_CHAT_POLICY.allowedTypes["image/jpeg"].extensions.includes(".jfif"));

console.log("JFIF upload policy self-check passed");
