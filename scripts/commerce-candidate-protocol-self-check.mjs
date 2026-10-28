// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from 'node:assert/strict';
Object.assign(process.env, { AIOVE_PROVIDER_LOG_WRITE_ENABLED: 'false', VENICE_API_KEY: 'fixture', VENICE_MODEL: 'protocol-primary',
  OPENAI_API_KEY: 'fixture', OPENAI_MODEL: 'protocol-secondary', OPENAI_FALLBACK_API_KEY: 'fixture', OPENAI_FALLBACK_MODEL: 'protocol-tertiary' });
const { classifyCommerceIntentFallback: classifyCommerceIntent } = await import('../server/product-intent-classifier-service.js');
const { requestAiJsonWithProviderFallback } = await import('../server/ai-json-provider-service.js');
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { buildProductSearchIntent } = await import('../server/product-intent-service.js');
const text = 'I want the Real Madrid away shirt without printing.';
const valid = { route: 'product_search', topic: 'other', needsLiveProductData: true, searchQuery: 'Real Madrid away shirt', referencedProductId: '',
  knowledgeScope: 'business', knowledgeQuery: '', answerRequired: false, businessInquiry: null, humanHandoff: null, promotionInquiry: null, checkoutIssue: null,
  replyBoundary: { salesAllowed: true, contactAllowed: true }, commerceConstraints: { edition: null, team: { value: 'Real Madrid', role: 'product_target', evidence: 'Real Madrid' } },
  productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
  productRequirement: { action: 'new', evidence: text, priorTargetEvidence: '', updates: [{ field: 'requestedTeam', value: 'Real Madrid', evidence: 'Real Madrid' }], suspectedTerm: null },
  candidateResponse: { action: 'none', evidence: '', candidateId: '' }, confidence: .99 };
const jevDecision = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: .99 };
let checks = 0;
const check = (condition, label) => { assert(condition, label); checks++; };
function fixture(sequence) {
  const models = [];
  return { models, fetchImpl: async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    const value = sequence[Math.min(models.length - 1, sequence.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }));
  } };
}
for (const broken of ['{broken JSON}', {}, { ...valid, commerceConstraints: { ...valid.commerceConstraints, team: { ...valid.commerceConstraints.team, evidence: 'invented private quotation' } } },
  { ...valid, productRequirement: { ...valid.productRequirement, updates: [{ field: 'requestedTeam', value: 'Real Madrid', evidence: 'fabricated current text' }] } }]) {
  const f = fixture([broken, valid]);
  const result = await classifyCommerceIntent(text, { jevDecision, fetchImpl: f.fetchImpl });
  check(f.models.length === 2 && result.confident && !result.teamConstraintUnverified, 'invalid candidate protocol can recover through one existing backup');
  check(f.models[0] === 'protocol-primary' && f.models[1] === 'protocol-secondary', 'candidate uses the existing primary followed by the original configured backup order');
}
for (const updates of [
  [{ field: 'requestedTeam', value: 'Real Madrid', evidence: 'Real Madrid' }, { field: 'requestedTeam', value: 'Real Madrid', evidence: 'Real Madrid' }],
  [{ field: 'requestedSizes', value: [], evidence: '' }],
]) {
  const f = fixture([{ ...valid, productRequirement: { ...valid.productRequirement, updates } }, valid]);
  const recovered = await classifyCommerceIntent(text, { jevDecision, fetchImpl: f.fetchImpl });
  check(f.models.length === 2 && recovered.productRequirement?.updates.length === 1,
    'duplicate fields and empty update evidence reject the entire protocol, never silently sanitize it');
}
for (const accepted of [{ ...valid, confidence: .4 }, { ...valid, commerceConstraints: { edition: null, team: { value: 'Real Madrid', role: 'location', evidence: 'Real Madrid' } } },
  { ...valid, candidateResponse: { action: 'confirm', evidence: 'I want', candidateId: 'wrong-candidate-id' } }]) {
  const f = fixture([accepted, valid]);
  await classifyCommerceIntent(text, { jevDecision, fetchImpl: f.fetchImpl });
  check(f.models.length === 1, 'a structurally valid interpretation is terminal even if semantic or identity checks will refuse it');
}
const scopeText = 'Real Madrid away shirt and Barcelona home shirt, both without printing. Choose the third.';
const scopeValid = { ...valid, productRequirement: { action: 'new', evidence: 'Real Madrid away shirt', priorTargetEvidence: '', updates: [], suspectedTerm: null },
  productRequest: { relation: 'multiple', action: 'new', items: [
    { evidence: 'Real Madrid away shirt', sharedEvidence: 'without printing' },
    { evidence: 'Barcelona home shirt', sharedEvidence: 'without printing' },
  ], selectedIndex: null, selectionEvidence: '' } };
for (const broken of [
  { ...valid, productRequest: { ...valid.productRequest, selectionEvidence: 'Real Madrid shirt without printing' } },
  { ...valid, productRequest: { ...valid.productRequest, selectionEvidence: 'Assistant-only selection' } },
  { ...scopeValid, productRequest: { ...scopeValid.productRequest, items: [
    { evidence: 'Real Madrid shirt', sharedEvidence: '' }, scopeValid.productRequest.items[1],
  ] } },
  { ...scopeValid, productRequest: { ...scopeValid.productRequest, items: [
    { evidence: 'Real Madrid away shirt', sharedEvidence: 'invented shared condition' }, scopeValid.productRequest.items[1],
  ] } },
]) {
  const f = fixture([broken, scopeValid]);
  const recovered = await classifyCommerceIntent(scopeText, { jevDecision, recentMessages: [{ senderType: 'character', text: 'Assistant-only selection' }], fetchImpl: f.fetchImpl });
  check(f.models.length === 2 && recovered.confident && !recovered.commerceClassificationFailure,
    'invalid current scope quotation uses the existing next provider without granting target or selection permission');
}
for (const request of [scopeValid.productRequest,
  { relation: 'multiple', action: 'select', items: [], selectedIndex: 2, selectionEvidence: 'Choose the third' },
  { relation: 'multiple', action: 'select', items: [], selectedIndex: 2, selectionEvidence: '' },
]) {
  const f = fixture([{ ...scopeValid, productRequest: request }, scopeValid]);
  await classifyCommerceIntent(scopeText, { jevDecision, fetchImpl: f.fetchImpl });
  check(f.models.length === 1, 'grounded multiple quotes, wrong selection and absent semantic selection evidence remain terminal protocol results');
}
const unicodeText = `${text} ${'🙂'.repeat(121)}`;
const excessiveScopeQuote = fixture([{ ...valid, productRequest: { ...valid.productRequest, selectionEvidence: '🙂'.repeat(121) } }, valid]);
await classifyCommerceIntent(unicodeText, { jevDecision, fetchImpl: excessiveScopeQuote.fetchImpl });
check(excessiveScopeQuote.models.length === 2, 'scope quotation uses the same 240-code-unit limit as the downstream scope guard');
const missingCurrentRole = { ...valid, commerceConstraints: { edition: null, team: null },
  productRequirement: { ...valid.productRequirement, updates: [] } };
const roleRecovery = fixture([missingCurrentRole, valid]);
const recoveredRole = await classifyCommerceIntent(text, { jevDecision, fetchImpl: roleRecovery.fetchImpl });
check(roleRecovery.models.length === 2 && recoveredRole.commerceConstraints.team?.role === 'product_target',
  'a confident single target missing both mandatory current-team representations recovers its output protocol through the existing backup');
const routeRecovery = fixture([missingCurrentRole, valid]);
const repairedRoute = await resolveCommerceSearchIntent({ userText: text, searchIntent: buildProductSearchIntent(text),
  siteId: 'shop', characterId: 'mascot_fixture', jevDecision,
  classifyCommerce: (input, options) => classifyCommerceIntent(input, { ...options, fetchImpl: routeRecovery.fetchImpl }) });
check(routeRecovery.models.length === 2 && repairedRoute.cardAllowed && repairedRoute.shouldLoadProductContext
  && repairedRoute.requestedTeam === 'Real Madrid', 'actual routing receives the verified recovered role without inheriting history or bypassing its guards');
for (const accepted of [
  { ...valid, commerceConstraints: { edition: null, team: null } },
  { ...missingCurrentRole, confidence: .4 },
  { ...missingCurrentRole, route: 'chat' },
  { ...missingCurrentRole, replyBoundary: { salesAllowed: false, contactAllowed: true } },
  { ...missingCurrentRole, commerceConstraints: { edition: null, team: { value: 'Real Madrid', role: 'location', evidence: 'Real Madrid' } } },
  { ...missingCurrentRole, commerceConstraints: { edition: null, team: { value: 'Real Madrid', role: 'other', evidence: 'Real Madrid' } } },
]) {
  const f = fixture([accepted, valid]);
  await classifyCommerceIntent(text, { jevDecision, fetchImpl: f.fetchImpl });
  check(f.models.length === 1, 'verified typed TEAM, uncertainty, denied sales and valid non-target roles never seek another team verdict');
}
const multipleNoRole = fixture([{ ...scopeValid, commerceConstraints: { edition: null, team: null } }, valid]);
await classifyCommerceIntent(scopeText, { jevDecision, fetchImpl: multipleNoRole.fetchImpl });
check(multipleNoRole.models.length === 1, 'independent multiple targets cannot be forced into a single mandatory team role');
const noTeamText = 'Show me the shirt.';
const noCurrentTeam = fixture([{ ...missingCurrentRole, productRequirement: { ...missingCurrentRole.productRequirement,
  action: 'continue', evidence: noTeamText } }, valid]);
await classifyCommerceIntent(noTeamText, { jevDecision, siteId: 'shop', characterId: 'mascot_fixture', recentMessages: [{ senderType: 'character',
  productCandidateState: { version: 1, status: 'active', siteId: 'shop', characterId: 'mascot_fixture', owner: 'single',
    targetEvidence: text, requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt' }, proposal: null } }], fetchImpl: noCurrentTeam.fetchImpl });
check(noCurrentTeam.models.length === 1, 'a scoped continuation with no current team mention remains terminal without promoting a historical team into current role evidence');
const roleExhausted = fixture([missingCurrentRole]);
const exhaustedRole = await classifyCommerceIntent(text, { jevDecision, fetchImpl: roleExhausted.fetchImpl });
check(roleExhausted.models.length === 3 && !exhaustedRole.confident && exhaustedRole.commerceClassificationFailure === 'missing_fields',
  'persistently absent mandatory role stops after the existing finite provider chain and grants no search permission');
const routeExhausted = fixture([missingCurrentRole]);
const blockedRole = await resolveCommerceSearchIntent({ userText: text, searchIntent: buildProductSearchIntent(text),
  siteId: 'shop', characterId: 'mascot_fixture', jevDecision,
  classifyCommerce: (input, options) => classifyCommerceIntent(input, { ...options, fetchImpl: routeExhausted.fetchImpl }) });
check(routeExhausted.models.length === 3 && !blockedRole.cardAllowed && !blockedRole.shouldLoadProductContext
  && blockedRole.commerceClassificationUnavailable, 'actual routing stays fail-closed after all mandatory-role outputs fail');
const explicit = fixture(['{bad}']);
const explicitResult = await classifyCommerceIntent(text, { jevDecision, config: { apiKey: 'fixture', baseUrl: 'https://fixture.invalid', model: 'explicit' }, fetchImpl: explicit.fetchImpl });
check(explicit.models.length === 1 && explicitResult.commerceClassificationFailure === 'parse', 'explicit fixture overrides never reach configured backups');
const exhausted = fixture([{ ...valid, commerceConstraints: { edition: null, team: { value: 'Real Madrid', role: 'product_target', evidence: 'invented private quotation' } } }]);
const exhaustedResult = await classifyCommerceIntent(text, { jevDecision, fetchImpl: exhausted.fetchImpl });
check(exhausted.models.length === 3 && !exhaustedResult.confident && exhaustedResult.commerceClassificationFailure === 'missing_fields', 'all invalid protocols stop after the finite provider chain');
check(!JSON.stringify(exhaustedResult).includes('invented private quotation'), 'upstream invalid text cannot escape into public failure fields');
const ordinary = fixture(['{bad}', valid]);
await assert.rejects(requestAiJsonWithProviderFallback([{ role: 'user', content: 'ordinary JSON task' }], { fetchImpl: ordinary.fetchImpl, recordProviderCallFn: async () => {} }), error => error.code === 'AI_JSON_PARSE_ERROR');
check(ordinary.models.length === 1, 'non-opted-in JSON consumers retain immediate parse failure');
let now = 0;const budgets = [], logs = [];
const output = await requestAiJsonWithProviderFallback([{ role: 'user', content: 'protocol' }], { timeoutMs: 1000, nowFn: () => now,
  validateParsed: parsed => ({ valid: parsed.ok === true, reason: 'evidence' }), recordProviderCallFn: async event => logs.push(event),
  fetchImpl: async (_url, options) => { budgets.push(options.signal);now += 600;return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: now > 600 }) } }] })); } });
check(output.ok === true && budgets.length === 2, 'validated output recovers without restarting the deadline');
check(logs.some(event => event.error?.code === 'AI_JSON_INVALID_OUTPUT' && event.error?.message === 'AI JSON protocol rejected: evidence'), 'protocol rejection is separately recorded with a finite safe reason');
let classificationFailureCalls = 0;
const chainedFailure = await classifyCommerceIntent(text, { jevDecision, fetchImpl: async () => {
  classificationFailureCalls++;
  if (classificationFailureCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...valid,
    productRequirement: { ...valid.productRequirement, updates: [{ field: 'requestedSizes', value: [], evidence: '' }] } }) } }] }));
  throw Object.assign(new Error('private response body'), { code: 'AI_REPLY_TIMEOUT', retryable: true });
} });
check(chainedFailure.commerceClassificationFailure === 'timeout' && chainedFailure.commerceClassificationFailures?.length === 3,
  'classification preserves its compatible final reason alongside the complete finite failure sequence');
check(chainedFailure.commerceClassificationFailures[0].kind === 'protocol_evidence'
  && chainedFailure.commerceClassificationFailures.slice(1).every(failure => failure.kind === 'timeout'),
  'the primary invalid output cannot be concealed by two later timeouts');
check(!JSON.stringify(chainedFailure).includes('private response body'), 'classification failure trace contains no upstream body');
let clock = 0, independentCalls = 0;
const independent = await requestAiJsonWithProviderFallback([{ role: 'user', content: 'protocol' }], {
  timeoutMs: 1000, perProviderTimeout: true, nowFn: () => clock,
  validateParsed: parsed => ({ valid: parsed.ok === true, reason: 'evidence' }), recordProviderCallFn: async () => {},
  fetchImpl: async () => { independentCalls++; clock += 1000; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: independentCalls === 3 }) } }] })); },
});
check(independent.ok === true && independentCalls === 3, 'each opted-in classification provider starts with its own deadline');
let failureCalls = 0;
await assert.rejects(requestAiJsonWithProviderFallback([{ role: 'user', content: 'protocol' }], {
  timeoutMs: 1000, perProviderTimeout: true, validateParsed: () => ({ valid: false, reason: 'evidence' }), recordProviderCallFn: async () => {},
  fetchImpl: async () => { failureCalls++; if (failureCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":false}' } }] }));
    throw Object.assign(new Error('private response body'), { code: 'AI_REPLY_TIMEOUT', retryable: true }); },
}), error => {
  check(error.aiJsonProviderFailures?.length === 3, 'failure chain retains the primary protocol failure before backup timeouts');
  check(JSON.stringify(error.aiJsonProviderFailures) === JSON.stringify([{ provider: 'venice', kind: 'protocol_evidence' }, { provider: 'openai', kind: 'timeout' }, { provider: 'deepseek', kind: 'timeout' }]), 'failure categories and provider order are finite and safe');
  return error.code === 'AI_REPLY_TIMEOUT';
});
console.log(`commerce candidate protocol self-check passed (${checks} checks; fixture providers only)`);

// Legacy explicit configurations keep their smaller response contract, but the
// mandatory route/confidence/boundary protocol must fail INSIDE finite fallback.
const explicitProviders = ['one', 'two', 'three'].map(name => ({ id: name, apiKey: 'fixture', model: name,
 baseUrl: 'https://explicit.invalid/v1', apiMode: 'chat_completions' }));
const minimal = { route: 'store_policy', confidence: .95, replyBoundary: { salesAllowed: false, contactAllowed: true } };
for (const malformed of [
 { ...minimal, route: 'invented' }, { ...minimal, confidence: '0.95' },
]) {
 const f = fixture([malformed, minimal]);
 const recovered = await classifyCommerceIntent('A general store-policy question', { config: explicitProviders, fetchImpl: f.fetchImpl });
 check(f.models.length === 2 && recovered.boundaryVerified && !recovered.commerceClassificationFailure,
  'missing mandatory legacy protocol advances only the supplied finite provider chain');
}
for (const terminal of [{ ...minimal, confidence: .4 }, { ...minimal, replyBoundary: { salesAllowed: false, contactAllowed: false } }]) {
 const f = fixture([terminal, minimal]);
 await classifyCommerceIntent('A general store-policy question', { config: explicitProviders, fetchImpl: f.fetchImpl });
 check(f.models.length === 1, 'valid low confidence and closed boundaries are terminal semantic decisions');
}
for (const replyBoundary of [undefined,{salesAllowed:false},{salesAllowed:'false',contactAllowed:true}]) {
 const f=fixture([{...minimal,replyBoundary,answerRequired:true,knowledgeQuery:'current concern'},minimal]);
 const closed=await classifyCommerceIntent('A general store-policy question',{config:explicitProviders,fetchImpl:f.fetchImpl});
 check(f.models.length===1 && closed.answerRequired && closed.knowledgeQuery==='current concern' && !closed.boundaryVerified
  && !closed.replyBoundary.salesAllowed && !closed.replyBoundary.contactAllowed,'legacy unverified boundary closes invitations while preserving valid substantive questions');
}
const legacyExhausted = fixture([{ confidence: .95 }]);
const legacyFailure = await classifyCommerceIntent('A general store-policy question', { config: explicitProviders, fetchImpl: legacyExhausted.fetchImpl });
check(legacyExhausted.models.length === 3 && legacyFailure.commerceClassificationFailure === 'missing_fields', 'all-invalid legacy protocol stops after each configured provider once');
check(legacyFailure.commerceClassificationFailures.length === 3, 'finite protocol exhaustion retains sanitized provider diagnostics');
console.log('legacy mandatory classification protocol finite fallback and terminal semantic votes passed');
// Default strict validation also applies without a confident JEV product label.
const defaultBoundaryMissing = structuredClone(valid);
delete defaultBoundaryMissing.replyBoundary;
const defaultBoundaryRecovery = fixture([defaultBoundaryMissing, valid]);
const defaultRecovered = await classifyCommerceIntent(text, { fetchImpl: defaultBoundaryRecovery.fetchImpl });
check(defaultBoundaryRecovery.models.length === 2 && defaultRecovered.boundaryVerified && !defaultRecovered.commerceClassificationFailure,
 'default non-candidate strict task rejects missing boundary before selecting a provider');
const defaultLowConfidence = fixture([{ ...valid, confidence: .4 }, valid]);
const lowConfidenceDecision = await classifyCommerceIntent(text, { fetchImpl: defaultLowConfidence.fetchImpl });
check(defaultLowConfidence.models.length === 1 && lowConfidenceDecision.boundaryVerified && !lowConfidenceDecision.confident
 && !lowConfidenceDecision.commerceClassificationFailure, 'default valid low confidence is uncertainty rather than missing fields');
const historicalText = 'Real Madrid jersey 2022';
const historical = { ...valid, productRequirement: { action: 'new', evidence: historicalText, priorTargetEvidence: '',
 updates: [{ field: 'requestedSeason', value: '2022', evidence: '2022' }], suspectedTerm: null } };
const historicalValid = fixture([historical]);
const historicalResult = await classifyCommerceIntent(historicalText, { jevDecision, fetchImpl: historicalValid.fetchImpl });
check(historicalValid.models.length === 1 && historicalResult.productRequirement?.updates[0]?.value === '2022', 'historical single year survives strict protocol and requirement normalization');
const inventedPair = fixture([{ ...historical, productRequirement: { ...historical.productRequirement,
 updates: [{ field: 'requestedSeason', value: '2022/23', evidence: '2022' }] } }, historical]);
const pairResult = await classifyCommerceIntent(historicalText, { jevDecision, fetchImpl: inventedPair.fetchImpl });
check(inventedPair.models.length === 2 && pairResult.productRequirement?.updates[0]?.value === '2022', 'a quoted year cannot manufacture an adjacent full season');
const historicalUncertain = fixture([{ ...historical, confidence: .4 }, historical]);
await classifyCommerceIntent(historicalText, { jevDecision, fetchImpl: historicalUncertain.fetchImpl });
check(historicalUncertain.models.length === 1, 'valid historical year at low confidence remains terminal');
const yearContinuationLocation = { siteId: 'year-shop', characterId: 'year-character' };
const yearContinuationHistory = [{ senderType: 'character', productCandidateState: { version: 1, status: 'active', ...yearContinuationLocation,
 owner: 'single', targetEvidence: 'Barcelona shirt', requirements: { requestedTeam: 'Barcelona', requestedProductType: 'shirt', requestedSeason: '2022' }, proposal: null } }];
const yearContinuation = { ...historical, commerceConstraints: { edition: null, team: null }, productRequirement: {
 action: 'continue', evidence: '2020 instead', priorTargetEvidence: '', updates: [{ field: 'requestedSeason', value: '2020', evidence: '2020' }], suspectedTerm: null } };
const continuationFixture = fixture([yearContinuation]);
const continuationResult = await classifyCommerceIntent('2020 instead', { ...yearContinuationLocation, recentMessages: yearContinuationHistory, jevDecision,
 fetchImpl: continuationFixture.fetchImpl });
check(continuationFixture.models.length === 1 && continuationResult.productRequirement?.updates[0]?.value === '2020', 'an active owned team target supplies only team context for a current single-year revision');
const absentYear = fixture([{ ...yearContinuation, productRequirement: { ...yearContinuation.productRequirement,
 evidence: 'instead', updates: [{ field: 'requestedSeason', value: '2020', evidence: 'instead' }] } }]);
const absentYearResult = await classifyCommerceIntent('instead', { ...yearContinuationLocation, recentMessages: yearContinuationHistory, jevDecision,
 fetchImpl: absentYear.fetchImpl });
check(absentYearResult.commerceClassificationFailure === 'missing_fields' && absentYear.models.length === 3,
 'owned prior target cannot manufacture an unmentioned current year');
