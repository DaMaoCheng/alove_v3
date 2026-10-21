import assert from "node:assert/strict";
import { SUPPORTED_CHARACTER_LANGUAGES } from "../shared/language-library.js";
import { normalizeGuestReplyText } from "../server/guest-chat-output-policy.js";
import { GUEST_PRODUCT_REPLY_COPY, buildGuestProductReplyCopy, buildGuestProductTonePrefix, resolveGuestProductReplyLanguage } from "../server/guest-product-reply-copy.js";

// No database, supplier, model or network calls: exercise the actual final reply normalizer.
let checked = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checked += 1;
}
const failureCases = [
  ["market_currency_mismatch", "configuration"],
  ["market_country_ambiguous", "configuration"],
  ["source_unconfigured", "configuration"],
  ["credentials_unavailable", "credentials"],
  ["auth_failed", "credentials"],
  ["timeout", "timeout"],
  ["rate_limited", "rateLimit"],
  ["source_network", "unavailable"],
  ["source_internal", "unavailable"],
  ["unknown", "unavailable"],
  ["__proto__", "unavailable"],
  ["constructor", "unavailable"],
  ["", "unavailable"],
];
for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  const code = language.code;
  const copy = GUEST_PRODUCT_REPLY_COPY[code];
  check(copy && Object.values(copy).every((value) => typeof value === "string" && value.trim()), `${code}: every product-state field must be translated`);
  check(resolveGuestProductReplyLanguage(language.label, "OK") === code, `${code}: label resolves even with a language-neutral follow-up`);
  check(resolveGuestProductReplyLanguage(`${code}-XX`, "中文") === code, `${code}: configured locale wins over current text script`);
  for (const [sourceErrorCode, field] of failureCases) {
    const reply = normalizeGuestReplyText({
      text: "Product search is temporarily unavailable. Please try again later.",
      languageCode: language.label,
      userText: "OK",
      productRequested: true,
      productSearchIntent: { searchState: "source_error", sourceErrorCode },
    });
    check(reply === copy[field], `${code}/${sourceErrorCode}: actual final normalizer uses active language and reason`);
    if (code !== "en") check(reply !== GUEST_PRODUCT_REPLY_COPY.en[field], `${code}/${field}: must not silently return English`);
  }
  for (const tone of ["direct", "warm", "playful", "encouraging"]) {
    for (const criteria of [{}, { requestedTeam: "Real Madrid" }, { requestedTeam: "Real Madrid", requestedVariant: "away" }]) {
      const reply = normalizeGuestReplyText({
        text: `[guest_product_clarification:${tone}]`,
        languageCode: code,
        userText: "OK",
        productRequested: true,
        productSearchIntent: { searchState: "needs_clarification", ...criteria },
      });
      const field = criteria.requestedVariant ? "detailQuestion" : criteria.requestedTeam ? "variantQuestion" : "teamQuestion";
      const question = buildGuestProductReplyCopy(field, { languageCode: code, values: { team: "Real Madrid", variant: "away" } });
      check(reply.includes(question), `${code}/${tone}/${field}: one localized missing-detail question`);
      check(!reply.includes("[guest_product_"), `${code}: internal tokens do not reach user`);
      if (!["en", "zh"].includes(code) && tone !== "direct") check(reply.startsWith(buildGuestProductTonePrefix(tone, code)), `${code}/${tone}: tone selection survives`);
    }
    const exhausted = normalizeGuestReplyText({
      text: `[guest_product_clarification_exhausted:${tone}]`, languageCode: code, userText: "OK", productRequested: true,
      productSearchIntent: { searchState: "clarification_exhausted" },
    });
    check(!/[?？]/.test(exhausted), `${code}/${tone}: exhausted clarification does not ask another question`);
    if (!["en", "zh"].includes(code)) check(exhausted.includes(copy.exhausted), `${code}/${tone}: localized exhausted copy`);
  }
  const correction = normalizeGuestReplyText({
    text: "[guest_product_clarification:direct]", languageCode: code, userText: "OK", productRequested: true,
    productSearchIntent: { searchState: "needs_clarification", correctionSuggestion: { correctedText: "goalie kits" } },
  });
  check(correction === copy.correction.replace("{phrase}", "goalie kits"), `${code}: typo confirmation localized`);
  const noMatch = normalizeGuestReplyText({
    text: "No match today.", languageCode: code, userText: "OK", productRequested: true,
    productSearchOutcome: "no_match",
    productSearchIntent: { searchState: "ready_to_search" },
  });
  check(noMatch === copy.noMatch, `${code}: terminal no-match replaces wrong-language model copy`);
  const ordinary = normalizeGuestReplyText({ text: "A natural conversation response.", languageCode: code, userText: "OK" });
  check(ordinary === "A natural conversation response.", `${code}: ordinary dialog is untouched`);
  const knowledge = normalizeGuestReplyText({
    text: "A grounded policy answer.", languageCode: code, userText: "OK", productRequested: true, skipProductClarification: true,
    productSearchIntent: { searchState: "source_error", sourceErrorCode: "timeout", customerServiceKnowledgeRequest: true },
  });
  check(knowledge === "A grounded policy answer.", `${code}: valid customer-service answer is not overwritten by a product failure`);
  const liveFactFailure = normalizeGuestReplyText({
    text: "A guessed stock claim.", languageCode: code, userText: "OK", productRequested: true,
    productSearchIntent: { searchState: "source_error", sourceErrorCode: "timeout", customerServiceKnowledgeRequest: true, needsLiveProductData: true },
  });
  check(liveFactFailure === copy.timeout, `${code}: missing required live product facts must not be hidden by customer-service flag`);
}
check(resolveGuestProductReplyLanguage("", "商品") === "zh", "unconfigured Chinese request preserves existing fallback");
check(resolveGuestProductReplyLanguage("", "OK") === "en", "unconfigured neutral request preserves existing fallback");
check(normalizeGuestReplyText({ productRequested: true, languageCode: "Hungarian", userText: "Magyarul", productSearchIntent: { searchState: "source_error", sourceErrorCode: "market_currency_mismatch" } }).includes("üzlet"), "historic Hungarian short reply uses Hungarian even without CJK");
check(!GUEST_PRODUCT_REPLY_COPY.hu.configuration.includes("később"), "configuration fault must not instruct repeated retries");
console.log(`guest product language self-check passed: ${SUPPORTED_CHARACTER_LANGUAGES.length} languages, ${checked} assertions`);
