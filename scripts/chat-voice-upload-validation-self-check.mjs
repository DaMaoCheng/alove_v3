import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CHAT_VOICE_UPLOAD_POLICY } from "../server/upload-policies.js";
import { validateUploadForPolicy } from "../server/upload-security.js";

const routesSource = readFileSync("server/chat-routes.js", "utf8");
const uploadSecuritySource = readFileSync("server/upload-security.js", "utf8");
const removedPersistenceModule = "server/chat-voice-upload-service.js";

assert.equal(existsSync(removedPersistenceModule), false, "raw user voice persistence module should stay removed");
for (const root of ["server", "src"]) {
  for (const file of listJavaScriptFiles(root)) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /chat-voice-upload-service/,
      `${file} should not import the removed raw user voice persistence module`
    );
  }
}

assert.match(routesSource, /validateUploadForPolicy/, "chat voice route should validate audio before STT");
assert.match(
  routesSource,
  /validateUploadForPolicy\(\{[\s\S]*CHAT_VOICE_UPLOAD_POLICY\.allowedTypes[\s\S]*\}\);[\s\S]*transcribeChatVoice/,
  "chat voice route should run validation before calling STT"
);
assert.doesNotMatch(routesSource, /saveChatVoiceUpload/, "chat voice route should still avoid persisting raw user audio");
assert.match(uploadSecuritySource, /function validateAudioSignature/, "upload security should validate audio file signatures");
assert.match(uploadSecuritySource, /isWebmSignature/, "upload security should support WebM voice signatures");
assert.match(uploadSecuritySource, /isMp3Signature/, "upload security should support MP3 voice signatures");
assert.match(uploadSecuritySource, /isWavSignature/, "upload security should support WAV voice signatures");
assert.match(uploadSecuritySource, /isMp4AudioSignature/, "upload security should support M4A/MP4 voice signatures");
assert.match(routesSource, /mimeType:\s*voiceUpload\.allowed\?\.mimeType \|\| voiceUpload\.mimeType/, "chat voice route should send canonical audio MIME type to STT when configured");

const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);
const valid = validateUploadForPolicy({
  buffer: webm,
  contentType: "audio/webm;codecs=opus",
  uploadFilename: "voice.webm",
  allowedTypes: CHAT_VOICE_UPLOAD_POLICY.allowedTypes,
  maxBytes: CHAT_VOICE_UPLOAD_POLICY.maxBytes,
  emptyMessage: "语音文件不能为空",
  tooLargeMessage: "语音不能超过 10MB",
  unsupportedMessage: "仅支持上传常见音频格式",
});
assert.equal(valid.mimeType, "audio/webm", "voice validation should normalize content type");
assert.equal(valid.allowed.kind, "voice", "voice validation should return the voice policy");

const mp4Voice = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x6d, 0x34, 0x61, 0x20,
  0x00, 0x00, 0x00, 0x00,
]);
for (const contentType of ["audio/mp4", "audio/x-m4a", "video/mp4"]) {
  const m4a = validateUploadForPolicy({
    buffer: mp4Voice,
    contentType,
    uploadFilename: "voice.m4a",
    allowedTypes: CHAT_VOICE_UPLOAD_POLICY.allowedTypes,
    maxBytes: CHAT_VOICE_UPLOAD_POLICY.maxBytes,
    emptyMessage: "语音文件不能为空",
    tooLargeMessage: "语音不能超过 10MB",
    unsupportedMessage: "仅支持上传常见音频格式",
  });
  assert.equal(m4a.allowed.mimeType, "audio/mp4", `${contentType} should use canonical audio/mp4 MIME for STT`);
}

assert.throws(
  () => validateUploadForPolicy({
    buffer: Buffer.from("<script>alert(1)</script>"),
    contentType: "audio/webm",
    uploadFilename: "voice.webm",
    allowedTypes: CHAT_VOICE_UPLOAD_POLICY.allowedTypes,
    maxBytes: CHAT_VOICE_UPLOAD_POLICY.maxBytes,
    emptyMessage: "语音文件不能为空",
    tooLargeMessage: "语音不能超过 10MB",
    unsupportedMessage: "仅支持上传常见音频格式",
  }),
  /音频文件内容校验失败/,
  "disguised text should not be accepted as WebM audio"
);

assert.throws(
  () => validateUploadForPolicy({
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]),
    contentType: "audio/mpeg",
    uploadFilename: "voice.mp3",
    allowedTypes: CHAT_VOICE_UPLOAD_POLICY.allowedTypes,
    maxBytes: CHAT_VOICE_UPLOAD_POLICY.maxBytes,
    emptyMessage: "语音文件不能为空",
    tooLargeMessage: "语音不能超过 10MB",
    unsupportedMessage: "仅支持上传常见音频格式",
  }),
  /检测到不安全文件/,
  "executable signatures should be rejected before STT"
);

console.log("chat voice upload validation self-check passed");

function listJavaScriptFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(path);
    return entry.isFile() && /\.(?:m?js)$/.test(entry.name) ? [path] : [];
  });
}
