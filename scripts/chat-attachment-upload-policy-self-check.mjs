import assert from "node:assert/strict";
import { CHAT_ATTACHMENT_UPLOAD_POLICY as CLIENT_POLICY } from "../src/config/upload-policies.js";
import { CHAT_ATTACHMENT_UPLOAD_POLICY as SERVER_POLICY } from "../server/upload-policies.js";
import { validateUploadForPolicy } from "../server/upload-security.js";

const blockedExtensions = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf"];
const blockedMimeTypes = [
  "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

for (const extension of blockedExtensions) {
  assert.doesNotMatch(CLIENT_POLICY.accept, new RegExp(escapeRegExp(extension)), `${extension} should not be accepted by client policy`);
}

for (const mimeType of blockedMimeTypes) {
  assert.equal(CLIENT_POLICY.documentTypes.includes(mimeType), false, `${mimeType} should not be accepted by client policy`);
  assert.equal(Boolean(SERVER_POLICY.allowedTypes[mimeType]), false, `${mimeType} should not be accepted by server policy`);
}

assert.match(CLIENT_POLICY.accept, /\.pdf/, "PDF should remain accepted by client policy");
assert.match(CLIENT_POLICY.accept, /\.txt/, "TXT should remain accepted by client policy");
assert.ok(SERVER_POLICY.allowedTypes["application/pdf"], "PDF should remain accepted by server policy");
assert.ok(SERVER_POLICY.allowedTypes["text/plain"], "TXT should remain accepted by server policy");
assert.ok(SERVER_POLICY.allowedTypes["image/jpeg"], "images should remain accepted by server policy");

assert.throws(
  () => validateUploadForPolicy({
    buffer: Buffer.from("fake docx content"),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    uploadFilename: "test.docx",
    allowedTypes: SERVER_POLICY.allowedTypes,
    maxBytes: SERVER_POLICY.maxBytes,
  }),
  /文件格式不支持/,
  "server validation should reject Office documents"
);

validateUploadForPolicy({
  buffer: Buffer.from("%PDF-1.7\n"),
  contentType: "application/pdf",
  uploadFilename: "test.pdf",
  allowedTypes: SERVER_POLICY.allowedTypes,
  maxBytes: SERVER_POLICY.maxBytes,
});

console.log("chat attachment upload policy self-check passed");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
