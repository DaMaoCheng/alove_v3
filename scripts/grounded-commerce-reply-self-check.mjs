import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
globalThis.fetch = async () => { throw new Error('External calls forbidden in boundary repair checks'); };
const { enforceReplyBoundary } = await import('../server/chat-reply-boundary-service.js');
const { toCandidateReviewContext } = await import('../server/product-candidate-context-service.js');
const { buildReplyReviewLogEvent } = await import('../server/ai-reply-log-service.js');
const { recoverReviewedLanguageReply } = await import('../server/chat-reply-language-recovery-service.js');
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const clone = value => structuredClone(value);
const character = { id: 'mascot_fixture', category_id: 'mascot', name: 'Fixture' };
const original = { text: 'El envío a España está garantizado en dos días.', displayText: 'El envío a España está garantizado en dos días.',
  speechText: 'El envío a España está garantizado en dos días.', sourceType: 'ai', sourceRef: 'venice-chat-completions',
  voiceMeta: { languageCode: 'es', languageLabel: 'Spanish' } };
const policyText = 'La política indica envío estándar gratuito. El destino y plazo concreto deben confirmarse al pagar.';
const policy = { character, replyResult: original, language: 'es', userText: 'Antes de comprar, ¿cuál es la política de envío a España?',
  searchIntent: { commerceRoute: 'store_policy', commerceTopic: 'support', knowledgeScope: 'business', commerceConfidence: .99,
    answerRequired: true, cardAllowed: false, shouldLoadProductContext: false, needsLiveProductData: false,
    replyBoundary: { salesAllowed: false, contactAllowed: true } },
  knowledgeContext: { strategy: 'business_verified_reference', customerServiceIntent: true, customerServiceTopic: 'delivery',
    items: [{ id: 'site_shipping', siteId: 'shop', scope: 'site', evidenceQuote: 'Standard shipping is free.',
      content: 'Standard shipping is free. Final destination and delivery time must be confirmed at checkout.' }] } };
const candidateProduct = { id: 'shirt', name: 'Real Madrid Away Fan Jersey', url: 'https://example.test/shirt', matchStatus: 'candidate',
  attributeEvidence: { edition: 'fan', sleeve: 'unknown', printing: 'none', giveaway: false }, candidateUnknownFields: ['sleeve'] };
const candidateText = 'Esta es una posible candidata del catálogo. La manga corta no está confirmada. ¿Es la que buscas?';
const candidate = { character, replyResult: { ...original, text: 'Encontré exactamente la camiseta de manga corta.', speechText: 'Encontré exactamente la camiseta de manga corta.' },
  language: 'es', userText: 'Muéstrame la candidata en manga corta.',
  searchIntent: { commerceRoute: 'product_search', knowledgeScope: 'business', commerceConfidence: .99, answerRequired: false,
    shouldLoadProductContext: true, needsLiveProductData: true, cardAllowed: true, searchState: 'ready_to_search',
    replyBoundary: { salesAllowed: true, contactAllowed: false } },
  productContext: { siteId: 'shop', siteSlug: 'shop', searchOutcome: 'candidate', cardAllowed: true, products: [candidateProduct],
    candidateContext: { requiresConfirmation: true, entityConfirmed: false, products: [{ ...candidateProduct, unknownFields: ['sleeve'], unmatchedSearchTerms: [] }] } } };
check(toCandidateReviewContext(candidate.productContext)?.products.length === 1, 'candidate fixture contains the actual visible card projection');
const { resolveCommerceSearchIntent } = await import('../server/commerce-routing-service.js');
const { buildCandidateConfirmationContext } = await import('../server/product-candidate-confirmation-service.js');
const { productCandidateContext } = await import('../server/product-search-execution-service.js');
const confirmationText = 'Sí, esa es la camiseta que quiero.';
const confirmedProduct = { ...candidateProduct, productId: 'shirt', siteId: 'shop', siteSlug: 'shop', available: true,
  attributeEvidence: { ...candidateProduct.attributeEvidence, giveaway: true } };
const priorState = { version: 1, status: 'active', siteId: 'shop', characterId: character.id, owner: 'single',
  targetEvidence: 'Real Madrid away fan shirt without printing', requirements: { requestedTeam: 'Real Madrid', requestedProductType: 'shirt',
    requestedEdition: 'fan', requestedPrinting: 'none', requestedFeatures: ['short_sleeve'], requestedVariants: ['away'] },
  proposal: { status: 'displayed', candidateId: 'shirt', name: confirmedProduct.name, reply: '¿Es esta la camiseta que buscas?' } };
const confirmationRows = [{ senderType: 'character', characterId: character.id, contentType: 'product', product: confirmedProduct },
  { senderType: 'character', productCandidateState: priorState }];
const confirmationIntent = await resolveCommerceSearchIntent({ userText: confirmationText, recentMessages: confirmationRows,
  siteId: 'shop', siteSlug: 'shop', characterId: character.id,
  jevDecision: { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'none', productAction: .5 },
  classifyCommerce: async () => ({ confident: true, confidence: .99, route: 'product_search', topic: 'other', replyBoundary: { salesAllowed: true, contactAllowed: false },
    productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' },
    productRequirement: { action: 'continue', evidence: confirmationText, updates: [], suspectedTerm: null },
    candidateResponse: { action: 'confirm', candidateId: 'shirt', evidence: confirmationText } }) });
const confirmationContext = await buildCandidateConfirmationContext({ site: { id: 'shop', slug: 'shop' }, searchIntent: confirmationIntent,
  recentMessages: confirmationRows, userText: confirmationText, characterId: character.id,
  resolveProduct: async () => ({ resolvedFromSource: true, site: { id: 'shop', slug: 'shop' }, sourceItem: confirmedProduct }), buildCandidateContext: productCandidateContext });
const confirmed = { ...candidate, userText: confirmationText, searchIntent: confirmationIntent, productContext: confirmationContext };
const confirmedText = 'Entiendo que has elegido este artículo. La manga corta sigue sin verificar. Se aplican condiciones de la actividad y tu elegibilidad no está verificada.';
const yes = { allowed: true, confidence: .99, boundarySupported: true, evidenceSupported: true, businessFactsSupported: true,
  guidanceSupported: true, candidateConfirmationSupported: true, productScopeSupported: true, imageStatusSupported: true,
  guestBenefitSupported: true, factualSupported: true, factualLimitationRelevant: true };
const initialNo = (kind) => ({ ...yes, allowed: false, ...(kind === 'policy'
  ? { businessFactsSupported: false, guidanceSupported: false } : { evidenceSupported: false, candidateConfirmationSupported: false }) });
async function run(base, { repairResult = 'valid', firstVerdict = initialNo(base.productContext ? 'candidate' : 'policy'), secondVerdict = yes,
  secondLanguageAccepted = true, extra = {}, clock = null, replacementText = null, firstLanguageAccepted = true } = {}) {
  const state = { repairs: [], reviews: [], languages: [], logs: [], languageRepairs: 0 };
  const replacement = replacementText || (base.productContext?.candidateContext?.entityConfirmed ? confirmedText : base.productContext ? candidateText : policyText);
  const output = await enforceReplyBoundary({ ...base, ...extra, languageQualityRequired: true, independentLanguageQualityRequired: true,
    recordReview: async event => state.logs.push(event),
    assess: async input => { state.reviews.push(input); if (clock && state.reviews.length === 2) clock.now += 2000;
      if (typeof firstVerdict === 'function' && state.reviews.length === 1) return firstVerdict(input);
      return state.reviews.length === 1 ? firstVerdict : secondVerdict; },
    assessLanguageQuality: async input => { state.languages.push(input); return { reviewStatus: 'valid', confidence: .99,
      languageQualitySupported: state.reviews.length < 2 ? firstLanguageAccepted : secondLanguageAccepted, retainedLanguageQualitySupported: Boolean(input.retainedText),
      languageIssues: (state.reviews.length < 2 ? !firstLanguageAccepted : !secondLanguageAccepted) ? [{ type: 'grammar', severity: 'major', field: 'both', span: 'error' }] : [] }; },
    regenerateReply: async () => { state.languageRepairs++; throw new Error('Unrelated language rewrite must not run'); },
    repairGroundedReply: async input => { state.repairs.push(input); if (clock) clock.now += 4000;
      if (repairResult === 'null') return null;
      if (repairResult === 'throw') throw Object.assign(new Error('fixture timeout'), { code: 'AI_REPLY_TIMEOUT' });
      return { ...input.replyResult, text: replacement, displayText: replacement, speechText: replacement }; },
  });
  return { ...state, output, replacement };
}
for (const [kind, base] of [['policy', policy], ['candidate', candidate]]) {
  const result = await run(base);
  check(result.repairs.length === 1, `${kind}: valid grounded rejection invokes one repair`);
  check(result.reviews.length === 2 && result.languages.length === (kind === 'policy' ? 1 : 2), `${kind}: replacement receives complete primary and independent language review`);
  check(result.reviews[1].text === result.replacement && result.languages.at(-1).text === result.replacement
    && result.reviews[0].text !== result.reviews[1].text, `${kind}: new review assesses the changed text instead of obtaining another verdict on the rejected original`);
  check(result.output.text === result.replacement && result.output.speechText === result.replacement && !result.output.degraded, `${kind}: only reapproved complete text and speech survive`);
  check(result.repairs[0].language === 'es' && result.repairs[0].userText === base.userText, `${kind}: repair receives current language and USER message`);
  for (const field of ['searchIntent', 'productContext', 'knowledgeContext']) {
    check(result.reviews[0][field] === result.reviews[1][field], `${kind}: complete re-review retains original ${field}`);
  }
  check(JSON.stringify(result.reviews[1].boundary) === JSON.stringify(base.searchIntent.replyBoundary), `${kind}: original sales/contact permissions preserved`);
  check(result.output.voiceMeta.languageCode === 'es' && result.languageRepairs === 0, `${kind}: voice metadata retained without ordinary language repair`);
  check(result.repairs[0].timeoutMs === (kind === 'candidate' ? 30000 : 15000), `${kind}: only product correction opts into its independent thirty-second allocation`);
  if (kind === 'candidate') check(result.repairs[0].repairScope === 'grounded_commerce', 'candidate correction carries its bounded product scope');
  if (kind === 'candidate') check(result.output.candidateEvidenceVerified === true && result.output.candidateConfirmationVerified === true, 'candidate: full re-review grants evidence and confirmation flags');
  for (const firstVerdict of [{ ...initialNo(kind), boundarySupported: false }, { ...yes, allowed: false, boundarySupported: false }]) {
    const correctedBoundary = await run(base, { firstVerdict });
    check(correctedBoundary.repairs.length === 1 && correctedBoundary.reviews.length === 2 && correctedBoundary.languages.length === (kind === 'policy' ? 1 : 2),
      `${kind}: initial unsupported boundary content may receive one new text correction and complete re-review`);
    check(correctedBoundary.output.text === correctedBoundary.replacement && !correctedBoundary.output.degraded
      && JSON.stringify(correctedBoundary.reviews[1].boundary) === JSON.stringify(base.searchIntent.replyBoundary),
      `${kind}: boundary correction preserves the original permissions and only publishes the newly approved text`);
    check(correctedBoundary.reviews[1].text === correctedBoundary.replacement && correctedBoundary.languages.at(-1).text === correctedBoundary.replacement,
      `${kind}: initial boundary rejection is resolved by reviewing the new text, never by re-voting on the old text`);
    const stillRejected = await run(base, { firstVerdict, secondVerdict: { ...yes, allowed: false, boundarySupported: false } });
    check(stillRejected.repairs.length === 1 && stillRejected.reviews.length === 2 && stillRejected.output.text !== stillRejected.replacement,
      `${kind}: a second boundary rejection cannot publish the correction or obtain another correction`);
    if (kind === 'candidate') check(!stillRejected.output.candidateEvidenceVerified && !stillRejected.output.candidateConfirmationVerified,
      'candidate: repeated boundary rejection cannot authorize a product card');
  }
  for (const secondVerdict of [initialNo(kind), { ...yes, boundarySupported: false }, { ...yes, evidenceSupported: false },
    { ...yes, businessFactsSupported: false }, { ...yes, confidence: .5 }, { allowed: true, confidence: .99 }]) {
    // Only active contracts are meaningful; do not treat an inactive extra field as a veto.
    if (kind === 'policy' && secondVerdict.evidenceSupported === false || kind === 'candidate' && secondVerdict.businessFactsSupported === false) continue;
    const rejected = await run(base, { secondVerdict });
    check(rejected.repairs.length === 1 && rejected.reviews.length === 2 && rejected.output.text !== rejected.replacement, `${kind}: second rejection/invalid verdict cannot recur or publish the rewrite`);
    if (kind === 'candidate') check(!rejected.output.candidateEvidenceVerified && !rejected.output.candidateConfirmationVerified, 'candidate: failed re-review cannot authorize a card');
  }
  const wrongLanguage = await run(base, { secondLanguageAccepted: false });
  check(wrongLanguage.repairs.length === 1 && wrongLanguage.output.text !== wrongLanguage.replacement && wrongLanguage.languageRepairs === 0, `${kind}: second language failure remains fail-closed`);
  for (const repairResult of ['null', 'throw']) {
    const unavailable = await run(base, { repairResult });
    check(unavailable.repairs.length === 1 && unavailable.reviews.length === 1 && unavailable.output.text !== unavailable.replacement, `${kind}: ${repairResult} repair keeps the original fallback without another review`);
  }
  for (const firstVerdict of [{ ...initialNo(kind), confidence: .6 }, { allowed: false, confidence: .99 },
    { ...initialNo(kind), reviewStatus: 'timeout' }, () => { throw Object.assign(new Error('review timeout'), { code: 'AI_REPLY_TIMEOUT' }); }]) {
    const excluded = await run(base, { firstVerdict });
    check(excluded.repairs.length === 0, `${kind}: uncertain, missing or timeout review cannot invoke repair`);
  }
}
// A known policy purpose without evidence may now regenerate only a diagnostic
// candidate. It still cannot release an unsupported policy after full re-review.
const noFactsDiagnostic = await run(policy, { extra: { knowledgeContext: { ...policy.knowledgeContext, items: [] } },
  secondVerdict: { ...yes, allowed: false, businessFactsSupported: false } });
check(noFactsDiagnostic.repairs.length === 1 && noFactsDiagnostic.reviews.length === 2
  && noFactsDiagnostic.output.text !== noFactsDiagnostic.replacement,
  'no knowledge: one diagnostic candidate still cannot publish an unsupported policy after full rejection');
const exclusions = [
  ['unverified knowledge', policy, { knowledgeContext: { ...policy.knowledgeContext, strategy: 'business_no_verified_answer' } }],
  ['ordinary scope', policy, { searchIntent: { ...policy.searchIntent, commerceRoute: 'chat', knowledgeScope: 'general', commerceTopic: 'other' } }],
  ['already attempted', policy, { groundedRepairAttempted: true }],
  ['language already attempted', policy, { languageRepairAttempted: true }],
  ['invalid order state', policy, { orderActionCandidate: { kind: 'ttmall_order_lookup', siteSlug: 'shop', status: 'unverified' } }],
  ['order without verified policy', policy, { orderActionCandidate: { kind: 'ttmall_order_lookup', siteSlug: 'shop', status: 'binding_required' }, knowledgeContext: { ...policy.knowledgeContext, items: [] } }],
  ['image', policy, { chatImageContext: { imageStatus: { kind: 'generated', status: 'ready', currentTurn: true } } }],
  ['discount', policy, { replyResult: { ...original, verifiedDiscountOffers: [{ code: 'FIXTURE' }], discountOfferReply: true } }],
  ['transport fallback', policy, { replyResult: { ...original, sourceRef: 'ai-request-fallback', degraded: true } }],
  ['quality guard', policy, { replyResult: { ...original, sourceRef: 'quality-guard', degraded: true } }],
  ['policy with confirmed candidate', policy, { productContext: { ...candidate.productContext,
    candidateContext: { ...candidate.productContext.candidateContext, requiresConfirmation: false, entityConfirmed: true } } }],
  ['policy with confirmed identity marker', policy, { searchIntent: { ...policy.searchIntent, confirmedCandidateId: 'shirt' } }],
  ['policy mixed with unverified live merchandise', policy, { searchIntent: { ...policy.searchIntent,
    teamConstraintUnverified: true, shouldLoadProductContext: true, needsLiveProductData: true, cardAllowed: true },
    productContext: { products: [candidateProduct], cardAllowed: true } }],
  ['no visible card', candidate, { productContext: { ...candidate.productContext, products: [] } }],
  ['confirmed candidate', candidate, { productContext: { ...candidate.productContext, candidateContext: { ...candidate.productContext.candidateContext, requiresConfirmation: false, entityConfirmed: true } } }],
  ['card forbidden', candidate, { searchIntent: { ...candidate.searchIntent, cardAllowed: false } }],
  ['source card forbidden', candidate, { productContext: { ...candidate.productContext, cardAllowed: false } }],
  ['search forbidden', candidate, { searchIntent: { ...candidate.searchIntent, shouldLoadProductContext: false, needsLiveProductData: false } }],
  ['sales forbidden', candidate, { searchIntent: { ...candidate.searchIntent, replyBoundary: { salesAllowed: false, contactAllowed: false } } }],
  ['team unverified', candidate, { searchIntent: { ...candidate.searchIntent, teamConstraintUnverified: true } }],
  ['classification unavailable', candidate, { searchIntent: { ...candidate.searchIntent, commerceClassificationFailure: 'missing_fields' } }],
  ['multiple scope', candidate, { searchIntent: { ...candidate.searchIntent, productScopePending: true,
    productRequestState: { version: 1, status: 'pending', siteId: 'shop', characterId: character.id, items: [
      { evidence: 'Real Madrid', sharedEvidence: '', text: 'Real Madrid' }, { evidence: 'Barcelona', sharedEvidence: '', text: 'Barcelona' } ], selectedIndex: null, clarificationCount: 0 } } }],
];
for (const [label, base, extra] of exclusions) {
  const result = await run(base, { extra });
  check(result.repairs.length === 0, `${label}: unrelated or unauthorized action cannot invoke grounded repair`);
  const boundaryRejected = await run(base, { extra, firstVerdict: { ...initialNo(base.productContext ? 'candidate' : 'policy'), boundarySupported: false } });
  check(boundaryRejected.repairs.length === 0, `${label}: an initial boundary rejection cannot broaden the authorized corrective scope`);
}
const orderEntry = { kind: 'ttmall_order_lookup', siteSlug: 'shop', status: 'binding_required' };
const mixedPolicyOrder = await run(policy, { extra: { orderActionCandidate: orderEntry } });
check(mixedPolicyOrder.repairs.length === 1 && mixedPolicyOrder.reviews.length === 2,
  'verified policy and valid order entry reuse one text correction and complete re-review');
check(mixedPolicyOrder.reviews.every(review => review.orderActionState === 'binding_required')
  && mixedPolicyOrder.output.text === policyText && mixedPolicyOrder.languageRepairs === 0,
  'mixed correction retains original order state and independently supported policy without another action or repair loop');
const publicFactFailure = await run(policy, { firstVerdict: { ...initialNo('policy'), factualSupported: false }, extra: {
  factualContext: { required: true, status: 'matched', asOfUtc: '2026-10-13T00:00:00.000Z', timeZone: 'UTC', searched: true,
    items: [{ title: 'Official record', content: 'Verified public fact.', url: 'https://example.test/official' }] },
} });
check(publicFactFailure.repairs.length === 0, 'a concurrent rejected public factual contract cannot invoke business repair');
const retained = await run(policy, { extra: { replyResult: { ...original, text: `${policyText}\n\n${original.text}`, speechText: `${policyText}\n\n${original.text}` } },
  firstVerdict: { ...initialNo('policy'), retainedText: policyText, retainedTextAllowed: true, retainedBoundarySupported: true,
    retainedBusinessFactsSupported: true, retainedGuidanceSupported: true, retainedLanguageQualitySupported: true },
});
check(retained.repairs.length === 0 && retained.output.text.startsWith(policyText), 'an already approved independent paragraph keeps its existing retention path');
const inactiveProductMarker = await run(policy, { extra: { searchIntent: { ...policy.searchIntent, teamConstraintUnverified: true } } });
check(inactiveProductMarker.repairs.length === 1 && inactiveProductMarker.output.text === policyText,
  'an inactive product-only team marker cannot suppress verified policy guidance without products, live lookup or card permission');
for (const base of [policy, candidate]) {
  const rawRemainder = await run(base, { firstVerdict: { ...initialNo(base.productContext ? 'candidate' : 'policy'),
    retainedText: 'This unapproved invented remainder cannot be retained.', retainedTextAllowed: false } });
  check(rawRemainder.repairs.length === 1 && rawRemainder.output.text === rawRemainder.replacement,
    'unapproved raw retained text cannot suppress a verified corrective generation');
}
const originalNow = Date.now;
try {
  const clock = { now: 10000 };
  Date.now = () => clock.now;
  const bounded = await run(policy, { clock });
  check(bounded.repairs.length === 1 && bounded.languages.at(-1).timeoutMs === 60000,
    'complete language re-review keeps the configured sixty seconds regardless of earlier correction latency');
} finally { Date.now = originalNow; }
for (const [label, repairTimeoutMs, expected] of [['default', undefined, 15000], ['oversized', 99999, 15000],
  ['nonfinite', Infinity, 15000], ['invalid', 0, 15000]]) {
  let timeout;
  const recovery = await recoverReviewedLanguageReply({ replyResult: original, language: 'es', userText: policy.userText,
    ...(repairTimeoutMs === undefined ? {} : { repairTimeoutMs }), recordReview: async () => {},
    repairLanguageReply: async input => { timeout = input.timeoutMs; return { ...original, text: policyText, speechText: policyText }; },
    reviewCandidate: async (reply, options) => { check(options.reviewTimeoutMs === 60000 && !Object.hasOwn(options, 'languageRecoveryDeadline'), `${label}: re-review gets an independent primary budget without an absolute recovery deadline`); return reply; },
  });
  check(timeout === expected && recovery.recovered, `${label}: engine validates and clamps the allocation with the configured independent correction ceiling`);
}
let ordinaryGrounded = 0, ordinaryLanguageRepair = 0, ordinaryLanguages = 0;
const ordinary = await enforceReplyBoundary({ character, language: 'es', userText: 'Hablemos de fútbol.',
  replyResult: { ...original, text: 'Me gustar fútbol.', speechText: 'Me gustar fútbol.' },
  searchIntent: { commerceRoute: 'chat', replyBoundary: { salesAllowed: false, contactAllowed: false } },
  languageQualityRequired: true, independentLanguageQualityRequired: true, recordReview: async () => {}, assess: async () => yes,
  assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: .99, languageQualitySupported: ++ordinaryLanguages > 1,
    languageIssues: ordinaryLanguages === 1 ? [{ type: 'grammar', field: 'both', severity: 'major', span: 'Me gustar' }] : [] }),
  regenerateReply: async () => { ordinaryLanguageRepair++; return { ...original, text: 'Me gusta el fútbol.', speechText: 'Me gusta el fútbol.' }; },
  repairGroundedReply: async () => { ordinaryGrounded++; return null; },
});
check(ordinary.text === 'Me gusta el fútbol.' && ordinaryLanguageRepair === 1 && ordinaryGrounded === 0 && ordinaryLanguages === 2,
  'ordinary language failure regenerates once without adding a grounded correction');
const confirmedFixed = await run(confirmed, { firstVerdict: { ...yes, allowed: false, evidenceSupported: false, businessFactsSupported: false } });
check(confirmedFixed.repairs.length === 1 && confirmedFixed.reviews.length === 2 && confirmedFixed.languages.length === 2,
  'A proven metadata-only confirmation receives one text correction and the complete original primary/language review');
check(confirmedFixed.output.text === confirmedText && confirmedFixed.output.candidateEvidenceVerified === true && !confirmedFixed.output.degraded,
  'Only full evidence reapproval, including identity assent, can publish corrected confirmed-candidate text');
check(confirmedFixed.reviews[0].productContext === confirmedFixed.reviews[1].productContext
  && confirmedFixed.reviews[1].searchIntent === confirmationIntent
  && confirmedFixed.reviews[1].evidenceRequired === true
  && toCandidateReviewContext(confirmedFixed.reviews[1].productContext).entityConfirmationEvidence === confirmationText,
  'The exact source, prior question, original requirements and USER assent remain unchanged across correction and re-review');
check(confirmationIntent.cardAllowed === false && confirmationIntent.shouldLoadProductContext === false && confirmationIntent.needsLiveProductData === false,
  'Correction does not grant new product search or card authority');
const rejectedAssent = await run(confirmed, { firstVerdict: { ...yes, allowed: false, evidenceSupported: false, businessFactsSupported: false },
  secondVerdict: { ...yes, allowed: false, evidenceSupported: false } });
check(rejectedAssent.repairs.length === 1 && rejectedAssent.reviews.length === 2 && rejectedAssent.output.text !== confirmedText
  && rejectedAssent.output.candidateEvidenceVerified === false,
  'A complete re-review refusing identity assent rejects corrected text without another correction or confirmation approval');
const diagnostic = buildReplyReviewLogEvent({ reviewStatus: 'valid', languageDiagnostics: { repairKind: 'grounded', repairState: 'accepted',
  initialFailedContracts: ['guidance', 'business_facts', 'guidance', 'private_quotation', Infinity, null], privateText: 'PRIVATE_SECRET_TEXT' } });
const details = JSON.parse(diagnostic.errorMessage);
check(details.replyRepair.kind === 'grounded' && details.replyRepair.state === 'accepted', 'terminal diagnostics distinguish grounded corrective generation');
check(JSON.stringify(details.replyRepair.initialFailures) === JSON.stringify(['guidance', 'business_facts']), 'diagnostics retain only finite allowed contract identifiers');
check(diagnostic.errorMessage.length <= 500 && !diagnostic.errorMessage.includes('PRIVATE_SECRET_TEXT') && !diagnostic.errorMessage.includes('private_quotation'),
  'bounded diagnostic JSON never persists private input text');
console.log(`grounded commerce boundary self-check passed (${checks} checks; actual boundary, fixture repair/review, no network or DB writes)`);

const {needsBusinessFactsReview,applyReplyBoundaryPromptPolicy}=await import('../server/chat-reply-boundary-service.js');
const definitionIntent={commerceRoute:'chat',knowledgeScope:'general',commerceTopic:'delivery',answerRequired:true,
 shouldLoadProductContext:false,needsLiveProductData:false,cardAllowed:false};
check(needsBusinessFactsReview(definitionIntent,character),'a general delivery explanation must still reject invented actual-order facts');
check(!needsBusinessFactsReview({...definitionIntent,commerceTopic:'other'},character),'ordinary companionship adds no business facts review');
const definition='That status usually means the parcel has reached the destination country; it does not by itself confirm customs clearance or a delivery date.';
const invented='Your parcel has arrived in the U.S. It is definitely getting close.';
const conceptual={character,language:'en',userText:'what means that it landed in destination country',
 searchIntent:definitionIntent,knowledgeContext:{items:[],strategy:'no_keyword_trigger'},
 replyResult:{text:invented,speechText:invented,sourceType:'ai',sourceRef:'venice-chat-completions'}};
check(applyReplyBoundaryPromptPolicy({},definitionIntent).systemPrompt.includes('character location/nationality'),'generic generation is constrained even without a sales/contact boundary');
check(applyReplyBoundaryPromptPolicy({}, { ...definitionIntent,commerceTopic:'other' }).systemPrompt===undefined,'ordinary companionship prompt remains untouched');
let definitionReviews=0,definitionRepairs=0;
const repairedDefinition=await enforceReplyBoundary({...conceptual,
 assess:async input=>{definitionReviews++;check(input.businessFactsRequired,'generic replies retain actual-order fact review');
   return {...yes,allowed:definitionReviews>1,businessFactsSupported:definitionReviews>1}},
 repairGroundedReply:async()=>{definitionRepairs++;return {text:definition,speechText:definition}},recordReview:async()=>{}});
check(definitionRepairs===1 && definitionReviews===2 && repairedDefinition.text===definition,'invented country/progress can obtain only one conditional definition followed by complete re-review');
const pureDefinition=await enforceReplyBoundary({...conceptual,replyResult:{text:definition,speechText:definition},assess:async input=>{
 check(input.businessFactsRequired,'valid definitions are reviewed, not assumed safe');return yes;},recordReview:async()=>{}});
check(pureDefinition.text===definition,'an approved conditional definition is preserved without requiring store evidence');
const {isGroundedCommerceRepairEligible}=await import('../server/chat-grounded-reply-repair-service.js');
const genericEligibility={...conceptual,reviewStatus:'valid',reviewResult:{...yes,allowed:false,businessFactsSupported:false},failedContracts:['business_facts']};
check(isGroundedCommerceRepairEligible(genericEligibility),'a no-action general explanation can correct invented specifics without requiring unrelated site policy');
for(const patch of [{orderActionCandidate:{}},{chatImageContext:{}},{guestBenefitContext:{}},
 {productContext:{products:[{id:'actual-card'}]}},{searchIntent:{...definitionIntent,cardAllowed:true}},
 {searchIntent:{...definitionIntent,needsLiveProductData:true}},
{searchIntent:{...definitionIntent,checkoutIssue:{}}},
 {searchIntent:{...definitionIntent,promotionInquiry:{kind:'benefit_request'}}},
 {searchIntent:{...definitionIntent,humanHandoff:{explicitRequest:true}}}]) {
 check(!isGroundedCommerceRepairEligible({...genericEligibility,...patch}),'general correction cannot absorb order actions, shopping, images, benefits, handoff or mixed policy without evidence');
}
for(const searchIntent of [{...definitionIntent,commerceRoute:'store_policy',knowledgeScope:'business',needsLiveProductData:true},
 {...definitionIntent,commerceRoute:'store_policy',knowledgeScope:'business'}]) {
 const diagnostic = await run({...conceptual,searchIntent}, {secondVerdict:{...yes,allowed:false,businessFactsSupported:false}});
 check(diagnostic.repairs.length===1 && diagnostic.reviews.length===2 && diagnostic.output.text!==diagnostic.replacement,
  'known purpose with requested live data or no policy evidence permits only one fully reviewed diagnostic, never an approved policy assertion');
}
console.log('general commerce explanation guard/correction regression passed (invented country/progress rejected, approved definition retained, current evidence required, no ordinary-chat/action scope expansion)');

const {buildLanguageQualityFallbackReply}=await import('../server/chat-reply-language-quality.js');
const {buildSupportGuidanceUnavailableCopy}=await import('../server/support-guidance-copy.js');
for(const reviewFailure of [{reviewStatus:'http_error',allowed:false,confidence:0},
 {reviewStatus:'timeout',allowed:false,confidence:0}, {...yes,allowed:false,businessFactsSupported:false}]) {
 let repairs=0;
 const failed=await enforceReplyBoundary({...conceptual,assess:async()=>reviewFailure,
 repairGroundedReply:async()=>{repairs++;return null;},recordReview:async()=>{}});
 check(failed.text===buildLanguageQualityFallbackReply('en'),'general review HTTP/timeout/semantic correction failure uses honest expression fallback, never a support-policy denial');
 check(!failed.text.includes('support route')&&!failed.text.includes('terms'),'generic failure does not pretend store conditions were unverified');
}
const unchangedBusiness=await enforceReplyBoundary({...policy,language:'en',assess:async()=>({...yes,allowed:false,guidanceSupported:false,businessFactsSupported:false}),
 repairGroundedReply:async()=>null,recordReview:async()=>{}});
check(unchangedBusiness.text===buildSupportGuidanceUnavailableCopy('en'),'real business semantic rejection retains the existing supported-evidence fallback');
console.log('general failure fallback regression passed (HTTP, timeout, failed semantic correction; real business fallback retained)');

// Exact matched product captions use the same one-correction/full-review loop.
const matchedCaptionIntent = {commerceRoute:'product_search',commerceTopic:'other',knowledgeScope:'business',knowledgeQuery:'',answerRequired:true,
  query:'Arsenal shirt',primarySearchVerified:true,shouldLoadProductContext:true,needsLiveProductData:true,cardAllowed:true,
  searchState:'ready_to_search',requestedTeam:'Arsenal',requestedProductType:'shirt',replyBoundary:{salesAllowed:true,contactAllowed:false}};
const matchedCaptionProducts = [{id:'ordinary-matched',name:'Arsenal Home Jersey',siteId:'shop',available:true,url:'https://example.test/home'}];
const matchedCaption = {character:{...character,site_id:'shop'},language:'en',userText:'Which style would you choose?',
  replyResult:{text:'This is definitely the best official shirt.',speechText:'This is definitely the best official shirt.',sourceType:'ai',sourceRef:'venice-chat-completions'},
  searchIntent:matchedCaptionIntent,knowledgeContext:{items:[]},productContext:{sourceType:'product_api',sourceRef:'guest-site-product-context',
    siteId:'shop',cardAllowed:true,searchOutcome:'matched',searchIntent:matchedCaptionIntent,products:matchedCaptionProducts}};
const matchedCaptionText='I would lean towards the home style. Which look suits you?';
const matchedCaptionBefore=JSON.stringify(matchedCaption);
for(const confidence of [.9,.5]) {
  const {output,...state}=await run(matchedCaption,{firstVerdict:{...yes,allowed:false,confidence,businessFactsSupported:false},replacementText:matchedCaptionText});
  check(state.repairs.length===1 && state.reviews.length===2 && output.text===matchedCaptionText,'matched card wording gets one fresh candidate then full original review, including low-confidence refusals');
  check(state.reviews[1].businessFactsRequired && state.reviews[1].productContext.products===matchedCaptionProducts,'corrected caption retains the original business-facts contract and exact catalogue evidence');
  check(JSON.stringify(matchedCaption)===matchedCaptionBefore,'caption correction preserves exact cards, intent and sales/contact permissions');
}
for(const secondVerdict of [{...yes,allowed:false,businessFactsSupported:false},{...yes,allowed:false,evidenceSupported:false}]) {
  const {output,...state}=await run(matchedCaption,{firstVerdict:{...yes,allowed:false,businessFactsSupported:false},secondVerdict,replacementText:matchedCaptionText});
  check(state.repairs.length===1 && state.reviews.length===2 && output.text!==matchedCaptionText,'a corrected caption that fails the same contracts is rejected without another correction');
}
const unmatchedCaption=await run({...matchedCaption,productContext:{...matchedCaption.productContext,siteId:'foreign'}},
  {firstVerdict:{...yes,allowed:false,businessFactsSupported:false},replacementText:matchedCaptionText});
check(unmatchedCaption.repairs.length===0,'a foreign-site snapshot cannot enter matched-caption recovery');
console.log('matched catalogue caption full-review regression passed');

const matchedLanguagePriority = await run(matchedCaption,{firstVerdict:yes,firstLanguageAccepted:false,replacementText:matchedCaptionText});
check(matchedLanguagePriority.repairs.length===1 && matchedLanguagePriority.languageRepairs===0,
  'matched-caption language failure chooses the existing grounded correction instead of an ungrounded regeneration');
check(matchedLanguagePriority.reviews.length===2 && matchedLanguagePriority.output.text===matchedCaptionText,
  'matched-caption language correction still receives the complete second review');
const matchedLanguageRejected = await run(matchedCaption,{firstVerdict:yes,firstLanguageAccepted:false,
  secondVerdict:{...yes,allowed:false,businessFactsSupported:false},replacementText:matchedCaptionText});
check(matchedLanguageRejected.repairs.length===1 && matchedLanguageRejected.languageRepairs===0 && matchedLanguageRejected.reviews.length===2,
  'a rejected grounded language correction does not start a second regeneration');
check(matchedLanguageRejected.output.text!==matchedCaptionText,'failed second business review cannot publish the corrected caption');
for(const unchangedBase of [policy,candidate]) {
  const unchangedPriority = await run(unchangedBase,{firstVerdict:yes,firstLanguageAccepted:false});
  check(unchangedPriority.repairs.length===0 && unchangedPriority.languageRepairs===1,
    'policy and candidate language failure keep their existing regeneration priority');
}
console.log('matched caption language-priority regression passed');

const captionClock={required:false,status:'not_required',asOfUtc:'2026-10-20T03:00:00.000Z',searched:false,items:[]};
const matchedClockRepair=await run({...matchedCaption,factualContext:captionClock},{firstVerdict:{...yes,allowed:false,factualSupported:false,businessFactsSupported:false},replacementText:matchedCaptionText});
check(matchedClockRepair.repairs.length===1 && matchedClockRepair.languageRepairs===0 && matchedClockRepair.reviews.length===2
  && matchedClockRepair.output.text===matchedCaptionText,'a clock-only incidental fact failure uses one same-source correction and complete re-review');
check(matchedClockRepair.reviews[1].factualRequired && matchedClockRepair.reviews[1].businessFactsRequired,
  'clock-only caption recovery never skips the factual or business review');
const publicFactRepair=await run({...matchedCaption,factualContext:{...captionClock,required:true,status:'matched',searched:true,items:[{text:'current public evidence'}]}},
  {firstVerdict:{...yes,allowed:false,factualSupported:false,businessFactsSupported:false},replacementText:matchedCaptionText});
check(publicFactRepair.repairs.length===0 && publicFactRepair.output.text!==matchedCaptionText,'a mixed real public-fact query cannot use the matched-caption exception');
console.log('matched caption clock-only scope and complete factual review regression passed');

// Simultaneous language + business/clock-review rejection still gets only the
// existing grounded text correction, then the COMPLETE original review.
const { repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
let diagnosticReviews = 0, diagnosticLanguages = 0, diagnosticCorrections = 0;
const diagnosticOriginal = 'The quoted waiting status proves review has started. 它的';
const diagnosticCorrected = 'That quoted status usually means waiting for review or release; it does not confirm the review has started or an arrival date. Use the supplied order entry to view your order.';
const diagnosticOrder = { kind: 'ttmall_order_lookup', status: 'login_required', siteSlug: 'shop' };
const diagnosticOptions = { character, language: 'en', userText: 'The quoted tracking status has not changed for six days.',
 searchIntent: { commerceRoute: 'store_policy', commerceTopic: 'delivery', knowledgeScope: 'business', answerRequired: true,
  shouldLoadProductContext: false, cardAllowed: false, needsLiveProductData: false, replyBoundary: { salesAllowed: false, contactAllowed: false } },
 factualContext: { required: false, status: 'not_required', searched: false, items: [], asOfUtc: '2026-10-22T00:00:00Z' },
 knowledgeContext: { strategy: 'business_selection_unavailable', items: [], selectionFailure: { stage: 'evidence', kind: 'protocol_shape' } },
 orderActionCandidate: diagnosticOrder, independentLanguageQualityRequired: true, languageQualityRequired: true,
 replyResult: { sourceType: 'ai', sourceRef: 'venice-chat-completions', aiModel: 'fixture-generator', text: diagnosticOriginal, speechText: diagnosticOriginal },
 assess: async () => { diagnosticReviews++; return { ...yes, allowed: diagnosticReviews > 1,
  factualSupported: diagnosticReviews > 1, guidanceSupported: diagnosticReviews > 1, businessFactsSupported: diagnosticReviews > 1 }; },
 assessLanguageQuality: async () => { diagnosticLanguages++; return { reviewStatus: 'valid', confidence: .99,
  languageQualitySupported: diagnosticLanguages > 1, retainedLanguageQualitySupported: false, languageIssues: [] }; },
 repairGroundedReply: options => repairGroundedCommerceReply({ ...options, config: { apiKey: 'fixture-key', model: 'fixture-reviewer', baseUrl: 'https://fixture.invalid' },
  requestText: async () => { diagnosticCorrections++; return JSON.stringify({ displayText: diagnosticCorrected }); } }),
 recordReview: async () => {},
};
const diagnosticAccepted = await enforceReplyBoundary(diagnosticOptions);
check(diagnosticCorrections === 1 && diagnosticReviews === 2 && diagnosticLanguages === 2,
 'one new diagnostic text candidate receives original business/clock/guidance and independent-language reviews');
check(diagnosticAccepted.text === diagnosticCorrected && diagnosticOrder.status === 'login_required',
 'accepted correction preserves the existing order entry without a lookup or fabricated result');
let terminalReviews = 0, terminalCorrections = 0;
const diagnosticRejected = await enforceReplyBoundary({ ...diagnosticOptions,
 assess: async () => { terminalReviews++; return { ...yes, allowed: false, factualSupported: false, guidanceSupported: false, businessFactsSupported: false }; },
 assessLanguageQuality: async () => ({ reviewStatus: 'valid', confidence: .99, languageQualitySupported: false, retainedLanguageQualitySupported: false, languageIssues: [] }),
 repairGroundedReply: options => repairGroundedCommerceReply({ ...options, config: { apiKey: 'fixture-key', model: 'fixture-reviewer', baseUrl: 'https://fixture.invalid' },
  requestText: async () => { terminalCorrections++; return JSON.stringify({ displayText: diagnosticCorrected }); } }),
});
check(terminalCorrections === 1 && terminalReviews === 2 && diagnosticRejected.text !== diagnosticCorrected,
 'a rejected diagnostic correction terminates without another candidate or bypassing either review');
console.log('order diagnostic simultaneous-rejection one-correction/full-review and terminal-rejection checks passed');
