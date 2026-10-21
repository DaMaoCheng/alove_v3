import assert from "node:assert/strict";
import { appendStructuredReplyInstructions } from "../server/ai-reply-service.js";

const prompt = appendStructuredReplyInstructions("Base prompt.");

assert.match(prompt, /Base prompt\./);
assert.match(prompt, /Reply Output Contract/);
assert.match(prompt, /Return exactly one JSON object/);
assert.match(prompt, /displayText/);
assert.match(prompt, /speechText/);
assert.match(prompt, /voiceMeta/);
assert.doesNotMatch(prompt, /```json/, "output contract should not ask for markdown fences");

console.log("chat reply output contract self-check passed");
