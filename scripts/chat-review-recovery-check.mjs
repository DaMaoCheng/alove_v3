import assert from "node:assert/strict";

// Production transport/parser/guard, with only the upstream HTTP response injected.
// No real provider, database or voice generation may be reached by this check.
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = "false";
globalThis.fetch = async () => { throw new Error("External requests forbidden in review recovery checks"); };
const { assessReplyBoundary, enforceReplyBoundary } = await import("../server/chat-reply-boundary-service.js");
const { buildFactualUnavailableCopy } = await import("../server/chat-factual-policy.js");
const { buildReplyReviewLogEvent } = await import("../server/ai-reply-log-service.js");

const config = { id: "fixture", apiMode: "chat_completions", apiKey: "controlled-placeholder",
  baseUrl: "https://fixture.invalid/v1", model: "controlled-review" };
const factualCopy = buildFactualUnavailableCopy("hu");
const candidate = { text: "Sajnálom, hogy visszautasított. Itt vagyok, meghallgatlak.",
  speechText: "Sajnálom, hogy visszautasított. Itt vagyok, meghallgatlak." };
const ordinary = { replyResult: candidate,
  searchIntent: { commerceRoute: "chat", answerRequired: false, shouldLoadProductContext: false },
  factualContext: { required: false, status: "not_required", searched: false,
    asOfUtc: "2026-10-11T11:24:29.000Z", items: [] },
  userText: "Nem sajnos mert el utasított", language: "hu", languageQualityRequired: true };
const approved = { allowed: true, confidence: .99, languageQualitySupported: true,
  factualSupported: true, evidenceSupported: true, guidanceSupported: true };
const retainedVerdict = { ...approved, allowed: false, factualSupported: false,
  retainedText: candidate.text, retainedTextAllowed: true, retainedBoundarySupported: true,
  retainedFactualSupported: true, retainedLanguageQualitySupported: true };
const mixedCandidate = { text: `${candidate.text}\n\nThe event finished 2–1.`,
  speechText: `${candidate.text}\n\nThe event finished 2–1.` };
const cases = [
  { name: "approved", verdict: approved, status: "valid", preserved: true },
  { name: "language_rejected", verdict: { ...approved, allowed: false, languageQualitySupported: false },
    status: "valid", factCopy: false },
  { name: "missing_factual_field", verdict: { ...approved, factualSupported: undefined },
    status: "missing_fields", factCopy: false, missingFact: true },
  { name: "invalid_review_json", raw: "{not-valid-json", status: "invalid_json", factCopy: false },
  { name: "factual_rejected", verdict: { ...approved, allowed: false, factualSupported: false },
    status: "valid", factCopy: true, explicitFactFalse: true },
  { name: "template_irrelevant", replyResult: { text: factualCopy, speechText: factualCopy },
    verdict: { ...approved, factualLimitationRelevant: false }, status: "valid", factCopy: false },
  { name: "template_relevant", replyResult: { text: factualCopy, speechText: factualCopy },
    userText: "Kérlek, ellenőrizd a mai eredményt.",
    factualContext: { ...ordinary.factualContext, required: true, status: "disabled", reason: "search_disabled" },
    verdict: { ...approved, factualLimitationRelevant: true }, status: "valid", preserved: true },
  { name: "explicit_template_quotation", replyResult: { text: factualCopy, speechText: factualCopy },
    userText: "Kérlek, idézd pontosan ezt a mondatot: Ezt a tényt most nem tudom ellenőrizni, ezért nem fogok találgatni.",
    verdict: { ...approved, factualLimitationRelevant: true }, status: "valid", preserved: true },
  { name: "explicit_template_translation", replyResult: { text: factualCopy, speechText: factualCopy },
    userText: "Fordítsd magyarra: I can’t verify that fact right now, so I won’t guess.",
    verdict: { ...approved, factualLimitationRelevant: true }, status: "valid", preserved: true },
  { name: "template_missing_relevance", replyResult: { text: factualCopy, speechText: factualCopy },
    verdict: approved, status: "missing_fields", factCopy: false },
  { name: "review_timeout", timeout: true, status: "timeout", factCopy: false },
  { name: "missing_allowed_cannot_retain", replyResult: mixedCandidate,
    verdict: { ...retainedVerdict, allowed: undefined }, status: "missing_fields", factCopy: false,
    blockedRemainder: candidate.text },
  { name: "invalid_language_flag_cannot_retain", replyResult: mixedCandidate,
    verdict: { ...retainedVerdict, languageQualitySupported: "true" }, status: "invalid_fields", factCopy: false,
    blockedRemainder: candidate.text },
  { name: "irrelevant_template_cannot_return_via_fact_fallback", replyResult: { text: factualCopy, speechText: factualCopy },
    verdict: { ...approved, allowed: false, factualSupported: false, factualLimitationRelevant: false },
    status: "valid", factCopy: false },
  { name: "irrelevant_template_cannot_return_via_retained", replyResult: {
    text: `${factualCopy}\n\nThe event finished 2–1.`, speechText: `${factualCopy}\n\nThe event finished 2–1.` },
    verdict: { ...retainedVerdict, factualLimitationRelevant: false, retainedText: factualCopy },
    status: "valid", factCopy: false },
  { name: "valid_product_evidence_remainder", replyResult: mixedCandidate,
    searchIntent: { commerceRoute: "product_question", answerRequired: true, needsLiveProductData: true },
    productContext: { products: [], searchOutcome: "no_match" },
    verdict: { ...retainedVerdict, factualSupported: true, evidenceSupported: false, retainedEvidenceSupported: true },
    status: "valid", factCopy: false, retainedIncludes: candidate.text },
  { name: "valid_business_remainder", replyResult: mixedCandidate, character: { categoryId: "mascot" },
    searchIntent: { commerceRoute: "store_policy", answerRequired: true, knowledgeScope: "business", commerceTopic: "other" },
    verdict: { ...retainedVerdict, factualSupported: true, businessFactsSupported: false, retainedBusinessFactsSupported: true },
    status: "valid", factCopy: false, retainedIncludes: candidate.text },
  { name: "valid_image_remainder", replyResult: mixedCandidate,
    chatImageContext: { imageStatus: { kind: "generated", status: "failed", currentTurn: true } },
    verdict: { ...retainedVerdict, factualSupported: true, imageStatusSupported: false,
      imageStatusRelevant: true, imageReferenceMatched: true, retainedImageStatusSupported: true },
    status: "valid", factCopy: false, retainedIncludes: candidate.text },
];

let checks = 0;
const failures = [];
function check(name, assertion) {
  checks++;
  try { assertion(); } catch (error) { failures.push(`${name}: ${error.message}`); }
}
for (const scenario of cases) {
  let calls = 0;
  let assessment;
  const events = [];
  const diagnostics = [];
  const logContext = { requestId: `input_${scenario.name}`, sessionId: "session_fixture", characterId: "character_fixture" };
  const input = { ...ordinary, ...scenario, logContext, replyResult: scenario.replyResult || candidate };
  const output = await enforceReplyBoundary({ ...input, recordReview: async (event) => diagnostics.push(event), assess: async (options) => {
    check(`${scenario.name}: UTC review remains active`, () => assert.equal(options.factualRequired, true));
    check(`${scenario.name}: search requirement is independent`, () => assert.equal(options.factualContext.required, input.factualContext.required));
    assessment = await assessReplyBoundary({ ...options, config, recordLog: async (event) => events.push(event),
      fetchImpl: async (_url, request) => {
        calls++;
        const body = JSON.parse(request.body);
        const data = JSON.parse(body.messages.findLast((message) => message.role === "user").content);
        check(`${scenario.name}: exact candidate reaches original review`, () => assert.equal(data.proposedResponse, input.replyResult.text));
        check(`${scenario.name}: speech reaches original review`, () => assert.equal(
          data.proposedSpeech.replace(/\s+/g, " ").trim(), input.replyResult.speechText.replace(/\s+/g, " ").trim()));
        if (scenario.timeout) return new Promise((_resolve, reject) => {
          const abort = () => reject(Object.assign(new Error("Controlled abort"), { name: "AbortError" }));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener("abort", abort, { once: true });
        });
        const content = scenario.raw ?? JSON.stringify(scenario.verdict);
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200, headers: { "content-type": "application/json" } });
      } });
    return assessment;
  } });
  check(`${scenario.name}: one existing review only`, () => assert.equal(calls, 1));
  check(`${scenario.name}: typed review status`, () => assert.equal(assessment.reviewStatus, scenario.status));
  check(`${scenario.name}: transport event independently recorded`, () => assert.equal(events[0]?.status, scenario.timeout ? "error" : "success"));
  check(`${scenario.name}: provider event bound to original request/session`, () => {
    assert.equal(events[0]?.requestId, logContext.requestId);
    assert.equal(events[0]?.sessionId, logContext.sessionId);
    assert.equal(events[0]?.characterId, logContext.characterId);
  });
  check(`${scenario.name}: one semantic diagnostic bound to same request`, () => {
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0].logContext, logContext);
    assert.equal(diagnostics[0].reviewStatus, scenario.status);
    assert.equal(diagnostics[0].guardApplied, !scenario.preserved);
    assert.equal(JSON.stringify(diagnostics[0]).includes(input.userText), false);
    if (scenario.status !== "valid") assert.deepEqual(diagnostics[0].failedContracts, [],
      "an invalid or unavailable review cannot be recorded as a semantic rejection");
  });
  check(`${scenario.name}: display/speech stay aligned`, () => assert.equal(output.speechText, output.text));
  if (scenario.missingFact) check(`${scenario.name}: absent fact is not a semantic rejection`, () => assert.equal(assessment.factualSupported, undefined));
  if (scenario.explicitFactFalse) check(`${scenario.name}: explicit rejection survives parsing`, () => assert.equal(assessment.factualSupported, false));
  if (scenario.preserved) check(`${scenario.name}: approved exact output preserved`, () => assert.equal(output.text, input.replyResult.text));
  else {
    check(`${scenario.name}: unchecked candidate cannot escape`, () => assert.notEqual(output.text, input.replyResult.text));
    check(`${scenario.name}: degraded state is explicit`, () => assert.equal(output.degraded, true));
    if (scenario.status !== "valid") check(`${scenario.name}: recovery preserves transport/shape failure without semantic accusations`,
      () => assert.deepEqual(output.replyRecoveryState.failedContracts, []));
  }
  if (typeof scenario.factCopy === "boolean") check(`${scenario.name}: factual fallback matches actual failure`,
    () => assert.equal(output.text.includes(factualCopy), scenario.factCopy));
  if (scenario.blockedRemainder) check(`${scenario.name}: invalid review cannot authorize any retained candidate`,
    () => assert.equal(output.text.includes(scenario.blockedRemainder), false));
  if (scenario.retainedIncludes) check(`${scenario.name}: independent valid remainder still works`, () => {
    assert.equal(output.text.includes(scenario.retainedIncludes), true);
    assert.equal(output.partialAnswerRetained, true);
  });
}

// No new factual/relevance field is required by the ordinary quality-only path.
let controlCalls = 0;
const noClock = await enforceReplyBoundary({ ...ordinary, factualContext: null, assess: async (options) => {
  controlCalls++;
  check("no_clock: fact contract remains inactive", () => assert.equal(options.factualRequired, false));
  return assessReplyBoundary({ ...options, config, recordLog: async () => {}, fetchImpl: async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ allowed: true,
      confidence: .99, languageQualitySupported: true }) } }] }), { status: 200 }) });
} });
check("no_clock: original quality review still suffices", () => assert.equal(noClock, candidate));
check("no_clock: no extra model call", () => assert.equal(controlCalls, 1));

const transportCandidate = { text: "The server took too long to respond. Please try again later.",
  sourceRef: "ai-request-failed-fallback", degradationReason: "ai_request_failed_fallback" };
let transportCalls = 0;
const transportDiagnostics = [];
const transportOutput = await enforceReplyBoundary({ ...ordinary, replyResult: transportCandidate,
  assess: async () => { transportCalls++; throw new Error("Transport fallback must not seek a new verdict"); },
  recordReview: async (event) => transportDiagnostics.push(event) });
check("transport_fallback: safe existing reply remains untouched", () => assert.equal(transportOutput, transportCandidate));
check("transport_fallback: review is not called", () => assert.equal(transportCalls, 0));
check("transport_fallback: diagnostic distinguishes not_run from rejection", () => {
  assert.equal(transportDiagnostics.length, 1);
  assert.equal(transportDiagnostics[0].reviewStatus, "not_run");
  assert.equal(transportDiagnostics[0].guardApplied, false);
});

check("review_log: exact request/session and safe semantic fields", () => {
  const event = buildReplyReviewLogEvent({ logContext: { requestId: "input_fixture", sessionId: "session_fixture",
    characterId: "character_fixture", userId: "user_fixture", userText: "private words" },
    reviewStatus: "valid", failedContracts: ["language", "language", "private words"], guardApplied: true,
    fallbackKind: "language", candidateHasFactualTemplate: false, outputHasFactualTemplate: false, outputChars: 42 });
  assert.equal(event.requestId, "input_fixture");
  assert.equal(event.sessionId, "session_fixture");
  assert.equal(event.characterId, "character_fixture");
  assert.equal(event.userId, "user_fixture");
  assert.equal(event.outputChars, 42);
  assert.deepEqual(JSON.parse(event.errorMessage).failedContracts, ["language"]);
  assert.equal(JSON.stringify(event).includes("private words"), false);
});
check("review_log: invalid identifiers/status cannot leak", () => {
  const event = buildReplyReviewLogEvent({ logContext: { requestId: "private email@example.com", sessionId: "unsafe id" },
    reviewStatus: "private words", fallbackKind: "private words", failedContracts: ["private words"] });
  assert.equal(event.requestId, "");
  assert.equal(event.sessionId, "");
  assert.equal(JSON.stringify(event).includes("private"), false);
});

if (failures.length) {
  console.error(`Review recovery check failed: ${failures.length}/${checks} assertions`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else console.log(`Review recovery check passed (${checks} assertions; injected HTTP/parser/guard only, no external requests or DB)`);
