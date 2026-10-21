import assert from 'node:assert/strict';
import { resolveGuestProductRecommendation, resolveGuestExternalSourceProductContext, resolveGuestCurrentProductImageCardContext } from '../server/guest-chat-product-service.js';
import { buildChatProductRecommendationContext, resolveCurrentProductImageCardContext } from '../server/chat-product-recommendation-service.js';
import { resolveProductSearchReadiness, resolveProductSearchState } from '../server/product-search-decision-service.js';
import { resolveProductSizingGuidanceReply } from '../server/product-sizing-guidance-service.js';
import { buildProductSearchIntent } from '../server/product-intent-service.js';
import { applyProductRequestScope } from '../server/product-request-scope-service.js';

globalThis.fetch = async () => { throw new Error('External calls disabled in product scope producer check'); };
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const site = { id: 'site_scope', slug: 'scope', currency: 'USD', product_api_url: 'https://shop.invalid/products' };
const character = { id: 'mascot_scope', category_id: 'mascot', site_id: site.id };
const guest = { site_id: site.id, mascot_character_id: character.id };
const oldProduct = { id: 'old', productId: 'old', name: 'Chelsea kids blue away jersey', siteId: site.id, siteSlug: site.slug, url: 'https://shop.invalid/products/old', imageUrl: 'https://shop.invalid/old.jpg', sizes: [{ label: 'M', available: true }] };
const history = [{ senderType: 'character', contentType: 'product', product: oldProduct }];
const calls = { search: 0, cache: 0, sizing: 0, fallback: 0, nonSiteSql: 0 };
const db = { execute: async sql => { if (/FROM sites/.test(sql)) return [[site]]; calls.nonSiteSql++; throw new Error('No non-site database query expected'); } };
const blocked = key => async () => { calls[key]++; throw new Error(`Unexpected ${key} call`); };
const pending = { productScopePending: true, cardAllowed: false, shouldLoadProductContext: false, answerRequired: true, searchState: 'needs_clarification', commerceRoute: 'product_search' };
for (const searchState of ['needs_clarification', 'clarification_exhausted']) {
  for (const userText of ['Send me a picture', 'Would size M fit me?', 'Show me products']) {
    const precomputedSearchIntent = { ...pending, searchState, explicitProductTrigger: true };
    const g = await resolveGuestProductRecommendation(db, { guest, userText, recentMessages: history, precomputedSearchIntent, searchProducts: blocked('search'), classifyIntent: blocked('fallback'), resolveSizingProduct: blocked('sizing') });
    const m = await buildChatProductRecommendationContext(db, { character, userId: 'user_scope', userText, productTrigger: 'products', recentMessages: history, precomputedSearchIntent, fetchProducts: blocked('search'), searchCache: blocked('cache'), classifyIntent: blocked('fallback'), resolveSizingProduct: blocked('sizing') });
    for (const context of [g.context, m]) {
      check(context?.searchOutcome === searchState, 'pending state wins over old card, sizing, source and explicit button');
      check(context.products.length === 0 && !context.sizingProduct && context.cardAllowed !== true, 'unselected scope has no product or sizing facts');
    }
  }
}
check(Object.values(calls).every(n => n === 0), 'pending actual producer paths perform no catalogue/cache/campaign/fallback/sizing calls');
check(await resolveGuestCurrentProductImageCardContext(db, { guest, userText: 'Send me a picture', recentMessages: history, searchIntent: pending }) === null, 'guest independently exported image helper also rejects pending scope');
check(await resolveCurrentProductImageCardContext(db, { character, userText: 'Send me a picture', recentMessages: history, searchIntent: pending }) === null, 'member independently exported image helper also rejects pending scope');
check(await resolveGuestExternalSourceProductContext({ guest, site, userText: 'this item', searchIntent: pending, fetchProductById: blocked('search') }) === null, 'external source helper independently rejects pending scope');
check(resolveProductSearchReadiness({ ...pending, explicitProductTrigger: true }) === 'needs_clarification', 'pending scope wins before explicit trigger readiness');
check(resolveProductSearchReadiness({ ...pending, productRequestState: { status: 'pending', clarificationCount: 2 } }) === 'needs_clarification', 'the scope service already counted this second question; readiness must not prematurely exhaust it');
check(resolveProductSearchState({ ...pending, searchState: 'ready_to_search' }, [oldProduct]).products.length === 0, 'pending state cannot be changed to matched by stale ready/products');
check(resolveProductSizingGuidanceReply({ sourceRef: 'guest-site-product-sizing-match', sizingProduct: oldProduct, searchIntent: { ...pending, answerRequired: false } }) === '', 'pending scope never gets a single-item fixed sizing reply');

const multiText = 'I want a Chelsea blue shirt and a Real Madrid shirt, both size M.';
const decision = { confident: true, confidence: .95, route: 'product_search', topic: 'other', searchQuery: 'Chelsea Madrid shirt', replyBoundary: { salesAllowed: true, contactAllowed: true }, productRequest: { relation: 'multiple', action: 'new', items: [{ evidence: 'Chelsea blue shirt', sharedEvidence: 'both size M' }, { evidence: 'Real Madrid shirt', sharedEvidence: 'both size M' }], selectedIndex: null } };
let classifications = 0;
const classifyCommerce = async (_text, options) => { classifications++; check(options.siteId === site.id && options.characterId === character.id, 'direct guest classification receives the frozen site/character scope'); return decision; };
for (const member of [false, true]) {
  const context = member
    ? await buildChatProductRecommendationContext(db, { character, userId: 'user_scope', userText: 'Send me a picture', recentMessages: history, classifyCommerce: async () => { classifications++; return { ...decision, productRequest: { ...decision.productRequest, items: [{ evidence: 'picture', sharedEvidence: '' }, { evidence: 'Send', sharedEvidence: '' }] } }; }, fetchProducts: blocked('search'), searchCache: blocked('cache'), classifyIntent: blocked('fallback') })
    : (await resolveGuestProductRecommendation(db, { guest, userText: multiText, recentMessages: history, classifyCommerce, searchProducts: blocked('search'), classifyIntent: blocked('fallback') })).context;
  check(context?.searchOutcome === 'needs_clarification' && context.products.length === 0, 'direct non-precomputed producer classifies scope before fast paths');
}
check(classifications === 2, 'each direct producer makes only its existing commerce classification');
const initial = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision, { userText: multiText, siteId: site.id, characterId: character.id, buildIntent: buildProductSearchIntent });
const pendingHistory = [...history, { senderType: 'user', text: multiText }, { senderType: 'character', productRequestState: initial.productRequestState }];
const selected = applyProductRequestScope({ ...buildProductSearchIntent(multiText), shouldLoadProductContext: true, cardAllowed: true }, { confidence: .95, productRequest: { relation: 'multiple', action: 'select', selectedIndex: 1, selectionEvidence: 'second' } }, { userText: 'second', recentMessages: pendingHistory, siteId: site.id, characterId: character.id, buildIntent: buildProductSearchIntent });
let query;
const g = await resolveGuestProductRecommendation(db, { guest, userText: 'second', recentMessages: pendingHistory, precomputedSearchIntent: selected, searchProducts: async options => { query = options; return { items: [], searchState: 'ready_to_search' }; } });
check(query?.searchIntent.requestedTeam === 'Real Madrid', 'selected actual source query uses the chosen item');
check(!query.searchIntent.requestedColor && !query.searchIntent.requestedAudience && !query.searchIntent.requestedVariant, 'selection does not inherit sibling color or old card audience/variant');
check(query.searchIntent.requestedSizes.includes('M'), 'validated original shared size belongs to selected item');
check(g.searchIntent.productRequestState.selectedIndex === 1 && history[0].product === oldProduct, 'selected state is retained and ordinary caller history is unchanged');
let memberCalls = 0;
const member = await buildChatProductRecommendationContext(db, { character, userId: 'user_scope', sessionId: 'session_scope', userText: 'second', recentMessages: pendingHistory, precomputedSearchIntent: selected,
  fetchProducts: async (_url, intent) => { memberCalls++; check(intent.requestedTeam === 'Real Madrid' && !intent.requestedColor && !intent.requestedAudience && !intent.requestedVariant, 'member source query also isolates selected item conditions'); check(intent.requestedSizes.includes('M'), 'member selected source preserves only validated shared size'); return []; }, searchCache: blocked('cache'), classifyCommerce: blocked('fallback'), resolveSizingProduct: blocked('sizing') });
check(memberCalls > 0 && member.products.length === 0 && member.searchIntent.productRequestState.selectedIndex === 1, 'member selected item reaches its own existing source path without a prior card');
const selectedProduct = { ...oldProduct, id: 'selected', productId: 'selected', name: 'Real Madrid home shirt', url: 'https://shop.invalid/products/selected' };
const selectedHistory = [...pendingHistory, { senderType: 'character', productRequestState: selected.productRequestState }, { senderType: 'character', contentType: 'product', product: selectedProduct }];
for (const isGuest of [true, false]) {
  const args = { userText: 'Send me a picture', recentMessages: selectedHistory, searchIntent: selected };
  const current = isGuest ? await resolveGuestCurrentProductImageCardContext(db, { ...args, guest }) : await resolveCurrentProductImageCardContext(db, { ...args, character });
  check(current?.products[0].id === 'selected', 'a verified card after the selected-state boundary remains reusable');
  const old = isGuest ? await resolveGuestCurrentProductImageCardContext(db, { ...args, recentMessages: history, guest }) : await resolveCurrentProductImageCardContext(db, { ...args, recentMessages: history, character });
  check(old === null, 'no durable matching selected boundary means no old product-card reuse');
}
const guestImage = await resolveGuestProductRecommendation(db, { guest, userText: 'Send me a picture', recentMessages: selectedHistory, precomputedSearchIntent: selected, searchProducts: blocked('search') });
check(guestImage.context?.products[0].id === 'selected', 'guest main producer filters scope history exactly once and retains the selected current card');
for (const isGuest of [true, false]) {
  const options = { userText: 'Chelsea shirt', recentMessages: history, classifyCommerce: null };
  const context = isGuest
    ? (await resolveGuestProductRecommendation(db, { ...options, guest, searchProducts: blocked('search'), classifyIntent: blocked('fallback') })).context
    : await buildChatProductRecommendationContext(db, { ...options, character, fetchProducts: blocked('search'), searchCache: blocked('cache'), classifyIntent: blocked('fallback') });
  check(context?.searchOutcome === 'needs_clarification' && context.searchIntent.scopeUnverified === true, 'a missing commerce interpreter is unverified instead of defaulting to single shopping');
}
check(calls.search === 0 && calls.cache === 0 && calls.sizing === 0 && calls.fallback === 0 && calls.nonSiteSql === 0, 'all rejected paths remain side-effect free and selected path uses only supplied source mocks');
let businessSql = 0;
const business = await buildChatProductRecommendationContext({ execute: async () => { businessSql++; throw new Error('Pure business chat must not read product site'); } }, {
  character, userText: 'I want to collaborate with Nike on my business project', classifyCommerce: async () => ({ route: 'chat', confident: true, confidence: .95, productRequest: { relation: 'none', action: 'new', items: [], selectedIndex: null } }), fetchProducts: blocked('search'), searchCache: blocked('cache') });
check(business === null && businessSql === 0, 'pure business chat retains its existing no-site-query early return');
for (const isGuest of [true, false]) {
  const options = { userText: 'Chelsea shirt', classifyCommerce: async () => ({ confident: true, confidence: .95, route: 'product_search', searchQuery: 'Chelsea shirt', replyBoundary: { salesAllowed: true, contactAllowed: true } }) };
  const context = isGuest ? (await resolveGuestProductRecommendation(db, { ...options, guest, searchProducts: blocked('search') })).context
    : await buildChatProductRecommendationContext(db, { ...options, character, fetchProducts: blocked('search'), searchCache: blocked('cache') });
  check(context?.searchOutcome === 'needs_clarification' && context.searchIntent.scopeUnverified === true, 'a confident shopping response without the new request contract is still unverified');
}
for (const precomputed of [true, false]) {
  let legacyCalls = 0;
  let sourceReads = 0;
  const deniedIntent = { ...buildProductSearchIntent('Chelsea shirt'), shouldLoadProductContext: false, cardAllowed: false, commerceRoute: 'product_search' };
  const denied = await resolveGuestProductRecommendation(db, {
    guest, userText: 'Chelsea shirt', recentMessages: [],
    ...(precomputed ? { precomputedSearchIntent: deniedIntent } : {
      intentTurn: { decision: { ok: true, confident: true, primaryIntent: 'product_request', productIntent: 'none', productAction: .4 } },
      classifyCommerce: async () => ({ confident: true, confidence: .99, route: 'product_search', searchQuery: 'Chelsea shirt', productRequest: { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' }, replyBoundary: { salesAllowed: true, contactAllowed: true } }),
    }),
    classifyIntent: async () => { legacyCalls++; return { isProductRequest: true }; },
    searchProducts: async () => { sourceReads++; return { items: [oldProduct] }; },
  });
  check(sourceReads === 0 && !denied.context?.products?.length, 'an existing commerce/JEV denial cannot be reopened into a catalogue read or card');
  check(legacyCalls === 0, 'the legacy product classifier cannot override a resolved or precomputed decision');
}
console.log(`Product scope producer self-check passed (${checks} assertions; mock DB/source, no external calls)`);
