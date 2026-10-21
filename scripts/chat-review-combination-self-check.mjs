import assert from "node:assert/strict";
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("External requests forbidden"); };
const { enforceReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const languagePass = { reviewStatus: "valid", confidence: .99, languageQualitySupported: true,
  retainedLanguageQualitySupported: true, languageIssues: [], severity: "none" };
const checks = [], failures = [];
async function check(name, run) { try { await run(); checks.push(name); } catch (error) { failures.push({ name, message: error.message }); } }
const options = { language: "en", languageQualityRequired: true, independentLanguageQualityRequired: true,
  assessLanguageQuality: async () => languagePass, recordReview: async () => {} };
await check("Inactive factual fields cannot choose a factual fallback", async () => {
  let diagnostic;
  const out = await enforceReplyBoundary({ ...options, replyResult: { text: "Let me send you an offer.", sourceType: "ai" },
    searchIntent: { commerceRoute: "chat", replyBoundary: { salesAllowed: false, contactAllowed: false } },
    assess: async () => ({ allowed: false, confidence: .99, boundarySupported: false, factualSupported: false }),
    recordReview: async event => { diagnostic = event; } });
  assert.equal(out.text, "Understood.");
  assert.deepEqual(diagnostic.failedContracts, ["boundary"]);
  assert.equal(diagnostic.fallbackKind, "boundary");
});
const paragraph = "The delivery policy is verified.";
const text = paragraph + "\n\nAn unsupported claim.\n\nThe image is pending.";
const verdict = { allowed: false, confidence: .99, boundarySupported: true, evidenceSupported: true,
  guidanceSupported: false, imageStatusSupported: false, imageStatusRelevant: true, imageReferenceMatched: true,
  businessFactsSupported: false, factualSupported: true, retainedTextAllowed: true, retainedText: paragraph,
  retainedBoundarySupported: true, retainedEvidenceSupported: true, retainedGuidanceSupported: true,
  retainedImageStatusSupported: true, retainedBusinessFactsSupported: true, retainedFactualSupported: true };
const combination = { ...options, replyResult: { text, speechText: text, sourceType: "ai" },
  searchIntent: { commerceRoute: "store_policy", knowledgeScope: "business", answerRequired: true, commerceTopic: "price" },
  character: { category_id: "mascot" }, factualContext: { required: false, asOfUtc: "2026-10-12T00:00:00Z" },
  chatImageContext: { imageStatus: { kind: "generated", status: "ready", currentTurn: true } } };
await check("Whole guidance failure must not discard a fully approved separate paragraph", async () => {
  const out = await enforceReplyBoundary({ ...combination, assess: async () => verdict });
  assert(out.text.includes(paragraph)); assert(out.text.includes("Photo ready."));
  assert(!out.text.includes("unsupported claim")); assert.equal(out.partialAnswerRetained, true);
  assert.equal(out.speechText, out.text);
});
for (const field of ["retainedBoundarySupported", "retainedGuidanceSupported", "retainedImageStatusSupported",
  "retainedBusinessFactsSupported", "retainedFactualSupported", "retainedTextAllowed"]) {
  for (const value of [undefined, false, "true"]) await check(field + "/" + value, async () => {
    const out = await enforceReplyBoundary({ ...combination, assess: async () => ({ ...verdict, [field]: value }) });
    assert(!out.text.includes(paragraph), "Missing, false or malformed retained approval must not release text");
  });
}
await check("A retained language refusal overrides a whole language pass", async () => {
  const out = await enforceReplyBoundary({ ...combination, assess: async () => verdict,
    assessLanguageQuality: async () => ({ ...languagePass, retainedLanguageQualitySupported: false }) });
  assert(!out.text.includes(paragraph));
});
for (const primary of [{ ...verdict, confidence: .2 }, { ...verdict, reviewStatus: "invalid_json" },
  { ...verdict, guidanceSupported: undefined }]) await check("Invalid or weak primary cannot retain/" + JSON.stringify(primary.confidence), async () => {
  const out = await enforceReplyBoundary({ ...combination, assess: async () => primary }); assert(!out.text.includes(paragraph));
});
await check("A genuinely active factual rejection keeps factual protection", async () => {
  const out = await enforceReplyBoundary({ ...options, replyResult: { text: "Tomorrow's result is already certain.", sourceType: "ai" },
    factualContext: { required: false, asOfUtc: "2026-10-12T00:00:00Z" },
    assess: async () => ({ allowed: false, confidence: .99, boundarySupported: true, factualSupported: false }) });
  assert(out.text.includes("verify that fact")); assert(!out.text.includes("already certain"));
});
const { buildReplyReviewMessages } = await import("../server/chat-reply-review-contracts.js");
await check("Non-storefront evidence review still covers store facts and item-specific options", async () => {
  const messages = buildReplyReviewMessages({ text: "I cannot verify that shirt. Our store accepts Alipay.",
    evidenceRequired: true, businessFactsRequired: false, guidanceRequired: false, independentLanguageReview: true, languageQualityRequired: true });
  const instructions = messages.filter(row => row.role === "system").map(row => row.content).join("\n");
  assert(instructions.includes("Check every product/store factual claim"));
  assert(instructions.includes("General store policy cannot prove a specific item"));
  assert(instructions.includes("customization, player/fan version, size, material, stock, price, origin or authenticity"));
  assert(instructions.includes("lack of item data must not erase that answer"));
  assert(!instructions.includes("retainedLanguageQualitySupported"), "Dedicated primary must not request a second language vote");
});
await check("Prompt and output use distinct whole and retained contract fields", async () => {
  const messages = buildReplyReviewMessages({ text, independentLanguageReview: true, guidanceRequired: true,
    imageStatusContext: { status: "ready" }, businessFactsRequired: true });
  const instructions = messages.filter(row => row.role === "system").map(row => row.content).join("\n");
  assert(instructions.includes("retainedGuidanceSupported:boolean"));
  assert(instructions.includes("retainedImageStatusSupported:boolean"));
  assert(instructions.includes("retainedBusinessFactsSupported:boolean"));
  assert(instructions.includes("whole-response support field ALWAYS describes BOTH complete outputs"));
  assert(!instructions.includes("flags requested in earlier templates"));
});
if (failures.length) { console.error(JSON.stringify({ passed: checks.length, failures }, null, 2)); process.exitCode = 1; }
else console.log(`Review combination self-check passed (${checks.length} scenarios; real guard, no network/DB/model calls)`);
