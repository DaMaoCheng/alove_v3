import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STALE_MASCOT_NOTICE_TEXT } from "../server/mascot-site-guard-service.js";

const adminAccountWrite = await readFile(new URL("../server/admin-account-write-service.js", import.meta.url), "utf8");
const textReply = await readFile(new URL("../server/chat-text-message-service.js", import.meta.url), "utf8");
const voiceReply = await readFile(new URL("../server/chat-voice-message-service.js", import.meta.url), "utf8");
const guardService = await readFile(new URL("../server/mascot-site-guard-service.js", import.meta.url), "utf8");

assert.match(adminAccountWrite, /syncMascotActivationForSiteChange/, "site change should sync mascot activation");
assert.match(textReply, /resolveStaleMascotGuard/, "text reply should guard stale mascot");
assert.match(voiceReply, /resolveStaleMascotGuard/, "voice reply should guard stale mascot");
assert.match(guardService, /activation_status = 'inactive'/, "site guard should deactivate old mascot activations");
assert.equal(
  STALE_MASCOT_NOTICE_TEXT,
  "Your account site assignment has changed. This character is no longer available. Please refresh the page to reconnect.",
  "stale mascot notice text should stay fixed"
);

console.log("mascot site guard self-check passed");
