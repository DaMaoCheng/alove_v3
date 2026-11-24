import { normalizeProductCandidateRequirements } from './product-candidate-state-service.js';
import { applyProductRequestScope, readProductRequestState, getProductRequestItemText } from './product-request-scope-service.js';
import { buildProductSearchIntent, extractRequirementClearFields } from './product-intent-service.js';

// Runtime-only authority. Client data and stored JSON cannot construct a step.
const steps = new WeakMap();
const startedBatches = new WeakSet();
export function markProductBatchPrepared(prepared) { startedBatches.add(prepared); }
export function readProductBatchStep(prepared) { return steps.get(prepared) || null; }
export function prepareProductBatchStep(prepared, step) {
  const next = { ...prepared, text: step.userText };
  steps.set(next, step);
  return next;
}

// Execute every validated target, never select the first and discard the rest.
// Each selected scope goes through the unchanged single-item pipeline and review.
export function planProductRequestBatch(intent, { userText = '', siteId = '', characterId = '', jevDecision = {} } = {}) {
  if (!intent || intent.primarySearchVerified !== true || intent.commerceRoute !== 'product_search'
    || intent.scopeUnverified || intent.productRequestUnverified || intent.commerceClassificationFailure
    || intent.nonShoppingReason || intent.replyBoundary?.salesAllowed !== true
    || intent.catalogueOnlyKnowledge !== true || intent.answerRequired !== true
    || intent.businessInquiry || intent.humanHandoff || intent.checkoutIssue || intent.promotionInquiry
    || intent.discountExplanationRequired || intent.guestBenefitContext
    || jevDecision.ok !== true || !jevDecision.confident || jevDecision.primaryIntent !== 'product_request'
    || jevDecision.productIntent !== 'search' || jevDecision.unsupported
    || jevDecision.orderIntent && jevDecision.orderIntent !== 'none'
    || jevDecision.imageIntent && jevDecision.imageIntent !== 'none' || jevDecision.webSearchIntent) return null;
  const state = readProductRequestState([{ senderType: 'character', productRequestState: intent.productRequestState }], { siteId, characterId });
  // Only a current whole-turn new scope can authorize a batch. Historical
  // pending sets and broad continuations never auto-select or change conditions.
  if (state?.status !== 'pending' || (state.originalUserText !== userText && !(intent.batchAllTargets === true && intent.batchUpdateEvidence === userText)) || state.items.length < 2 || state.items.length > 4) return null;
  const result = [];
  for (let index = 0; index < state.items.length; index++) {
    const text = getProductRequestItemText(state, index);
    const selected = applyProductRequestScope({ ...intent, shouldLoadProductContext: true, cardAllowed: true }, {
      route: 'product_search', confidence: 1,
      productRequest: { relation: 'multiple', action: 'select', items: [], selectedIndex: index, selectionEvidence: state.items[index].evidence },
    }, { userText: text, recentMessages: [{ senderType: 'character', productRequestState: state }], siteId, characterId,
      buildIntent: buildProductSearchIntent, getClearedFields: extractRequirementClearFields });
    if (selected.scopeUnverified || selected.productScopePending || selected.productRequestState?.status !== 'selected'
      || !selected.shouldLoadProductContext || !selected.query) return null;
    result.push({ index, count: state.items.length, userText: text, searchIntent: { ...selected, knowledgeQuery: text,
      ...(selected.policyKnowledgeRequest ? { policyKnowledgeRequest: { ...selected.policyKnowledgeRequest, evidence: text, query: text } } : {}) } });
  }
  for (const step of result) plannedSteps.add(step);
  return result;
}

const generatedBatches = new WeakMap();
const plannedSteps = new WeakSet();
export function isPlannedProductBatchStep(step) { return Boolean(step && plannedSteps.has(step)); }
export function bindGeneratedProductBatch(first, generations) {
  const envelope = { ...first, replyResult: { ...first.replyResult } };
  generatedBatches.set(envelope.replyResult, generations);
  return envelope;
}
export function readGeneratedProductBatch(replyResult) { return generatedBatches.get(replyResult) || null; }

// A literal scope span is not a multilingual catalogue interpretation. Resolve
// each span with the existing authoritative router before executing its lookup.
export async function resolveProductBatchStepIntent(step, interpret) {
  if (!isPlannedProductBatchStep(step) || typeof interpret !== 'function') throw new Error('Untrusted product batch step');
  const state = step.searchIntent.productRequestState;
  const resolved = await interpret(step.userText, [{ senderType: 'character', productRequestState: state }]);
  if (!resolved || resolved.commerceRoute !== 'product_search' || resolved.primarySearchVerified !== true
    || !resolved.shouldLoadProductContext || resolved.replyBoundary?.salesAllowed !== true
    || resolved.nonShoppingReason || resolved.commerceClassificationFailure || resolved.scopeUnverified
    || resolved.businessInquiry || resolved.humanHandoff || resolved.checkoutIssue || resolved.promotionInquiry) {
    return { ...step.searchIntent, shouldLoadProductContext: false, cardAllowed: false, searchState: 'needs_clarification', scopeUnverified: true };
  }
  const selected = applyProductRequestScope({ ...resolved, productRequestState: state }, {
    confidence: 1, route: 'product_search', searchQuery: resolved.query,
    productRequest: { relation: 'multiple', action: 'select', items: [], selectedIndex: step.index, selectionEvidence: state.items[step.index].evidence },
  }, { userText: step.userText, recentMessages: [{ senderType: 'character', productRequestState: state }], siteId: state.siteId,
    characterId: state.characterId, buildIntent: buildProductSearchIntent, getClearedFields: extractRequirementClearFields });
  if (selected.scopeUnverified || selected.productScopePending) return selected;
  selected.productRequestState = { ...selected.productRequestState, selectionSource: 'batch' };
  // Scope reconstruction supplies ownership; it must not erase hard fields
  // independently interpreted by JEV from this same exact target span.
  const requirements = normalizeProductCandidateRequirements(resolved);
  for (const [key, value] of Object.entries(requirements)) {
    if (Array.isArray(value) ? value.length > 0 : value !== '' && value !== false) selected[key] = value;
  }
  if (resolved.productCandidateState) selected.productCandidateState = resolved.productCandidateState;
  return selected;
}

// Called only after releasing the caller-owned reply lock, including error paths.
export async function dispatchGuestBatchVoices(db, prepared, generateVoice) {
  if (!prepared?.message?.id || !prepared.guest?.chat_session_id || !prepared.guest?.id
    || !startedBatches.has(prepared) && prepared.duplicate !== true) return;
  const prefix = `guest-reply:${prepared.message.id}:batch-`;
  const [rows] = await db.execute('SELECT voice_asset_id FROM chat_messages WHERE session_id = ? AND guest_session_id = ? AND LEFT(source_ref, ?) = ? AND content_type = ? AND sender_type = ? ORDER BY display_order ASC LIMIT 4',
    [prepared.guest.chat_session_id, prepared.guest.id, prefix.length, prefix, 'text', 'character']);
  for (const row of rows) if (row.voice_asset_id) await generateVoice(row.voice_asset_id);
}
