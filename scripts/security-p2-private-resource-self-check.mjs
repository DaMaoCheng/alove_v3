import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeChatAttachmentForClient,
  toProtectedChatAttachmentUrl,
  toProtectedVoiceUrl,
} from "../server/protected-upload-url-service.js";

const serverSource = readSource("server/server.js");
const routesSource = readSource("server/routes.js");
const staticSource = readSource("server/static-file-service.js");
const uploadRouteSource = readSource("server/protected-upload-routes.js");
const adminShellSource = readSource("server/admin-shell-guard.js");
const chatStoreSource = readSource("server/chat-message-store.js");
const chatUploadSource = readSource("server/chat-upload-service.js");
const voiceAssetSource = readSource("server/chat-voice-asset-service.js");

assert.equal(toProtectedChatAttachmentUrl("chat_abc.pdf"), "/api/uploads/chat/chat_abc.pdf");
assert.deepEqual(
  normalizeChatAttachmentForClient({ storedName: "chat_abc.pdf", url: "/uploads/chat/chat_abc.pdf" }),
  { storedName: "chat_abc.pdf", url: "/api/uploads/chat/chat_abc.pdf" }
);
assert.equal(toProtectedVoiceUrl("/uploads/voice/ai/ai_voice_1.mp3"), "/api/uploads/voice/ai/ai_voice_1.mp3");
assert.equal(toProtectedVoiceUrl("/uploads/voice/user_1.webm"), "/api/uploads/voice/user_1.webm");
assert.equal(toProtectedVoiceUrl("/uploads/voice/presets/nova.mp3"), "/uploads/voice/presets/nova.mp3");

assert.match(serverSource, /guardAdminShellRoute\(req,\s*res\)/, "server should gate the admin app shell before static fallback");
assert.match(adminShellSource, /requireAdmin\(req\)/, "admin app shell should require admin auth");

assert.match(routesSource, /handleProtectedUploadRoute/, "protected upload route should be registered in the API router");
assert.match(uploadRouteSource, /\/api\\\/uploads\\\/chat/, "chat attachments should be served through a protected API route");
assert.match(uploadRouteSource, /\/api\\\/uploads\\\/voice\\\/ai/, "AI voice files should be served through a protected API route");
assert.match(uploadRouteSource, /requireAuth\(req,\s*readAuthToken\)/, "private upload routes should require auth");
assert.match(uploadRouteSource, /JOIN chat_sessions s ON s\.id = m\.session_id/, "private upload access should be tied to chat session ownership");
assert.match(uploadRouteSource, /s\.internal_uid = \?/, "private upload access should match the current user id through chat_sessions.internal_uid");
assert.match(uploadRouteSource, /"Cache-Control": "no-store"/, "private upload responses should not be cached");

assert.doesNotMatch(staticSource, /"uploads\/",/, "static serving should not expose the whole uploads directory");
assert.match(staticSource, /"uploads\/avatars\/"/, "avatar uploads should remain public");
assert.match(staticSource, /"uploads\/carousel\/"/, "carousel uploads should remain public");
assert.match(staticSource, /"uploads\/voice\/presets\/"/, "voice preset samples should remain public");

assert.match(chatStoreSource, /normalizeChatAttachmentForClient/, "stored chat attachment URLs should be rewritten for the client");
assert.match(chatStoreSource, /toProtectedVoiceUrl/, "stored voice URLs should be rewritten for the client");
assert.match(chatUploadSource, /toProtectedChatAttachmentUrl/, "new chat uploads should return protected URLs");
assert.match(voiceAssetSource, /exposeAiVoiceAssetToClient/, "fresh AI voice responses should expose protected URLs while DB storage stays unchanged");

console.log("security P2 private resource self-check passed");

function readSource(pathname) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}
