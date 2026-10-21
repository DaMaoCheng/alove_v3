import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serviceSource = readFileSync(new URL("../server/image-generation-service.js", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../server/image-generation-provider-service.js", import.meta.url), "utf8");
const chatImageSource = readFileSync(new URL("../server/chat-image-generation-service.js", import.meta.url), "utf8");

assert.match(serviceSource, /AVATAR_GENERATION_MAX_ATTEMPTS = 2/, "avatar generation should allow exactly one internal retry");
assert.match(serviceSource, /requestGeneratedAvatarImage\(prompt\)/, "avatar generation should use the avatar-only retry wrapper");
assert.match(serviceSource, /attempt <= AVATAR_GENERATION_MAX_ATTEMPTS/, "avatar retry wrapper should cap attempts explicitly");
assert.match(serviceSource, /if \(attempt >= AVATAR_GENERATION_MAX_ATTEMPTS\) break;/, "avatar retry wrapper should stop after the final attempt");

assert.doesNotMatch(providerSource, /AVATAR_GENERATION_MAX_ATTEMPTS|requestGeneratedAvatarImage/, "shared image provider should not add global retries");
assert.match(chatImageSource, /maxRetries: 1/, "chat image generation should keep using one queue-level retry");

console.log("avatar generation service retry self-check passed");
