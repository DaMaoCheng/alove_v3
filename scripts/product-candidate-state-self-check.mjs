import assert from 'node:assert/strict';
import { resolveCommerceSearchIntent } from '../server/commerce-routing-service.js';
import { buildProductSearchIntent } from '../server/product-intent-service.js';
import { normalizeCommerceDecision } from '../server/product-intent-classifier-service.js';
import {
  applyProductCandidateState, markProductCandidateDisplayed, readProductCandidateState,
  normalizeProductRequirementDecision, mergeProductCandidatePayload, stripProductCandidatePayload, clearProductCandidateState, finalizeProductCandidateState,
} from '../server/product-candidate-state-service.js';

const location = { siteId: 'site-one', characterId: 'character-one' };
const intent = { commerceRoute: 'product_search', shouldLoadProductContext: true, cardAllowed: true,
  replyBoundary: { salesAllowed: true }, requestedTeam: 'Real Madrid', requestedProductType: 'shirt',
  requestedSeason: '2026/27', requestedVariants: ['away'], customizationRequest: 'jersey' };
const decision = (action, text, updates = [], extra = {}) => ({ confident: true,
  productRequirement: { action, evidence: text, updates, suspectedTerm: null }, ...extra });
const run = (current, semantic, userText, state = null, extra = {}) => applyProductCandidateState(current, semantic,
  { ...location, userText, recentMessages: state ? [{ senderType: 'character', productCandidateState: state }] : [], ...extra });
const text = 'Busco Real Madrid away 2026/27 sin nombre ni número';
const first = run(intent, decision('new', text, [{ field: 'requestedPrinting', value: 'none', evidence: 'sin nombre ni número' }]), text);
assert.equal(first.candidateSearchAllowed, true);
assert.equal(first.requestedPrinting, 'none');
assert.equal(first.customizationRequest, '');
const short = 'Me facilitas el enlace en manga corta';
const followup = run({ ...intent, requestedTeam: '', requestedSeason: '' }, decision('continue', short,
  [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'manga corta' }]), short, first.productCandidateState);
assert.equal(followup.requestedTeam, 'Real Madrid');
assert.equal(followup.requestedSeason, '2026/27');
assert.equal(followup.requestedPrinting, 'none');
assert.deepEqual(followup.requestedFeatures, ['short_sleeve']);
const printText = 'print number 7';
const printing = run(buildProductSearchIntent(printText), decision('continue', printText), printText, followup.productCandidateState);
assert.equal(printing.requestedPrintNumber, '7');
assert.equal(printing.customizationRequest, 'jersey');
assert.equal(printing.productCustomizationRequest, true);
assert.equal(printing.requestedPrinting, '');
assert.equal(printing.requestedTeam, 'Real Madrid');
assert.deepEqual(printing.requestedFeatures, ['short_sleeve']);
const removePrinting = 'no customization and no number';
const removed = run(buildProductSearchIntent(removePrinting), decision('continue', removePrinting), removePrinting, printing.productCandidateState);
assert.equal(removed.requestedPrintNumber, '');
assert.equal(removed.customizationRequest, '');
assert.ok(removed.clearFields.includes('requestedPrintNumber'));
const restoredPrinting = run(buildProductSearchIntent(printText), decision('continue', printText), printText, removed.productCandidateState);
assert.equal(restoredPrinting.requestedPrintNumber, '7');
assert.equal(restoredPrinting.customizationRequest, 'jersey');
assert.deepEqual(restoredPrinting.clearFields, []);
const semanticNoPrinting = run(buildProductSearchIntent(printText), decision('continue', printText,
  [{ field: 'requestedPrinting', value: 'none', evidence: printText }]), printText, printing.productCandidateState);
assert.equal(semanticNoPrinting.requestedPrintNumber, '');
assert.equal(semanticNoPrinting.customizationRequest, '');
const ageText = 'for 6 years old';
const age = run(buildProductSearchIntent(ageText), decision('continue', ageText), ageText, followup.productCandidateState);
assert.equal(age.requestedAgeRange, '6 year');
assert.equal(age.requestedAudience, 'kids');
assert.equal(age.requestedSeason, '2026/27');
const plusText = 'plus size';
const plus = run(buildProductSearchIntent(plusText), decision('continue', plusText), plusText, age.productCandidateState);
assert.equal(plus.requestedSizeProfile, 'plus_size');
assert.equal(plus.requestedAgeRange, '6 year');
assert.equal(plus.requestedPrinting, 'none');
const inheritedRouting = run({ ...intent, requestedPrintNumber: '99', customizationRequest: 'jersey', requestedAgeRange: '12 year' },
  decision('continue', 'same link'), 'same link', followup.productCandidateState);
assert.equal(inheritedRouting.requestedPrintNumber, '');
assert.equal(inheritedRouting.customizationRequest, '');
assert.equal(inheritedRouting.requestedAgeRange, '');
const independentText = 'Barcelona home shirt';
const independent = run(buildProductSearchIntent(independentText), decision('new', independentText), independentText, plus.productCandidateState);
assert.equal(independent.requestedAgeRange, '');
assert.equal(independent.requestedSizeProfile, '');
assert.equal(independent.requestedPrinting, '');
const product = { productId: '709334', name: 'Catalogue Fan Jersey', matchStatus: 'candidate', siteId: location.siteId };
const displayed = markProductCandidateDisplayed(followup.productCandidateState, product,
  { approvedReply: '¿Es esta la que buscas?', confirmationRequested: true });
const omittedRefinement = run(intent, decision('continue', 'La quiero en manga larga'), 'La quiero en manga larga', displayed);
assert.deepEqual(omittedRefinement.requestedFeatures, ['long_sleeve'], 'A semantic omission must not erase an explicit established garment constraint');
const contrastText = 'No la quiero en manga larga, la quiero en manga corta';
const contrast = run(intent, decision('continue', contrastText, [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'la quiero en manga corta' }]), contrastText, displayed);
assert.deepEqual(contrast.requestedFeatures, ['short_sleeve'], 'Lexical mentions must not override a grounded revision that distinguishes rejected and requested specifications');
assert.equal(displayed.proposal.status, 'displayed');
const confirm = run(intent, decision('continue', 'sí', [], { candidateResponse: { action: 'confirm', evidence: 'sí', candidateId: '709334' } }), 'sí', displayed);
assert.equal(confirm.confirmedCandidateId, '709334');
assert.equal(confirm.productCandidateState.proposal.confirmationEvidence, 'sí');
assert.equal(finalizeProductCandidateState(confirm.productCandidateState, product, { evidenceVerified: false }).proposal, null,
  'A failed whole evidence review must not persist unverified identity confirmation');
assert.equal(finalizeProductCandidateState(confirm.productCandidateState, product, { evidenceVerified: true }).proposal.status, 'confirmed');
for (const otherProduct of [{ ...product, siteId: '' }, { ...product, siteId: 'other' }, { ...product, productId: 'other' }]) {
  assert.equal(finalizeProductCandidateState(confirm.productCandidateState, otherProduct, { evidenceVerified: true }).proposal, null);
}
assert.equal(confirm.requestedPrinting, 'none');
assert.deepEqual(confirm.requestedFeatures, ['short_sleeve']);
const confirmAndRevise = run(intent, decision('continue', 'sí, manga larga',
  [{ field: 'requestedFeatures', value: ['long_sleeve'], evidence: 'manga larga' }],
  { candidateResponse: { action: 'confirm', evidence: 'sí', candidateId: '709334' } }), 'sí, manga larga', displayed);
assert.equal(confirmAndRevise.confirmedCandidateId, '709334');
assert.deepEqual(confirmAndRevise.requestedFeatures, ['long_sleeve']);
const fanDisplayed = { ...displayed, requirements: { ...displayed.requirements, requestedEdition: 'fan' } };
const fanAssentText = 'Yes, that fan is the one. Keep short sleeves.';
const noOpEditionAssent = run(intent, decision('continue', fanAssentText,
  [{ field: 'requestedEdition', value: 'fan', evidence: 'fan' }],
  { candidateResponse: { action: 'confirm', evidence: 'Yes, that fan is the one', candidateId: '709334' } }), fanAssentText, fanDisplayed);
assert.equal(noOpEditionAssent.productCandidateState.proposal?.status, 'confirmed', 'An overlapping repeated edition condition must not erase current identity assent');
const playerAssentText = 'Yes, that player is the one.';
const changedEditionAssent = run(intent, decision('continue', playerAssentText,
  [{ field: 'requestedEdition', value: 'player', evidence: 'player' }],
  { candidateResponse: { action: 'confirm', evidence: 'Yes, that player is the one', candidateId: '709334' } }), playerAssentText, fanDisplayed);
assert.notEqual(changedEditionAssent.productCandidateState.proposal?.status, 'confirmed', 'A genuine changed edition still needs independent identity assent evidence');
const mixedAssentText = 'Yes, that fan is the one. Now long sleeves.';
const mixedAssent = run(intent, decision('continue', mixedAssentText,
  [{ field: 'requestedEdition', value: 'fan', evidence: 'fan' }, { field: 'requestedFeatures', value: ['long_sleeve'], evidence: 'long sleeves' }],
  { candidateResponse: { action: 'confirm', evidence: 'Yes, that fan is the one', candidateId: '709334' } }), mixedAssentText, fanDisplayed);
assert.equal(mixedAssent.productCandidateState.proposal?.status, 'confirmed', 'A real independent revision does not make another overlapping no-op condition a changed field');
assert.deepEqual(mixedAssent.productCandidateState.requirements.requestedFeatures, ['long_sleeve']);
const reject = run(intent, decision('continue', 'No, solo la que dije', [], { candidateResponse: { action: 'reject', evidence: 'No', candidateId: '709334' } }), 'No, solo la que dije', displayed);
assert.equal(reject.rejectedCandidateId, '709334');
assert.equal(reject.confirmedCandidateId, undefined);
const hidden = markProductCandidateDisplayed(displayed, product, { approvedReply: 'No puedo verificarlo', confirmationRequested: false });
assert.equal(hidden.proposal, null);
assert.equal(hidden.status, 'active');
assert.equal(hidden.requirements.requestedTeam, 'Real Madrid');
assert.equal(hidden.requirements.requestedPrinting, 'none');
assert.equal(markProductCandidateDisplayed(displayed, null, { approvedReply: 'fallback', confirmationRequested: false }).proposal, null);
assert.equal(markProductCandidateDisplayed(displayed, undefined, { approvedReply: 'fallback', confirmationRequested: false }).proposal, null);
const hiddenAssent = run(intent, decision('continue', 'sí', [], { candidateResponse: { action: 'confirm', evidence: 'sí', candidateId: '709334' } }), 'sí', hidden);
assert.equal(hiddenAssent.confirmedCandidateId, undefined);
const refinementText = 'La quiero en manga corta';
const refinementIntent = { ...intent, requestedTeam: '', requestedSeason: '', requestedPrinting: '' };
const refinementDecision = decision('continue', refinementText,
  [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'manga corta' }]);
const hiddenRefinement = run(refinementIntent, refinementDecision, refinementText, hidden);
assert.equal(hiddenRefinement.requestedTeam, 'Real Madrid');
assert.equal(hiddenRefinement.requestedSeason, '2026/27');
assert.equal(hiddenRefinement.requestedPrinting, 'none');
assert.deepEqual(hiddenRefinement.requestedFeatures, ['short_sleeve']);
assert.equal(hiddenRefinement.confirmedCandidateId, undefined);
assert.equal(hiddenRefinement.productCandidateState.proposal, null);
const overCleared = run(refinementIntent, refinementDecision, refinementText, clearProductCandidateState(location));
assert.equal(overCleared.productCandidateState, undefined, 'a cleared boundary intentionally prevents continuing that old target');
assert.equal(overCleared.requestedTeam, '');
assert.equal(run(intent, decision('cancel', 'No quiero comprar'), 'No quiero comprar', hidden).productCandidateState.status, 'cleared');
assert.equal(run(intent, { confident: true, productRequirement: { action: 'none' } }, 'hablemos de otra cosa', hidden).productCandidateState.status, 'cleared');
assert.equal(run(intent, decision('continue', 'sí'), 'sí', displayed, { siteId: 'other' }).productCandidateState, undefined);
assert.equal(run({ ...intent, productScopePending: true }, decision('new', text), text).candidateSearchAllowed, undefined);
assert.equal(run({ ...intent, shouldLoadProductContext: false }, decision('new', text), text).candidateSearchAllowed, false);
assert.equal(run({ ...intent, searchState: 'clarification_exhausted' }, decision('new', text), text).candidateSearchAllowed, undefined);
assert.equal(normalizeProductRequirementDecision({ action: 'new', evidence: 'assistant claim', updates: [] }, { userText: text }), null);
assert.equal(normalizeProductRequirementDecision({ action: 'new', evidence: text, updates: [{ field: 'requestedPrinting', value: 'anything', evidence: text }] }, { userText: text }), null);
const newText = 'Barcelona home 2027/28';
const changedTarget = run({ ...intent, requestedTeam: 'Barcelona', requestedSeason: '2027/28', requestedPrinting: '' }, decision('new', newText), newText, displayed);
assert.equal(changedTarget.productCandidateState.proposal, null);
assert.equal(changedTarget.requestedPrinting, '');
const persisted = mergeProductCandidatePayload({ custom: 1 }, displayed);
assert.equal(persisted._productCandidateState.proposal.candidateId, '709334');
assert.deepEqual(stripProductCandidatePayload(persisted), { custom: 1 });
assert.equal(readProductCandidateState([{ senderType: 'user', productCandidateState: displayed }], location), null);
assert.equal(readProductCandidateState([{ senderType: 'character', productCandidateState: displayed }, { senderType: 'character', productCandidateState: { broken: true } }], location), null);
const selectedScope = { version: 1, status: 'selected', ...location, clarificationCount: 0, selectedIndex: 0,
  items: [{ evidence: 'Real Madrid shirt', sharedEvidence: '', text: 'Real Madrid shirt' }, { evidence: 'Barcelona shirt', sharedEvidence: '', text: 'Barcelona shirt' }] };
const selected = run({ ...intent, productRequestState: selectedScope }, decision('continue', short,
  [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'manga corta' }]), short, displayed);
assert.equal(selected.productCandidateState.owner, 'selected');
assert.equal(selected.productCandidateState.proposal, null);
const selectedDisplay = markProductCandidateDisplayed(selected.productCandidateState, product, { approvedReply: '¿Es esta?', confirmationRequested: true });
const longScope = { ...selectedScope, items: Array.from({ length: 4 }, (_, index) => {
  const evidence = `${index} ${'x'.repeat(220)}`, sharedEvidence = `shared ${'m'.repeat(220)}`;
  return { evidence, sharedEvidence, text: `${evidence} ${sharedEvidence}` };
}) };
const longOwner = run({ ...intent, productRequestState: longScope }, decision('continue', short), short);
assert.equal(longOwner.productCandidateState.ownerEvidence.length, 64);
assert.equal(mergeProductCandidatePayload(null, markProductCandidateDisplayed(longOwner.productCandidateState, product,
  { approvedReply: '¿Es esta?', confirmationRequested: true }))._productCandidateState.proposal.candidateId, '709334');
const changedScope = { ...selectedScope, items: selectedScope.items.map((item, index) => index === 1 ? { ...item, evidence: 'Liverpool shirt', text: 'Liverpool shirt' } : item) };
const replacedOwner = run({ ...intent, productRequestState: changedScope }, decision('continue', short), short, selectedDisplay);
assert.equal(replacedOwner.productCandidateState.proposal, null);
const legacy = applyProductCandidateState(intent, { ...decision('continue', short),
  productRequirement: { ...decision('continue', short).productRequirement, priorTargetEvidence: text } },
  { ...location, userText: short, recentMessages: [{ senderType: 'user', text }] });
assert.equal(legacy.requestedPrinting, 'none');
assert.equal(legacy.productCandidateState.targetEvidence, text);
const legacyAssistant = applyProductCandidateState(intent, { ...decision('continue', short),
  productRequirement: { ...decision('continue', short).productRequirement, priorTargetEvidence: text } },
  { ...location, userText: short, recentMessages: [{ senderType: 'character', text }] });
assert.equal(legacyAssistant.productCandidateState, undefined);
assert.equal(run(intent, { confident: true, productRequirement: { action: 'none' } }, 'hello', displayed).productCandidateState.status, 'cleared');
assert.equal(run(intent, decision('cancel', 'No quiero comprar'), 'No quiero comprar', displayed).productCandidateState.status, 'cleared');
const semantic = normalizeCommerceDecision({ route: 'product_search', confidence: .99,
  replyBoundary: { salesAllowed: true, contactAllowed: true }, searchQuery: 'Real Madrid away jersey 2026/27',
  productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
  productRequirement: { action: 'new', evidence: text, updates: [{ field: 'requestedPrinting', value: 'none', evidence: 'sin nombre ni número' }], suspectedTerm: null },
  commerceConstraints: { team: { value: 'Real Madrid', role: 'product_target', evidence: 'Real Madrid' } },
}, { userText: text, detectedTeam: 'Real Madrid', requireBoundaryVerdict: true });
const jev = { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'search', productAction: 1 };
const routed = await resolveCommerceSearchIntent({ ...location, userText: text, searchIntent: buildProductSearchIntent(text),
  classifyCommerce: async () => semantic, jevDecision: jev });
assert.equal(routed.candidateSearchAllowed, true);
assert.equal(routed.requestedPrinting, 'none');
for (const [word, edition] of [['Fun', 'fan'], ['Payer', 'player']]) {
  const namedText = `Real Madrid away Soccer ${word} Jersey 2026/27`;
  const misspelledEdition = normalizeCommerceDecision({ ...semantic, searchQuery: 'Real Madrid away jersey 2026/27',
    commerceConstraints: { ...semantic.commerceConstraints, edition: { value: edition, evidence: `${word} Jersey` } },
    productRequirement: { action: 'new', evidence: namedText, updates: [{ field: 'requestedEdition', value: edition, evidence: `${word} Jersey` }] },
  }, { userText: namedText, detectedTeam: 'Real Madrid' });
  const named = await resolveCommerceSearchIntent({ ...location, userText: namedText, searchIntent: buildProductSearchIntent(namedText),
    classifyCommerce: async () => misspelledEdition, jevDecision: jev });
  assert.equal(named.requestedEdition, '');
  assert.equal(named.productCandidateState.suspectedTerm.value, word);
  assert.ok(named.requestedKeywords.includes(word.toLowerCase()));
  assert.ok(named.query.includes(word), 'The original unresolved name must be attempted, even when the semantic query omitted it');
  const namedDisplay = markProductCandidateDisplayed(named.productCandidateState, product, { approvedReply: 'Is this the item?', confirmationRequested: true });
  const namedAssent = run(intent, decision('continue', 'yes', [], { candidateResponse: { action: 'confirm', evidence: 'yes', candidateId: product.productId } }), 'yes', namedDisplay);
  assert.equal(namedAssent.productCandidateState.suspectedTerm.value, word, 'A classifier vote cannot prematurely remove spelling uncertainty from durable state');
  const rejectedAssent = finalizeProductCandidateState(namedAssent.productCandidateState, product, { evidenceVerified: false });
  assert.equal(rejectedAssent.suspectedTerm.value, word);
  assert.ok(rejectedAssent.requirements.requestedKeywords.includes(word.toLowerCase()));
  const approvedAssent = finalizeProductCandidateState(namedAssent.productCandidateState, product, { evidenceVerified: true });
  assert.equal(approvedAssent.suspectedTerm, null);
  assert.ok(!approvedAssent.requirements.requestedKeywords.includes(word.toLowerCase()));
}
const catalogueFollowupText = 'La quiero en manga corta. Muéstrame la candidata y dime si el nombre del catálogo es diferente.';
const catalogueHistory = [{ senderType: 'user', text }, { senderType: 'character', characterId: location.characterId,
  contentType: 'product', product }, { senderType: 'character', productCandidateState: displayed }];
const conflictedCatalogue = normalizeCommerceDecision({ route: 'store_policy', topic: 'support', confidence: .9,
  needsLiveProductData: true, referencedProductId: '709334', searchQuery: 'Real Madrid away 2026/27 short sleeve',
  replyBoundary: { salesAllowed: true, contactAllowed: true },
  productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
  productRequirement: { action: 'continue', evidence: catalogueFollowupText, updates: [{ field: 'requestedEdition', value: 'fan', evidence: 'la candidata' }] },
  commerceConstraints: { edition: null, team: null },
}, { userText: catalogueFollowupText, recentMessages: catalogueHistory });
assert.deepEqual(conflictedCatalogue.productRequirement.updates, [], 'A catalogue candidate mention cannot create a requested fan edition');
const resolvedCatalogue = await resolveCommerceSearchIntent({ ...location, userText: catalogueFollowupText, recentMessages: catalogueHistory,
  searchIntent: buildProductSearchIntent(catalogueFollowupText), classifyCommerce: async () => conflictedCatalogue,
  jevDecision: { ...jev, primaryIntent: 'product_request', confident: true, productAction: 1 } });
assert.equal(resolvedCatalogue.commerceRoute, 'product_search');
assert.equal(resolvedCatalogue.shouldLoadProductContext, true);
assert.equal(resolvedCatalogue.cardAllowed, true);
assert.deepEqual(resolvedCatalogue.requestedFeatures, ['short_sleeve']);
assert.equal(resolvedCatalogue.requestedEdition, '');
const questionRefinement = await resolveCommerceSearchIntent({ ...location, userText: catalogueFollowupText, recentMessages: catalogueHistory,
  searchIntent: buildProductSearchIntent(catalogueFollowupText), classifyCommerce: async () => ({ ...conflictedCatalogue, route: 'product_question', needsLiveProductData: true }),
  jevDecision: { ...jev, primaryIntent: 'product_request', confident: true, productAction: 1 } });
assert.equal(questionRefinement.commerceRoute, 'product_search', 'An explicit revision of a displayed catalogue candidate continues search even when classified as a question');
assert.equal(questionRefinement.cardAllowed, true);
const malformedContinuation = normalizeProductRequirementDecision({ action: 'continue', evidence: 'La quiero en manga corta!',
  updates: [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'La quiero en manga corta.' }], suspectedTerm: null }, { userText: catalogueFollowupText });
assert.equal(malformedContinuation?.evidence, 'La quiero en manga corta.', 'Exact typed revision evidence can anchor a continuation without accepting rewritten punctuation');
const overlappingChangeText = 'La quiero en manga larga. Muéstrame la candidata';
const overlappingAssent = run(intent, decision('continue', 'La quiero en manga larga.',
  [{ field: 'requestedFeatures', value: ['long_sleeve'], evidence: 'La quiero en manga larga.' }],
  { candidateResponse: { action: 'confirm', evidence: overlappingChangeText, candidateId: '709334' } }), overlappingChangeText, displayed);
assert.notEqual(overlappingAssent.productCandidateState.proposal?.status, 'confirmed', 'Actual specification-change evidence is not a distinct identity assent');
const mislabelledNew = run({ ...intent, requestedPrinting: '', requestedFeatures: ['short_sleeve'] },
  decision('new', 'La quiero en manga corta.', []), catalogueFollowupText, displayed);
assert.equal(mislabelledNew.requestedPrinting, 'none', 'A specification-only turn cannot reset an existing user target just because the model labels it new');
assert.equal(mislabelledNew.productCandidateState.targetEvidence, displayed.targetEvidence);
assert.deepEqual(mislabelledNew.requestedFeatures, ['short_sleeve']);



const policyText = '¿Cuál es la política de devolución de esta camiseta?';
const policyDecision = normalizeCommerceDecision({ ...conflictedCatalogue, route: 'store_policy', topic: 'returns',
  needsLiveProductData: true, knowledgeQuery: policyText,
  productRequirement: { action: 'continue', evidence: policyText, updates: [] },
}, { userText: policyText, recentMessages: catalogueHistory });
const policyContinuation = await resolveCommerceSearchIntent({ ...location, userText: policyText, recentMessages: catalogueHistory,
  searchIntent: buildProductSearchIntent(policyText), classifyCommerce: async () => policyDecision, jevDecision: jev });
assert.equal(policyContinuation.commerceRoute, 'product_question');
assert.equal(policyContinuation.cardAllowed, false);
assert.equal(policyContinuation.commerceTopic, 'returns');
assert.equal(policyContinuation.knowledgeQuery, policyText);
for (const denied of [{ jevDecision: { ...jev, productAction: .5 } }, { recentMessages: [] },
  { recentMessages: catalogueHistory.map(row => row.product ? { ...row, product: { ...product, siteId: 'other' } } : row) },
  { classifyCommerce: async () => ({ ...conflictedCatalogue, replyBoundary: { salesAllowed: false, contactAllowed: true } }) }]) {
  const noReconcile = await resolveCommerceSearchIntent({ ...location, userText: catalogueFollowupText, recentMessages: catalogueHistory,
    searchIntent: buildProductSearchIntent(catalogueFollowupText), classifyCommerce: async () => conflictedCatalogue, jevDecision: jev, ...denied });
  assert.equal(noReconcile.cardAllowed, false);
}
const invalidContinuation = await resolveCommerceSearchIntent({ ...location, userText: catalogueFollowupText, recentMessages: catalogueHistory,
  searchIntent: buildProductSearchIntent(catalogueFollowupText), jevDecision: jev,
  classifyCommerce: async () => ({ ...conflictedCatalogue, route: 'product_search', candidateDecisionRequired: true, productRequirement: null }) });
assert.equal(invalidContinuation.commerceClassificationUnavailable, true, 'Invalid required candidate interpretation must not fall into legacy substitute cards');
assert.equal(invalidContinuation.cardAllowed, false);
assert.equal(invalidContinuation.productCandidateState.status, 'active');
assert.equal(invalidContinuation.productCandidateState.proposal, null);
const encodedRequirement = normalizeCommerceDecision({ ...semantic,
  productRequirement: { action: 'new', evidence: text.replace('número', 'n%C3%BAmero'), updates: [], suspectedTerm: null },
}, { userText: text, detectedTeam: 'Real Madrid', requireBoundaryVerdict: true });
assert.equal(encodedRequirement.productRequirement, null, 'Encoded model text is not accepted as exact user evidence');
const recoveredNew = await resolveCommerceSearchIntent({ ...location, userText: text, searchIntent: buildProductSearchIntent(text),
  classifyCommerce: async () => encodedRequirement, jevDecision: jev });
assert.equal(recoveredNew.candidateSearchAllowed, true, 'A verified new single shopping scope can establish its target from the original current user text');
assert.equal(recoveredNew.productCandidateState.targetEvidence, text);
assert.equal(recoveredNew.requestedPrinting, 'none');
assert.equal(recoveredNew.productCandidateState.proposal, null);
for (const deniedDecision of [
  { ...encodedRequirement, productRequirementAction: 'continue' }, { ...encodedRequirement, productRequirementAction: 'none' },
  { ...encodedRequirement, productRequirementAction: 'cancel' },
  { ...encodedRequirement, productRequest: { ...encodedRequirement.productRequest, relation: 'comparison' } },
  { ...encodedRequirement, commerceConstraints: { team: { value: 'Real Madrid', role: 'location', evidence: 'Real Madrid' } } },
  { ...encodedRequirement, replyBoundary: { salesAllowed: false, contactAllowed: true } },
]) {
  const deniedNew = await resolveCommerceSearchIntent({ ...location, userText: text, searchIntent: buildProductSearchIntent(text),
    classifyCommerce: async () => deniedDecision, jevDecision: jev });
  assert.notEqual(deniedNew.candidateSearchAllowed, true);
}
const deniedPrimary = await resolveCommerceSearchIntent({ ...location, userText: text, searchIntent: buildProductSearchIntent(text),
  classifyCommerce: async () => encodedRequirement, jevDecision: { ...jev, productAction: .5 } });
assert.notEqual(deniedPrimary.candidateSearchAllowed, true);
const freshAfterOld = await resolveCommerceSearchIntent({ ...location, userText: text, searchIntent: buildProductSearchIntent(text),
  recentMessages: [{ senderType: 'character', productCandidateState: { ...displayed, requirements: { ...displayed.requirements,
    requestedTeam: 'Barcelona', requestedAudience: 'kids', requestedSizes: ['XL'], requestedPrinting: 'printed', requestedPrintNumber: '5' } } }],
  classifyCommerce: async () => encodedRequirement, jevDecision: jev });
assert.equal(freshAfterOld.requestedTeam, 'Real Madrid');
assert.equal(freshAfterOld.requestedAudience, '');
assert.deepEqual(freshAfterOld.requestedSizes, []);
assert.equal(freshAfterOld.requestedPrintNumber, '');
assert.equal(freshAfterOld.confirmedCandidateId, undefined);
assert.equal(freshAfterOld.rejectedCandidateId, undefined);
assert.equal(freshAfterOld.productCandidateState.proposal, null);
const primaryBlocked = await resolveCommerceSearchIntent({ ...location, userText: text, searchIntent: buildProductSearchIntent(text),
  classifyCommerce: async () => semantic, jevDecision: { ...jev, primaryIntent: 'chat', productIntent: 'none', productAction: 0 } });
assert.equal(primaryBlocked.candidateSearchAllowed, false);
assert.equal(primaryBlocked.shouldLoadProductContext, false);
const missingScope = await resolveCommerceSearchIntent({ ...location, userText: text, searchIntent: buildProductSearchIntent(text),
  classifyCommerce: async () => ({ ...semantic, productRequest: null }), jevDecision: jev });
assert.equal(missingScope.candidateSearchAllowed, undefined);
assert.equal(missingScope.productScopePending, true);

// A failed interpretation is not a user cancellation. Retain only the already
// validated target, remove the displayed proposal, and never adopt this turn's
// unreviewed conditions or allow a card while interpretation is unavailable.
const failedTurn = 'Barcelona home shirt 2027/28';
for (const failure of ['timeout', 'provider', 'parse', 'missing_fields']) {
  const unavailable = await resolveCommerceSearchIntent({ ...location, userText: failedTurn,
    searchIntent: buildProductSearchIntent(failedTurn), recentMessages: [
      { senderType: 'character', productCandidateState: displayed },
    ], classifyCommerce: async () => ({ confident: false, confidence: 0, commerceClassificationFailure: failure }),
    jevDecision: jev });
  assert.equal(unavailable.commerceClassificationUnavailable, true);
  assert.equal(unavailable.shouldLoadProductContext, false);
  assert.equal(unavailable.cardAllowed, false);
  assert.equal(unavailable.candidateSearchAllowed, false);
  assert.equal(unavailable.productCandidateState.status, 'active', `${failure} must not erase validated user requirements`);
  assert.deepEqual(unavailable.productCandidateState.requirements, displayed.requirements);
  assert.equal(unavailable.productCandidateState.targetEvidence, displayed.targetEvidence);
  assert.equal(unavailable.productCandidateState.proposal, null, `${failure} must invalidate the proposal's confirmation permission`);
  const unshownAssent = run(intent, decision('continue', 'sí', [], {
    candidateResponse: { action: 'confirm', evidence: 'sí', candidateId: '709334' },
  }), 'sí', unavailable.productCandidateState);
  assert.equal(unshownAssent.confirmedCandidateId, undefined);
  const resumed = run(refinementIntent, refinementDecision, refinementText, unavailable.productCandidateState);
  assert.equal(resumed.requestedTeam, 'Real Madrid');
  assert.equal(resumed.requestedSeason, '2026/27');
  assert.equal(resumed.requestedPrinting, 'none');
  assert.deepEqual(resumed.requestedFeatures, ['short_sleeve']);
}
const beforeFailureScope = { ...selectedScope, clarificationCount: 1 };
const selectedUnavailable = await resolveCommerceSearchIntent({ ...location, userText: short,
  searchIntent: buildProductSearchIntent(short), recentMessages: [
    { senderType: 'character', productRequestState: beforeFailureScope, productCandidateState: selectedDisplay },
  ], classifyCommerce: async () => ({ confident: false, commerceClassificationFailure: 'timeout' }),
  jevDecision: jev });
assert.equal(selectedUnavailable.commerceClassificationUnavailable, true);
assert.deepEqual(selectedUnavailable.productRequestState, beforeFailureScope,
  'transport failure must not erase a verified selected scope or consume a clarification');
assert.equal(selectedUnavailable.productCandidateState.status, 'active');
assert.equal(selectedUnavailable.productCandidateState.proposal, null);
assert.equal(selectedUnavailable.productCandidateState.ownerEvidence, selectedDisplay.ownerEvidence);
console.log('product candidate state self-check passed: retained user constraints, multilingual semantic confirmation, rejected/hidden proposals, owner/site boundaries; no network/DB/model calls');
const historicalYearText = 'Real Madrid jersey 2022';
assert.equal(normalizeProductRequirementDecision({ action: 'new', evidence: historicalYearText,
 updates: [{ field: 'requestedSeason', value: '2022', evidence: '2022' }], suspectedTerm: null }, { userText: historicalYearText })?.updates[0].value, '2022');
