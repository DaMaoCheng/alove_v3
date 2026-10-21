import assert from "node:assert/strict";
import sharp from "sharp";
import { saveAvatarUpload } from "../server/upload-service.js";

const buffer = await sharp({
  create: {
    width: 8,
    height: 8,
    channels: 4,
    background: "#7c3aed",
  },
}).webp({ quality: 80 }).toBuffer();

const result = await saveAvatarUpload({
  userId: "admin-test",
  buffer,
  contentType: "image/webp",
  filename: "admin-character-avatar.webp",
});

assert.equal(result.ok, true);
assert.match(result.avatarUrl, /^\/uploads\/avatars\/avatar-[a-f0-9]{16}-file_[a-f0-9-]+\.webp$/);
assert.equal(result.contentType, "image/webp");
assert.equal(result.uploadedBy, "admin-test");

console.log(JSON.stringify({ ok: true, avatarUrl: result.avatarUrl, bytes: result.bytes }, null, 2));
