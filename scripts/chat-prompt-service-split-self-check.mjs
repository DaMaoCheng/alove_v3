import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const promptService = readFileSync("server/chat-prompt-service.js", "utf8");
const promptLayers = readFileSync("server/chat-prompt-layers.js", "utf8");
const globalReplyPolicy = readFileSync("server/chat-global-reply-policy.js", "utf8");
const promptUtils = readFileSync("server/chat-prompt-utils.js", "utf8");

assert.ok(
  lineCount(promptService) <= 80,
  "chat-prompt-service.js should stay a thin prompt facade instead of packing all layer builders"
);
assert.match(promptService, /from "\.\/chat-prompt-layers\.js"/, "prompt facade should delegate layer builders");
assert.match(promptService, /buildPersonaLayer/, "prompt facade should compose prompt layers");
assert.match(promptService, /buildGlobalReplyPolicyLayer/, "prompt facade should compose the global reply policy separately");
assert.doesNotMatch(promptService, /function buildPersonaLayer/, "prompt facade should not own persona layer implementation");
assert.doesNotMatch(promptService, /function buildVoiceLayer/, "prompt facade should not own voice layer implementation");
assert.doesNotMatch(promptService, /function buildProductContextLayer/, "prompt facade should not own product layer implementation");

assert.match(promptLayers, /export function buildPersonaLayer/, "prompt layers module should own persona layer");
assert.match(promptLayers, /export function buildVoiceLayer/, "prompt layers module should own voice layer");
assert.match(promptLayers, /export function buildProductContextLayer/, "prompt layers module should own product layer");
assert.match(promptLayers, /export function buildKnowledgeContextLayer/, "prompt layers module should own knowledge layer");
assert.match(promptLayers, /from "\.\/chat-prompt-utils\.js"/, "prompt layers should reuse prompt utils");

assert.match(globalReplyPolicy, /export function buildGlobalReplyPolicyLayer/, "global reply policy should own shared reply rules");
assert.match(globalReplyPolicy, /forced either-or question/, "global reply policy should prevent forced either-or follow-ups");

assert.match(promptUtils, /export function normalizeCharacter/, "prompt utils should own character normalization");
assert.match(promptUtils, /export function safeString/, "prompt utils should own safe string normalization");
assert.match(promptUtils, /export function mapPromptMessage/, "prompt utils should own prompt message mapping");

console.log("chat prompt service split self-check passed");

function lineCount(source) {
  return source.split("\n").length;
}
