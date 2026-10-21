import assert from 'node:assert/strict';
import {
  normalizeProductRequest, readProductRequestState, applyProductRequestScope,
  hasPendingProductRequest, getProductRequestItemText, productScopeHistory,
  stripProductRequestPayload, mergeProductRequestPayload,
} from '../server/product-request-scope-service.js';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
const text = 'I want a red Madrid shirt and a blue Barcelona shirt, both size M';
const request = { relation: 'multiple', action: 'new', items: [
  { evidence: 'a red Madrid shirt', sharedEvidence: 'both size M' },
  { evidence: 'a blue Barcelona shirt', sharedEvidence: 'both size M' },
], selectedIndex: null, selectionEvidence: '' };
const decision = (productRequest = request) => ({ route: 'product_search', confident: true, confidence: .9, productRequest });
const scope = { siteId: 'site-a', characterId: 'char-a', userText: text };
const builderCalls = [];
const buildIntent = (value) => { builderCalls.push(value); return { query: value, requestedTeam: value.includes('Madrid') ? 'Madrid' : 'Barcelona', requestedSizes: value.includes('size M') ? ['M'] : [], searchState: 'ready_to_search', shouldLoadProductContext: true }; };
const pending = applyProductRequestScope({ query: 'wrong first target', cardAllowed: true }, decision(), scope);
check(pending.productScopePending && !pending.cardAllowed && !pending.shouldLoadProductContext, 'multiple request cannot search first target');
check(pending.searchState === 'needs_clarification' && pending.answerRequired, 'uses existing clarification state');
check(pending.productRequestState.items.length === 2 && pending.productRequestState.clarificationCount === 1, 'both items retained');
check(hasPendingProductRequest(pending), 'pending helper');
const history = [{ senderType: 'character', productRequestState: pending.productRequestState, text: 'Which first?' }];
const helpText = 'Can you help me choose shirts?';
const continuePendingRequest = { relation: 'multiple', action: 'continue', items: [], selectedIndex: null, selectionEvidence: helpText };
const continuePending = normalizeProductRequest(continuePendingRequest, { userText: helpText, confidence: .9, previousState: pending.productRequestState });
check(continuePending.valid && continuePending.selectedIndex === null, 'ordinary continued help has a valid pending transition without selecting a target');
const pendingContinued = applyProductRequestScope({ query: 'shirts', cardAllowed: true, shouldLoadProductContext: true }, decision(continuePendingRequest), { ...scope, userText: helpText, recentMessages: history, buildIntent });
check(pendingContinued.productRequestState.status === 'pending' && pendingContinued.productRequestState.items.length === 2 && pendingContinued.productRequestState.selectedIndex === null, 'continued help retains every prior target and selects none');
check(!pendingContinued.productRequestUnverified && !pendingContinued.scopeUnverified && !pendingContinued.cardAllowed && !pendingContinued.shouldLoadProductContext && !pendingContinued.query, 'valid pending continuation grants no search or cards');
check(builderCalls.length === 0, 'pending continuation does not even rebuild a selected query');
for (const patch of [{ selectionEvidence: '' }, { selectionEvidence: 'not current' }, { relation: 'single' }, { items: [{ evidence: 'forged' }] }]) {
  check(!normalizeProductRequest({ ...continuePendingRequest, ...patch }, { userText: helpText, confidence: .9, previousState: pending.productRequestState }).valid, 'pending continuation requires bounded current evidence and multiple empty-item shape');
}
for (const changedScope of [{ siteId: 'another-site' }, { characterId: 'another-character' }]) {
  const isolated = applyProductRequestScope({}, decision(continuePendingRequest), { ...scope, ...changedScope, userText: helpText, recentMessages: history });
  check(!isolated.productRequestState && isolated.scopeUnverified && !isolated.cardAllowed, 'continued help cannot import another site or character pending scope');
}
for (const relation of ['single', 'alternative', 'comparison']) {
  const reset = applyProductRequestScope({ query: 'new shirt', cardAllowed: true }, decision({ relation, action: 'new', items: [], selectedIndex: null, selectionEvidence: '' }), { ...scope, userText: 'a new shirt instead', recentMessages: history });
  check(reset.productRequestState.status === 'cleared' && !reset.productScopePending && reset.query === 'new shirt', 'explicit new independent or alternative/comparison request retains original reset behavior');
}
const chosen = applyProductRequestScope({ requestedTeam: 'wrong', requestedColor: 'red', referencedProductId: 'old-card', requestedSizes: ['XL'], query: 'mixed' }, decision({ relation: 'multiple', action: 'select', items: [{ evidence: 'forged' }], selectedIndex: 1, selectionEvidence: 'second' }), { ...scope, userText: 'The second first', recentMessages: [{ ...history[0], productRequestState: pendingContinued.productRequestState }], buildIntent });
check(!chosen.productScopePending && chosen.productRequestState.status === 'selected', 'explicit selection resolves');
check(chosen.query === 'a blue Barcelona shirt both size M' && chosen.requestedSizes[0] === 'M', 'selected raw item and shared size rebuild');
check(!chosen.referencedProductId && !chosen.requestedColor && chosen.requestedTeam === 'Barcelona', 'other target and old card fields removed');
check(chosen.productRequestState.items[0].evidence === request.items[0].evidence, 'model cannot replace stored items');
check(getProductRequestItemText(chosen.productRequestState, 0) === 'a red Madrid shirt both size M', 'other item retained');
check(builderCalls.length === 2, 'pure builder verifies selected and current conditions without search');
check(readProductRequestState(history, scope)?.status === 'pending', 'reads server history state');
check(readProductRequestState(history, { ...scope, siteId: 'different' }) === null, 'site isolation');
check(readProductRequestState(history, { ...scope, characterId: 'different' }) === null, 'character isolation');
check(readProductRequestState([{ ...history[0], senderType: 'user' }], scope) === null, 'user metadata cannot establish state');
const again = applyProductRequestScope({}, decision({ relation: 'multiple', action: 'select', selectedIndex: null, selectionEvidence: '' }), { ...scope, userText: 'Both please', recentMessages: history });
check(again.searchState === 'needs_clarification' && again.productRequestState.clarificationCount === 2, 'second unresolved question is allowed');
const exhausted = applyProductRequestScope({}, decision(), { ...scope, recentMessages: [{ ...history[0], productRequestState: again.productRequestState }] });
check(exhausted.searchState === 'clarification_exhausted' && exhausted.productRequestState.clarificationCount === 2, 'question cap cannot overflow');
for (const confidence of [0, .74, Infinity, NaN, '0.9', 1.01, -.1]) check(!normalizeProductRequest(request, { userText: text, confidence }).valid, 'confidence strict and bounded');
check(normalizeProductRequest(request, { userText: text, confidence: .75 }).valid, 'existing threshold preserved');
for (const invalid of [null, {}, { ...request, items: [request.items[0]] }, { ...request, items: [request.items[0], request.items[0]] }, { ...request, items: [request.items[0], { evidence: 'not user text', sharedEvidence: '' }] }, { ...request, items: [request.items[0], { ...request.items[1], sharedEvidence: 'invented shared size' }] }]) check(!normalizeProductRequest(invalid, { userText: text, confidence: .9 }).valid, 'invalid request evidence rejected');
const fiveText = 'one two three four five';
check(!normalizeProductRequest({ ...request, items: fiveText.split(' ').map(evidence => ({ evidence })) }, { userText: fiveText, confidence: .9 }).valid, 'too many items rejected without truncation');
const long = 'a'.repeat(241);
check(!normalizeProductRequest({ ...request, items: [{ evidence: long }, { evidence: 'b' }] }, { userText: long + ' b', confidence: .9 }).valid, 'long item rejected without truncation');
for (const relation of ['single', 'alternative', 'comparison', 'none']) {
  const input = { query: 'existing', cardAllowed: true, requestedSizes: ['L'] };
  const out = applyProductRequestScope(input, decision({ relation, action: 'new', items: [], selectedIndex: null, selectionEvidence: '' }), scope);
  check(out.query === input.query && out.cardAllowed && out.requestedSizes[0] === 'L' && !out.productScopePending, 'other relations preserve old rules');
}
const failed = applyProductRequestScope({ query: 'first', cardAllowed: true }, { route: 'product_search', confidence: .1, confident: false }, scope);
check(failed.productRequestUnverified && failed.productScopePending && !failed.cardAllowed && !failed.shouldLoadProductContext, 'classifier failure cannot search first item');
const unclear = applyProductRequestScope({ query: 'first', cardAllowed: true }, decision({ relation: 'unclear', action: 'new', items: [] }), scope);
check(unclear.scopeUnverified && !unclear.cardAllowed && !unclear.shouldLoadProductContext, 'unclear or too-many relation cannot silently search first item');
const noBuilder = applyProductRequestScope({}, decision({ relation: 'multiple', action: 'select', selectedIndex: 0, selectionEvidence: 'first' }), { ...scope, userText: 'first', recentMessages: history });
check(noBuilder.productScopePending && noBuilder.productRequestUnverified, 'missing builder fails conservatively');
const canceled = applyProductRequestScope({}, decision({ relation: 'none', action: 'cancel', items: [], selectedIndex: null, selectionEvidence: 'Never mind' }), { ...scope, userText: 'Never mind', recentMessages: history });
check(canceled.productRequestState.status === 'cleared' && !canceled.productScopePending, 'cancel writes clearing state');
const canceledFailure = applyProductRequestScope({ ...failed, scopeUnverified: true }, decision({ relation: 'none', action: 'cancel', items: [], selectedIndex: null, selectionEvidence: 'Never mind' }), { ...scope, userText: 'Never mind', recentMessages: history });
check(!hasPendingProductRequest(canceledFailure), 'cancel clears unverified markers as well as state');
check(readProductRequestState([...history, { senderType: 'character', productRequestState: canceled.productRequestState }], scope)?.status === 'cleared', 'clearing prevents resurrection');
const payload = { kind: 'existing-feedback', nested: { untouched: true }, _productRequestScope: { unsafe: true } };
const stored = mergeProductRequestPayload(payload, pending.productRequestState);
check(stored.kind === payload.kind && stored.nested.untouched && stored._productRequestScope.version === 1, 'namespace merge preserves unrelated payload');
check(payload._productRequestScope.unsafe, 'merge does not mutate payload');
const client = stripProductRequestPayload(stored);
check(!('_productRequestScope' in client) && client.kind === payload.kind, 'client namespace stripped');
check(stripProductRequestPayload(null) === null && stripProductRequestPayload({ _productRequestScope: pending.productRequestState }) === null, 'namespace-only/null client payload is empty');
check(mergeProductRequestPayload({ ok: true }, { version: 99 }).ok && !mergeProductRequestPayload({ ok: true }, { version: 99 })._productRequestScope, 'invalid state not persisted');
check(productScopeHistory(history, pending).length === 0 && history.length === 1, 'pending producer history is isolated without mutation');
const selectedHistory = [...history, { senderType: 'character', productRequestState: chosen.productRequestState, text: 'Checking second.' },
  { senderType: 'character', contentType: 'product', product: { id: 'selected-card' } },
  { senderType: 'user', contentType: 'text', text: 'old conditions cannot leak' }];
check(productScopeHistory(selectedHistory, chosen).length === 1 && productScopeHistory(selectedHistory, chosen)[0].product.id === 'selected-card', 'only product rows after matching selected boundary survive');
check(productScopeHistory(history, chosen).length === 0, 'initial selection cannot retain previous pending cards');
check(productScopeHistory(selectedHistory, { ...chosen, productRequestState: { ...chosen.productRequestState, selectedIndex: 0 } }).length === 0, 'switch target cannot reuse other target card');
check(productScopeHistory([...selectedHistory, { senderType: 'user', contentType: 'product', product: { id: 'untrusted' } }], chosen).length === 1, 'user products cannot establish trusted producer context');
const persistedOrder = [
  { id: 'p', displayOrder: 10, senderType: 'character', contentType: 'text', productRequestState: pending.productRequestState },
  { id: 'u', displayOrder: 20, senderType: 'user', contentType: 'text', text: 'second' },
  { id: 'c', displayOrder: 30, senderType: 'character', contentType: 'product', product: { id: 'barcelona-card' } },
  { id: 's', displayOrder: 35, senderType: 'character', contentType: 'text', productRequestState: chosen.productRequestState },
];
check(productScopeHistory(persistedOrder, chosen)[0]?.product.id === 'barcelona-card', 'actual card-before-state storage order preserves selected own card');
check(productScopeHistory([...persistedOrder, { id: 't', displayOrder: 40, senderType: 'character', contentType: 'text', text: 'ordinary text' }], chosen).length === 1, 'ordinary later text does not drop own selected card');
const sameScopeAgain = [...persistedOrder,
  { id: 'u2', displayOrder: 50, senderType: 'user', contentType: 'text', text: 'continue' },
  { id: 's2', displayOrder: 60, senderType: 'character', contentType: 'text', productRequestState: chosen.productRequestState }];
check(productScopeHistory(sameScopeAgain, chosen).length === 1, 'repeated same selected state retains earlier card in contiguous scope segment');
for (const boundaryState of [pending.productRequestState, canceled.productRequestState, { ...chosen.productRequestState, selectedIndex: 0 }, { version: 99 }, null]) {
  const barrierRows = [...persistedOrder,
    { id: 'barrier', displayOrder: 40, senderType: 'character', contentType: 'text', productRequestState: boundaryState },
    { id: 'new-user', displayOrder: 50, senderType: 'user', contentType: 'text', text: 'second' },
    { id: 'new-card', displayOrder: 60, senderType: 'character', contentType: 'product', product: { id: 'new-selected-card' } },
    { id: 'new-state', displayOrder: 65, senderType: 'character', contentType: 'text', productRequestState: chosen.productRequestState }];
  const cards = productScopeHistory(barrierRows, chosen);
  check(cards.length === 1 && cards[0].product.id === 'new-selected-card', 'different/pending/cleared/invalid scope cuts previous cards');
}
check(productScopeHistory([{ senderType: 'character', contentType: 'product', product: { id: 'legacy' } }, persistedOrder[3]], chosen).length === 0, 'unanchored adjacent legacy card is not attributed to selected turn');
check(productScopeHistory(persistedOrder.map(row => row.id === 'c' ? { ...row, displayOrder: 36 } : row), chosen).length === 0, 'invalid actual storage order is rejected');
check(productScopeHistory(persistedOrder.map(row => row.id === 's' ? { ...row, id: 'c' } : row), chosen).length === 0, 'duplicate row IDs cannot establish storage segment');
check(productScopeHistory(persistedOrder.map(row => row.id === 'c' ? { ...row, characterId: 'another-character' } : row), chosen).length === 0, 'foreign character card cannot belong to selected turn');
check(productScopeHistory(persistedOrder.slice(1), chosen).length === 1, 'available user boundary proves clipped frame without old pending state');
check(productScopeHistory([...persistedOrder, null], chosen).length === 0, 'malformed producer history remains conservative');
for (const bad of [undefined, null, { ...pending.productRequestState, version: 2 }, { ...pending.productRequestState, clarificationCount: 3 }, { ...pending.productRequestState, selectedIndex: 0 }, { ...pending.productRequestState, items: [{ evidence: 'x', sharedEvidence: '', text: 'injected' }, { evidence: 'y', sharedEvidence: '', text: 'y' }] }]) {
  const newest = { senderType: 'character', productRequestState: bad };
  check(readProductRequestState([...history, newest], scope) === null, 'invalid latest state blocks older pending state');
  check(!mergeProductRequestPayload({ keep: 1 }, bad)?._productRequestScope, 'invalid state never persisted');
}
for (const scalar of ['existing string', 4, false, [], null, undefined]) {
  check(stripProductRequestPayload(scalar) === scalar, 'strip retains non-object payload types');
  check(mergeProductRequestPayload(scalar, null) === scalar, 'no-state merge retains original payload');
}
const contaminated = { ...pending.productRequestState, secret: 'do-not-copy', items: pending.productRequestState.items.map(item => ({ ...item, arbitrary: 'drop' })) };
const filtered = mergeProductRequestPayload({ other: true }, contaminated)._productRequestScope;
check(!filtered.secret && filtered.items.every(item => !item.arbitrary), 'state metadata allowlist');
check(!normalizeProductRequest({ ...request, action: 'select', selectedIndex: 9, selectionEvidence: 'first' }, { userText: 'first', confidence: .9, previousState: pending.productRequestState }).valid, 'index cannot exceed stored items');
check(!normalizeProductRequest({ ...request, action: 'select', selectedIndex: 0, selectionEvidence: 'first' }, { userText: 'second', confidence: .9, previousState: pending.productRequestState }).valid, 'selection evidence must belong to current turn');
check(!normalizeProductRequest({ ...request, action: 'continue', selectedIndex: null, selectionEvidence: 'continue' }, { userText: 'continue', confidence: .9, previousState: pending.productRequestState }).valid, 'continue cannot auto-select pending first target');
const continued = normalizeProductRequest({ ...request, action: 'continue', selectedIndex: null, selectionEvidence: 'continue' }, { userText: 'continue', confidence: .9, previousState: chosen.productRequestState });
check(continued.valid && continued.selectedIndex === 1, 'continue stays on explicit current selected item');
for (const relation of ['single', 'alternative', 'comparison', 'none']) {
  const fresh = applyProductRequestScope({ query: 'fresh' }, decision({ relation, action: 'new', items: [], selectedIndex: null, selectionEvidence: '' }), { ...scope, recentMessages: history });
  check(fresh.query === 'fresh' && fresh.productRequestState.status === 'cleared', 'new normal topic clears finite previous scope');
}
const retainedPermissions = applyProductRequestScope({ shouldLoadProductContext: false, cardAllowed: false, replyBoundary: { salesAllowed: false, contactAllowed: false } }, decision({ ...request, action: 'select', selectedIndex: 1, selectionEvidence: 'second' }), { ...scope, userText: 'second', recentMessages: history, buildIntent });
check(!retainedPermissions.shouldLoadProductContext && !retainedPermissions.cardAllowed && !retainedPermissions.replyBoundary.contactAllowed, 'scope selection cannot grant product/contact permission');
const conditionBuilder = (value) => ({ query: value, requestedTeam: value.includes('Barcelona') ? 'Barcelona' : '', requestedSizes: value.includes('size L') ? ['L'] : value.includes('size M') ? ['M'] : [], requestedColor: value.includes('yellow') ? 'yellow' : value.includes('blue') ? 'blue' : '', searchState: 'ready_to_search' });
const revised = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision({ ...request, action: 'select', selectedIndex: 1, selectionEvidence: 'second' }), { ...scope, userText: 'second, yellow size L', recentMessages: history, buildIntent: conditionBuilder });
check(revised.requestedSizes[0] === 'L' && revised.requestedColor === 'yellow' && revised.productRequestState.items[0].text.includes('size M'), 'current change only overrides selected target, other target unchanged');
const resumed = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision({ ...request, action: 'continue', selectedIndex: null, selectionEvidence: 'continue' }), { ...scope, userText: 'continue', recentMessages: [{ senderType: 'character', productRequestState: revised.productRequestState }], buildIntent: conditionBuilder });
check(resumed.requestedSizes[0] === 'L' && resumed.requestedColor === 'yellow', 'validated current revisions survive next continuation');
check(revised.productRequestState.items[1].updates[0] === 'second, yellow size L', 'only exact current raw revision is stored');
check(!normalizeProductRequest({ ...request, items: [{ evidence: 'red Madrid shirt' }, { evidence: 'Madrid shirt' }] }, { userText: text, confidence: .9 }).valid, 'overlapping evidence cannot masquerade as distinct targets');
const firstMatchBuilder = value => ({ query: value, requestedTeam: value.includes('Barcelona') ? 'Barcelona' : '', requestedSizes: value.match(/size ([ML])/g)?.map(match => match.slice(-1)) || [], requestedColor: value.match(/blue|yellow/g)?.[0] || '', searchState: 'ready_to_search' });
const resumedFirst = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision({ ...request, action: 'continue', selectedIndex: null, selectionEvidence: 'continue' }), { ...scope, userText: 'continue', recentMessages: [{ senderType: 'character', productRequestState: revised.productRequestState }], buildIntent: firstMatchBuilder });
check(resumedFirst.requestedSizes.length === 1 && resumedFirst.requestedSizes[0] === 'L' && resumedFirst.requestedColor === 'yellow', 'revision overrides mixed/first-match parser rather than relying on concatenation');
let repeatedState = revised.productRequestState;
for (const repeatedText of ['second, yellow size L', 'continue, yellow size L', 'yellow size L please', 'size L yellow']) {
  const repeated = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision({ ...request, action: 'continue', selectedIndex: null, selectionEvidence: repeatedText }), {
    ...scope, userText: repeatedText, recentMessages: [{ senderType: 'character', productRequestState: repeatedState }], buildIntent: firstMatchBuilder,
  });
  check(!hasPendingProductRequest(repeated) && repeated.productRequestState.items[1].updates.length === 1, 'equivalent repeated conditions do not spend revision budget');
  repeatedState = repeated.productRequestState;
}
const customRequest = { ...request, items: [{ evidence: 'custom Madrid shirt with number 7', sharedEvidence: 'both size M' }, { evidence: 'custom Barcelona shirt with number 7', sharedEvidence: 'both size M' }] };
const customText = 'custom Madrid shirt with number 7 and custom Barcelona shirt with number 7, both size M';
const customPending = applyProductRequestScope({}, decision(customRequest), { ...scope, userText: customText });
const customBuilder = value => ({ query: value, requestedTeam: value.includes('Barcelona') ? 'Barcelona' : '', customizationRequest: value.includes('custom') ? 'jersey' : '', requestedPrintNumber: value.includes('number 7') ? '7' : '', requestedSizes: value.includes('size M') ? ['M'] : [], searchState: 'ready_to_search' });
const clearedFields = value => value.includes('no printing') ? ['customizationRequest', 'requestedPrintNumber'] : [];
const customSelected = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision({ ...customRequest, action: 'select', selectedIndex: 1, selectionEvidence: 'second' }), {
  ...scope, userText: 'second', recentMessages: [{ senderType: 'character', productRequestState: customPending.productRequestState }], buildIntent: customBuilder, getClearedFields: clearedFields,
});
const customRemoved = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision({ ...customRequest, action: 'continue', selectedIndex: null, selectionEvidence: 'no printing' }), {
  ...scope, userText: 'no printing', recentMessages: [{ senderType: 'character', productRequestState: customSelected.productRequestState }], buildIntent: customBuilder, getClearedFields: clearedFields,
});
check(!customRemoved.customizationRequest && !customRemoved.requestedPrintNumber && customRemoved.productRequestState.items[1].updates.length === 1, 'actual deletion of existing print conditions persists exactly once');
for (const repeat of ['no printing', 'please no printing', 'no printing thank you']) {
  const removedAgain = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true }, decision({ ...customRequest, action: 'continue', selectedIndex: null, selectionEvidence: repeat }), {
    ...scope, userText: repeat, recentMessages: [{ senderType: 'character', productRequestState: customRemoved.productRequestState }], buildIntent: customBuilder, getClearedFields: clearedFields,
  });
  check(!hasPendingProductRequest(removedAgain) && removedAgain.productRequestState.items[1].updates.length === 1 && !removedAgain.productCustomizationRequest, 'repeat deletion of already removed condition spends no revision budget');
}
const brokenBuilder = applyProductRequestScope({}, decision({ ...request, action: 'select', selectedIndex: 1, selectionEvidence: 'second' }), { ...scope, userText: 'second', recentMessages: history, buildIntent: () => { throw new Error('failure'); } });
check(hasPendingProductRequest(brokenBuilder) && brokenBuilder.scopeUnverified && !brokenBuilder.cardAllowed, 'builder failure remains pending');
for (let count = 2; count <= 4; count++) {
  const raw = Array.from({ length: count }, (_, i) => `item-${i}`).join(' and ');
  const items = Array.from({ length: count }, (_, i) => ({ evidence: `item-${i}`, sharedEvidence: '' }));
  check(normalizeProductRequest({ ...request, items }, { userText: raw, confidence: .9 }).items.length === count, 'bounded items preserve source order');
}

for (const relation of ['single', 'alternative', 'comparison', 'none']) {
  check(!normalizeProductRequest({ ...request, relation, selectedIndex: 1 }, { userText: text, confidence: .99 }).valid, 'contradictory single shape cannot discard items');
}
for (const action of ['cancel', 'suspend']) {
  const stopped = applyProductRequestScope({ shouldLoadProductContext: true, cardAllowed: true, query: 'first target' }, decision({ relation: 'none', action, items: [], selectedIndex: null, selectionEvidence: 'Never mind' }), { ...scope, userText: 'Never mind', recentMessages: history });
  check(!stopped.shouldLoadProductContext && !stopped.cardAllowed, 'stop action cannot query an item despite contradictory product route');
}
console.log(`product-request-scope self-check passed: ${checks} assertions; no network/DB/model calls`);
