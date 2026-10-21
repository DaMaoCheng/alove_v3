import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entrySource = readFileSync("server/chat-text-message-service.js", "utf8");
const productSource = readFileSync("server/chat-product-reply-service.js", "utf8");
const voiceSource = readFileSync("server/chat-reply-voice-service.js", "utf8");
const orchestratorSource = readFileSync("server/chat-reply-orchestrator-service.js", "utf8");

assert.match(entrySource, /export async function createUserMessage/, "entry should keep createUserMessage public API");
assert.match(entrySource, /export async function createUserReply/, "entry should keep createUserReply public API");
assert.match(entrySource, /buildCharacterReplyGenerationForDb/, "entry should delegate reply generation orchestration");
assert.match(entrySource, /persistCharacterReplyForDb/, "entry should delegate reply persistence orchestration");
assert.match(entrySource, /export \{ resolveReplyVoiceModel, VOICE_MODEL_MODE_REALTIME_CALL_FAST \} from "\.\/chat-reply-voice-service\.js";/, "entry should keep voice model public exports via the voice helper");
assert.doesNotMatch(entrySource, /recordProductBubbleTriggered/, "entry should not own product analytics recording");
assert.doesNotMatch(entrySource, /function selectProductForMessage/, "entry should not own product payload shaping");
assert.doesNotMatch(entrySource, /function safeString/, "entry should not own voice helper primitives");
assert.doesNotMatch(entrySource, /function resolveReplySpeechText/, "entry should not own speech-text alignment helper anymore");

assert.match(productSource, /export function selectProductForMessage/, "product helper should own product payload shaping");
assert.match(productSource, /export async function insertProductReplyMessage/, "product helper should own product message insertion");
assert.match(productSource, /recordProductBubbleTriggered/, "product helper should own product bubble analytics recording");
assert.match(productSource, /imageUrls:/, "product helper should preserve multi-image payloads");

assert.match(voiceSource, /export const VOICE_MODEL_MODE_REALTIME_CALL_FAST/, "voice helper should own realtime fast mode constant");
assert.match(voiceSource, /export function resolveReplyVoiceModel/, "voice helper should own voice model decisions");
assert.match(voiceSource, /export function resolveReplyVoiceMetaModel/, "voice helper should own voice meta model adjustment");
assert.match(voiceSource, /normalizeCharacterLanguage/, "voice helper should keep language support lookup");

assert.match(orchestratorSource, /export async function buildCharacterReplyGenerationForDb/, "orchestrator should own shared reply generation");
assert.match(orchestratorSource, /export async function persistCharacterReplyForDb/, "orchestrator should own shared reply persistence");
assert.match(orchestratorSource, /insertProductReplyMessage/, "orchestrator should reuse shared product reply insertion");
assert.match(orchestratorSource, /resolveReplySpeechText/, "orchestrator should reuse shared speech text alignment");
assert.match(orchestratorSource, /resolveReplyVoiceMetaModel/, "orchestrator should own voice meta fallback alignment");

console.log("chat text message service split self-check passed");
