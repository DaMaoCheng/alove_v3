import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildFallbackChatReply,
  buildFallbackReplyResult,
  isAiTransportFallback,
} from "../server/ai-reply-fallback-service.js";
import { selectProductsForReply } from "../server/chat-product-reply-service.js";
import { normalizeGuestReplyText } from "../server/guest-chat-output-policy.js";
import { enforceDiscountOfferReplyPolicy } from "../server/chat-discount-offer-output-policy.js";

const genericEnglish = buildFallbackChatReply("Hello", { fallbackLanguageCode: "en" });
assert.equal(genericEnglish, "The server took too long to respond. Please try again later.");

const productEnglish = buildFallbackChatReply("Show me an England jersey", { fallbackLanguageCode: "en" });
assert.equal(productEnglish, genericEnglish, "Product requests must use the same timeout fallback.");

const chinese = buildFallbackChatReply("给我看看球衣", { fallbackLanguageCode: "zh-CN" });
assert.equal(chinese, "服务器响应超时，请稍后重试。");

const japanese = buildFallbackChatReply("シャツを見せて", { fallbackLanguageCode: "ja" });
assert.equal(japanese, "サーバーの応答がタイムアウトしました。しばらくしてからもう一度お試しください。");

const inferredChinese = buildFallbackChatReply("你好");
assert.equal(inferredChinese, chinese, "Chinese is only inferred when no output language is configured.");

const configuredEnglish = buildFallbackChatReply("你好", { fallbackLanguageCode: "en" });
assert.equal(configuredEnglish, genericEnglish, "The configured output language must take precedence over user input language.");

const localeEnglish = buildFallbackChatReply("你好", { fallbackLanguageCode: "en-US", fallbackLanguageLabel: "English" });
assert.equal(localeEnglish, genericEnglish, "Locale-style configured codes must not fall through to input-language inference.");

const result = buildFallbackReplyResult("Hello", { fallbackLanguageCode: "fr", fallbackVoiceId: "voice-1" }, "ai_request_failed_fallback");
assert.equal(result.text, "Le serveur a mis trop de temps à répondre. Veuillez réessayer plus tard.");
assert.equal(result.displayText, result.text);
assert.equal(result.speechText, result.text);
assert.equal(result.voiceMeta.languageCode, "fr");
assert.equal(result.degraded, true);

const guestTimeout = normalizeGuestReplyText({
  text: genericEnglish,
  productRequested: true,
  product: null,
  userText: "Show me an England shirt",
  aiTransportFallback: true,
});
assert.equal(guestTimeout, genericEnglish, "Guest product misses must not overwrite an AI timeout.");

const guestQualityGuard = normalizeGuestReplyText({
  text: "Use code TEST123 for a discount.",
  userText: "Can I get a discount?",
  aiTransportFallback: false,
});
assert.equal(guestQualityGuard, "Discounts are available after you create an account.", "Quality-protected model replies must keep guest discount restrictions.");

assert.equal(isAiTransportFallback({ sourceRef: "ai-request-fallback", degraded: true }), true);
assert.equal(isAiTransportFallback({ sourceRef: "quality-guard", degradationReason: "quality_guard_block", degraded: true }), false);

const discountTimeout = enforceDiscountOfferReplyPolicy({
  replyResult: buildFallbackReplyResult("Any discount?", { fallbackLanguageCode: "en" }, "ai_request_failed_fallback", {
    sourceRef: "ai-request-fallback",
  }),
  offers: [{ code: "SAVE20", offerDescription: "20% off" }],
  userText: "Any discount?",
});
assert.equal(discountTimeout.text, genericEnglish, "discount policy must not overwrite a localized AI timeout reply");

const replyOrchestratorSource = readFileSync(new URL("../server/chat-reply-orchestrator-service.js", import.meta.url), "utf8");
const guestReplySource = readFileSync(new URL("../server/guest-reply-service.js", import.meta.url), "utf8");
assert.match(replyOrchestratorSource, /const selectedProducts = selectProductsForReply\(productContext, replyResult\);/, "Formal users must use the guarded shared final selector.");
assert.match(guestReplySource, /const selectedProducts = selectProductsForReply\(productContext, reply\);/, "Guests must use the same guarded shared final selector.");
assert.match(guestReplySource, /for \(const \[index, product\] of selectedProducts\.entries\(\)\)/, "Guest persistence must use the guarded final selection.");
const safeProductContext = { products: [{ id: "fixture-home", name: "Fixture Home Shirt" }], cardAllowed: true,
  searchIntent: { query: "Fixture shirt", requestedProductType: "shirt" } };
assert.equal(selectProductsForReply(safeProductContext, {}).length, 1, "A normal reviewed product still produces its card.");
for (const blockedReply of [
  buildFallbackReplyResult("Hello", { fallbackLanguageCode: "en" }, "ai_request_failed_fallback"),
  { productScopeVerified: false }, { replyBoundary: { salesAllowed: false } },
]) assert.deepEqual(selectProductsForReply(safeProductContext, blockedReply), [], "Transport failure, scope rejection and sales prohibition cannot send product cards.");
assert.match(replyOrchestratorSource, /selectedProduct && !isAiTransportFallback\(replyResult\) \? normalizeProductFollowupReply/, "Product follow-up normalization must skip only transport AI fallbacks.");

console.log("ai-reply-fallback-self-check: passed");
