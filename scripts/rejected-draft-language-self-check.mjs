import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('External requests forbidden in rejected-draft checks'); };
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const original = 'Delivery to region B is guaranteed.';
const corrected = 'The destination and delivery time must be confirmed at checkout.';
const base = {
  character: { id: 'mascot_fixture', category_id: 'mascot' },
  replyResult: { text: original, displayText: original, speechText: original, sourceType: 'ai',
    sourceRef: 'venice-chat-completions', aiModel: 'fixture-generator' },
  language: 'en', userText: 'What is the delivery policy for region B?',
  searchIntent: { commerceRoute: 'store_policy', commerceTopic: 'delivery', knowledgeScope: 'business',
    answerRequired: true, cardAllowed: false, shouldLoadProductContext: false, needsLiveProductData: false,
    replyBoundary: { salesAllowed: false, contactAllowed: false } },
  knowledgeContext: { strategy: 'business_verified_reference', customerServiceIntent: true,
    items: [{ id: 'policy_fixture', scope: 'site', siteId: 'shop_fixture', evidenceQuote: 'Only region A has a published estimate.',
      content: 'Only region A has a published estimate. Other destinations and delivery times must be confirmed at checkout.' }] },
  factualContext: { required: false, status: 'not_required', asOfUtc: '2026-10-28T00:00:00Z', searched: false, items: [] },
  languageQualityRequired: true, independentLanguageQualityRequired: true,
};
const primary = (patch = {}) => ({ allowed: false, confidence: .97, boundarySupported: true,
  businessFactsSupported: false, guidanceSupported: true, evidenceSupported: true, factualSupported: true,
  imageStatusSupported: true, retainedText: '', retainedTextAllowed: false, ...patch });
const approved = { allowed: true, confidence: .97, boundarySupported: true, businessFactsSupported: true,
  guidanceSupported: true, evidenceSupported: true, factualSupported: true, productScopeSupported: true,
  imageStatusSupported: true, guestBenefitSupported: true };
let checks = 0;
async function run({ options = {}, initial = primary(), repair = true, repairResult = 'valid', languageReject = false } = {}) {
  const state = { assessments: [], languages: [], repairs: [], events: [] };
  const input = {
    ...structuredClone(base), ...options,
    assess: async value => { state.assessments.push(value); return structuredClone(state.assessments.length === 1 ? initial : approved); },
    assessLanguageQuality: async value => { state.languages.push(value); return { reviewStatus: 'valid',
      languageQualitySupported: !languageReject, retainedLanguageQualitySupported: !languageReject,
      confidence: .99, languageIssues: languageReject ? [{ type: 'wrong_language', severity: 'major', field: 'both', span: 'Delivery' }] : [],
      severity: languageReject ? 'major' : 'none' }; },
    recordReview: async event => state.events.push(event),
  };
  if (repair) input.repairGroundedReply = async value => {
    state.repairs.push(value);
    if (repairResult === 'null') return null;
    if (repairResult === 'throw') throw new Error('Fixture correction failure');
    return { ...base.replyResult, text: corrected, displayText: corrected, speechText: corrected };
  };
  state.output = await enforceReplyBoundary(input);
  return state;
}
const optimized = await run();
assert.equal(optimized.assessments.length, 2, 'both original and corrected candidates keep primary review'); checks++;
assert.equal(optimized.repairs.length, 1, 'reuse exactly one existing grounded correction'); checks++;
assert.equal(optimized.languages.length, 1, 'rejected original needs no language call; corrected text needs one'); checks++;
assert.equal(optimized.languages[0].text, corrected); checks++;
assert.equal(optimized.repairs[0].assessment, null, 'not-run is not a fabricated language verdict'); checks++;
assert.equal(optimized.repairs[0].reviewResult.languageQualitySupported, undefined); checks++;
assert.deepEqual(optimized.repairs[0].failedContracts, ['business_facts'], 'not-run must not become a language failure'); checks++;
assert.equal(optimized.output.text, corrected); checks++;
assert.notEqual(optimized.output.degraded, true); checks++;
for (const repairResult of ['null', 'throw']) {
  let regeneratedAfterRejection = 0;
  const failed = await run({ repairResult, options: { regenerateReply: async () => { regeneratedAfterRejection++; return null; } } });
  assert.equal(failed.repairs.length, 1, repairResult + ': correction remains single-shot'); checks++;
  assert.equal(failed.assessments.length, 1, repairResult + ': no candidate means no re-review'); checks++;
  assert.equal(failed.languages.length, 0, repairResult + ': no original or fabricated candidate language approval'); checks++;
  assert.equal(failed.output.degraded, true, repairResult + ': correction failure keeps the safe fallback'); checks++;
  assert.notEqual(failed.output.text, original, repairResult + ': rejected original cannot escape'); checks++;
  assert.notEqual(failed.output.text, corrected, repairResult + ': no nonexistent correction is displayed'); checks++;
  assert.equal(failed.events.at(-1).languageDiagnostics.languageReviewStatus, 'not_run'); checks++;
  assert(!failed.events.at(-1).failedContracts.includes('language'), repairResult + ': not-run is not a language failure'); checks++;
  assert.equal(regeneratedAfterRejection, 0, repairResult + ': do not obtain another correction through a different path'); checks++;
}

// If the provider/default path cannot even attempt repair, retain the old audit.
const unavailable = await run({ options: { config: null }, repair: false });
assert.equal(unavailable.languages.length, 1, 'unconfigured correction must not defer language'); checks++;
assert.equal(unavailable.assessments.length, 1); checks++;

for (const [label, initial, options] of [
  ['primary approval', approved, {}],
  ['low confidence', primary({ confidence: .79 }), {}],
  ['invalid tagged primary fields', primary({ reviewStatus: 'valid', allowed: 'false' }), {}],
  ['retained proposal', primary({ retainedText: original, retainedTextAllowed: false }), {}],
  ['already attempted', primary(), { groundedRepairAttempted: true }],
  ['mixed product context', primary(), { productContext: { products: [], cardAllowed: false } }],
  ['unverified knowledge', primary(), { knowledgeContext: { items: [], customerServiceIntent: true } }],
  ['mixed public facts', primary(), { factualContext: { required: true, status: 'matched', searched: true,
    items: [{ title: 'Fixture', content: 'A verified event happened.', url: 'https://example.test/event' }] } }],
  ['image context', primary(), { chatImageContext: { imageStatus: { kind: 'generated', status: 'ready', currentTurn: true } } }],
  ['order action', primary(), { orderActionCandidate: { kind: 'ttmall_order_lookup', status: 'binding_required', siteSlug: 'shop' } }],
  ['too-long correction input', primary(), { replyResult: { ...base.replyResult, text: original.repeat(100) } }],
]) {
  const state = await run({ initial, options });
  assert(state.languages.some(value => value.text === (options.replyResult?.text || original)), label + ': original language review remains'); checks++;
}
const invalid = await run({ initial: { allowed: false, confidence: 0, reviewStatus: 'invalid_json' } });
assert.equal(invalid.languages.length, 0, 'invalid primary keeps existing language-not-run behavior'); checks++;
assert.equal(invalid.repairs.length, 0, 'protocol failure is not a semantic rejection eligible for this optimization'); checks++;
let regenerated = 0;
const protocolRecovery = await run({ initial: { allowed: false, confidence: 0, reviewStatus: 'timeout' },
  options: { regenerateReply: async () => { regenerated++; return { ...base.replyResult, text: corrected, speechText: corrected }; } } });
assert.equal(regenerated, 1, 'unavailable primary retains its existing one-time regeneration'); checks++;
assert.equal(protocolRecovery.repairs.length, 0, 'primary protocol recovery must not become grounded repair'); checks++;
assert.equal(protocolRecovery.languages.length, 1, 'new protocol-recovery candidate retains language review'); checks++;
const finalLanguageFailure = await run({ languageReject: true });
assert.equal(finalLanguageFailure.repairs.length, 1); checks++;
assert.equal(finalLanguageFailure.languages.length, 1); checks++;
assert.equal(finalLanguageFailure.output.degraded, true, 'corrected text still requires full language approval'); checks++;
assert.notEqual(finalLanguageFailure.output.text, corrected); checks++;
const approvedButBadLanguage = await run({ initial: approved, languageReject: true });
assert.equal(approvedButBadLanguage.languages[0].text, original, 'approved primary must still check original language'); checks++;
assert.equal(approvedButBadLanguage.languages.length, 2, 'language-triggered correction still checks both candidates'); checks++;
const clarification = await run({ options: { knowledgeContext: null, userText: 'Do not speak English.',
  searchIntent: { commerceRoute: 'chat', knowledgeScope: 'none', answerRequired: true,
    replyBoundary: { salesAllowed: false, contactAllowed: false } },
  factualContext: { required: false, status: 'not_required', asOfUtc: '2026-10-28T00:00:00Z', searched: false, items: [] } } });
assert.equal(clarification.assessments[0].languageClarificationEligible, true); checks++;
assert.equal(clarification.languages[0].text, original, 'language clarification retains original language path'); checks++;
console.log(`Rejected draft language checks: ${checks} passed (fixture assessments, no provider/DB calls)`);
