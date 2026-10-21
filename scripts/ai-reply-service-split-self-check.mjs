import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entrySource = readFileSync("server/ai-reply-service.js", "utf8");
const providerSource = readFileSync("server/ai-reply-provider-service.js", "utf8");
const fallbackSource = readFileSync("server/ai-reply-fallback-service.js", "utf8");
const contractSource = readFileSync("server/ai-reply-contract-service.js", "utf8");

assert.match(entrySource, /import \{(?:\s*normalizeReplyText,\s*)?parseStructuredReply(?:\s*,\s*normalizeReplyText)?\s*\} from "\.\/ai-reply-contract-service\.js"/, "entry should delegate structured reply parsing to the contract service");
assert.match(entrySource, /import \{ buildErrorReplyMeta, buildFallbackChatReply, buildFallbackReplyResult, buildVoiceFallbackMeta \} from "\.\/ai-reply-fallback-service\.js"/, "entry should delegate fallback helpers to the fallback service");
assert.match(entrySource, /import \{ isOpenAiReplyConfigured, isRetryableAiReplyTransportError, requestOpenAiReply \} from "\.\/ai-reply-provider-service\.js"/, "entry should delegate OpenAI transport to the provider service");
assert.doesNotMatch(entrySource, /function buildOpenAiRequestBody/, "entry should not keep OpenAI request body transport logic");
assert.doesNotMatch(entrySource, /function appendStructuredReplyInstructions/, "entry should not keep the output contract prompt builder");
assert.doesNotMatch(entrySource, /function buildFallbackReplyResult/, "entry should not keep fallback reply builders");

assert.match(providerSource, /function buildOpenAiRequestBody/, "provider service should own OpenAI request body construction");
assert.match(providerSource, /function extractResponseText/, "provider service should own provider response text extraction");
assert.match(contractSource, /export function appendStructuredReplyInstructions/, "contract service should own structured output instructions");
assert.match(contractSource, /export function normalizeReplyVoiceMeta/, "contract service should own voice meta normalization");
assert.match(fallbackSource, /export function buildFallbackChatReply/, "fallback service should own visible fallback copy");
assert.match(fallbackSource, /export function buildVoiceFallbackMeta/, "fallback service should own reply voice fallback meta creation");

console.log("ai reply service split self-check passed");
