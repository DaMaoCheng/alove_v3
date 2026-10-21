import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEMORY_TYPES, PRODUCT_PREFERENCE_MEMORY_TYPES } from "../server/chat-memory-taxonomy.js";
import { GUEST_CALL_MESSAGE_LIMIT } from "../server/guest-call-usage-service.js";
import { GUEST_MESSAGE_LIMIT, GUEST_RATE_LIMIT } from "../server/guest-message-quota-policy.js";

const adminGuestSource = readFileSync("server/admin-guest-session-service.js", "utf8");
const guestCallSource = readFileSync("server/guest-call-usage-service.js", "utf8");
const guestVoiceSource = readFileSync("server/guest-voice-request-service.js", "utf8");
const productPreferenceSource = readFileSync("server/user-product-preference-service.js", "utf8");
const mascotGuardSource = readFileSync("server/mascot-site-guard-service.js", "utf8");
const textReplySource = readFileSync("server/chat-text-message-service.js", "utf8");
const voiceReplySource = readFileSync("server/chat-voice-message-service.js", "utf8");

assert.equal(GUEST_MESSAGE_LIMIT, 30, "shared guest message quota should remain 30");
assert.equal(GUEST_CALL_MESSAGE_LIMIT, GUEST_MESSAGE_LIMIT, "realtime calls should expose the shared guest message quota");
assert.match(adminGuestSource, /import \{ GUEST_MESSAGE_LIMIT \} from "\.\/guest-message-quota-policy\.js"/, "admin guest status should use the shared quota policy");
assert.match(guestCallSource, /GUEST_CALL_MESSAGE_LIMIT = GUEST_MESSAGE_LIMIT/, "guest call compatibility export should reference the shared quota policy");
assert.doesNotMatch(adminGuestSource, /const GUEST_MESSAGE_LIMIT = 30/, "admin guest status should not duplicate the quota literal");
assert.doesNotMatch(guestCallSource, /GUEST_CALL_MESSAGE_LIMIT = 30/, "guest calls should not duplicate the quota literal");
assert.match(guestVoiceSource, /import \{ GUEST_MESSAGE_LIMIT, GUEST_RATE_LIMIT \} from "\.\/guest-message-quota-policy\.js"/, "guest voice reservations should use the shared quota constants");
assert.doesNotMatch(guestVoiceSource, /const (?:MESSAGE_LIMIT|RATE_LIMIT) = (?:30|10)/, "guest voice reservations should not duplicate quota literals");
assert.equal(GUEST_RATE_LIMIT, 10, "shared guest rate quota should remain 10");

assert.deepEqual(PRODUCT_PREFERENCE_MEMORY_TYPES, [
  MEMORY_TYPES.FAVORITE_CLUB,
  MEMORY_TYPES.FAVORITE_TEAM_ENTITY,
  MEMORY_TYPES.FAVORITE_PLAYER,
  MEMORY_TYPES.PURCHASED_PRODUCT,
], "product preference memory types should come from the canonical taxonomy");
assert.match(productPreferenceSource, /PRODUCT_PREFERENCE_MEMORY_TYPES/, "product fallback should use the canonical memory type subset");
assert.doesNotMatch(productPreferenceSource, /const PRODUCT_MEMORY_TYPES/, "product fallback should not maintain a second memory taxonomy");

assert.match(mascotGuardSource, /export async function completeStaleMascotReply/, "mascot guard service should own stale-reply completion");
for (const [label, source] of [["text", textReplySource], ["voice", voiceReplySource]]) {
  assert.match(source, /return await completeStaleMascotReply/, `${label} reply should await stale-mascot completion before releasing its DB connection`);
  assert.doesNotMatch(source, /insertStaleMascotSystemReply/, `${label} reply should not duplicate stale-mascot persistence`);
}

console.log("shared backend rules self-check passed");
