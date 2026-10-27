import assert from 'node:assert/strict';
import { productCandidateContext } from '../server/product-search-execution-service.js';
import { toGuestSafeProduct } from '../server/guest-product-sanitizer.js';
import { toCandidateReviewContext } from '../server/product-candidate-context-service.js';
import { hasCandidateContextSource } from '../server/product-candidate-source-proof.js';
const location = { siteId: 'candidate_term_site', characterId: 'mascot_term_fixture' };
const source = { id: 'candidate_term_product', productId: 'candidate_term_product', name: 'Barcelona Home Jersey 2026/27',
  url: 'https://candidate.example/product/one', imageUrl: 'https://candidate.example/one.png', available: true,
  matchStatus: 'candidate', unmatchedSearchTerms: ['morado'], candidateUnknownFields: [],
  attributeEvidence: { edition: 'unknown', sleeve: 'unknown', printing: 'none', giveaway: false } };
const safe = toGuestSafeProduct(source, { id: location.siteId, slug: 'candidate' }, { allowedOrigins: ['https://candidate.example'], includeAttributeEvidence: true });
assert.equal(safe.unmatchedSearchTerms, undefined, 'public projection intentionally strips raw search metadata');
const intent = term => ({ commerceRoute: 'product_search', shouldLoadProductContext: true, cardAllowed: true,
  requestedTeam: 'Barcelona', requestedProductType: 'shirt', requestedKeywords: [term],
  productCandidateState: { version: 1, status: 'active', siteId: location.siteId, characterId: location.characterId, owner: 'single',
    targetEvidence: `Barcelona ${term}`, requestedConditionEvidence: [`Barcelona ${term}`], requirements: { requestedKeywords: [term] }, proposal: null } });
const build = (product, searchIntent) => ({ siteId: location.siteId, searchIntent, cardAllowed: true, searchOutcome: 'candidate', products: [product],
  candidateContext: productCandidateContext([product], searchIntent, location) });
// This assertion fails on the original production construction path after the
// actual guest-safe projection; no new helper/export is needed to see the red.
const before = JSON.stringify(safe), first = build(safe, intent('morado'));
assert.deepEqual(first.candidateContext.products[0].unmatchedSearchTerms, ['morado'], 'guest-safe candidate must retain unverified current requirement');
for (const term of ['tartan', 'dorado']) {
  const current = intent(term), snapshot = JSON.stringify(current), context = build(safe, current);
  assert.deepEqual(context.candidateContext.products[0].unmatchedSearchTerms, [term], 'not a color/language-specific repair');
  assert.deepEqual(toCandidateReviewContext(context).products[0].unmatchedSearchTerms, [term], 'generation and review share the gap');
  assert(hasCandidateContextSource(context.candidateContext, current, [safe], location));
  assert.equal(hasCandidateContextSource(context.candidateContext, current, [safe], { ...location, siteId: 'foreign' }), false, 'term evidence cannot forge site proof');
  assert.equal(hasCandidateContextSource(context.candidateContext, current, [safe], { ...location, characterId: 'foreign' }), false, 'term evidence cannot forge character proof');
  assert.equal(JSON.stringify(current), snapshot, 'candidate metadata cannot alter current constraints or permissions');
}
assert.deepEqual(build({ ...safe, name: 'Barcelona Tartan Jersey' }, intent('tartan')).candidateContext.products[0].unmatchedSearchTerms, []);
assert.deepEqual(build({ ...safe, name: 'Barcelona TARTAN Jersey' }, intent('tartan')).candidateContext.products[0].unmatchedSearchTerms, []);
assert.deepEqual(build({ ...safe, name: 'Barcelona Tartanized Jersey' }, intent('tartan')).candidateContext.products[0].unmatchedSearchTerms, ['tartan'], 'retrieval prefixes do not prove complete attributes');
assert.deepEqual(build({ ...safe, subtitle: 'tartan', summary: 'tartan', tag: 'tartan' }, intent('tartan')).candidateContext.products[0].unmatchedSearchTerms, ['tartan'], 'query echoes outside real title cannot prove the condition');
assert.deepEqual(build({ ...safe, unmatchedSearchTerms: ['morado'] }, intent('dorado')).candidateContext.products[0].unmatchedSearchTerms, ['dorado'], 'later requirement replaces stale raw search terms');
assert.deepEqual(build({ ...safe, unmatchedSearchTerms: ['morado'] }, intent('home')).candidateContext.products[0].unmatchedSearchTerms, [], 'matching revised condition does not retain an old gap');
assert.deepEqual(build({ ...safe, unmatchedSearchTerms: ['unrelated'] }, intent('tartan')).candidateContext.products[0].unmatchedSearchTerms, ['tartan'], 'raw metadata cannot introduce an unrequested condition');
const named = { ...intent('cristiano'), requestedKeywords: ['cristiano', 'ronaldo'] };
assert.deepEqual(build({ ...safe, name: 'RONALDO #7 Portugal Jersey', unmatchedSearchTerms: ['morado'] }, named).candidateContext.products[0].unmatchedSearchTerms, ['cristiano'], 'name-specific identity evidence keeps priority');
assert.deepEqual(build({ ...safe, name: 'CRISTIANO RONALDO #7 Portugal Jersey', unmatchedSearchTerms: ['morado'] }, named).candidateContext.products[0].unmatchedSearchTerms, [], 'complete name does not retain stale gaps');
assert.equal(JSON.stringify(safe), before);
const { unmatchedProductSearchTerms } = await import('../server/product-search-match-service.js');
assert.deepEqual(unmatchedProductSearchTerms(safe, ['morado', 'MORADO', '', null, 'x', 'a'.repeat(81)]), ['morado']);
assert.equal(unmatchedProductSearchTerms(safe, Array.from({ length: 15 }, (_, i) => `term${i}`)).length, 8, 'bounded metadata');
assert.deepEqual(unmatchedProductSearchTerms({ name: 'Barcelona red-and-white shirt' }, ['red and white']), [], 'reuse existing search punctuation normalization');
console.log('candidate unmatched-term self-check passed: real guest-safe construction, generic gaps, exact title, revision, name priority, bounded review and unchanged source/permissions; no DB/network/models');
