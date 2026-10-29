// Caller-local structured output. Other JSON tasks and JEV retain their own
// contracts, permissions, time budgets and provider fallback behavior.
import { PRODUCT_REQUIREMENT_SCALAR_VALUES, PRODUCT_REQUIREMENT_ARRAY_VALUES } from './product-requirement-fields.js';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = (maxLength = 240) => ({ type: 'string', maxLength });
const values = enumValues => ({ type: 'string', enum: enumValues });
const bool = { type: 'boolean' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const list = (items, minItems = 0, maxItems = 8) => ({ type: 'array', items, minItems, maxItems });
const index = { type: 'integer', minimum: 0, maximum: 3 };
const noItems = list(object({ evidence: text(), sharedEvidence: text() }), 0, 0);
const productRequest = {
  anyOf: [
    object({ relation: values(['single', 'alternative', 'comparison', 'none', 'unclear']), action: values(['new']), items: noItems, selectedIndex: { type: 'null' }, selectionEvidence: text() }),
    object({ relation: values(['multiple']), action: values(['new']), items: list(object({ evidence: text(), sharedEvidence: text() }), 2, 4), selectedIndex: { type: 'null' }, selectionEvidence: text() }),
    object({ relation: values(['multiple']), action: values(['select']), items: noItems, selectedIndex: index, selectionEvidence: text() }),
    object({ relation: values(['multiple']), action: values(['continue']), items: noItems, selectedIndex: nullable(index), selectionEvidence: text() }),
    object({ relation: values(['single', 'multiple', 'alternative', 'comparison', 'none', 'unclear']), action: values(['suspend', 'cancel']), items: noItems, selectedIndex: { type: 'null' }, selectionEvidence: text() }),
  ],
};
const scalarUpdate = (field, value) => object({ field: values([field]), value, evidence: text() });
const update = { anyOf: [
  scalarUpdate('requestedTeam', text(120)),
  scalarUpdate('requestedProductType', values(['', ...PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedProductType])),
  scalarUpdate('requestedAudience', values(['', ...PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedAudience])),
  scalarUpdate('requestedColor', values(['', ...PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedColor])),
  scalarUpdate('requestedSeason', { type: 'string', pattern: '^$|^[0-9]{4}(?:/[0-9]{2})?$', maxLength: 7 }),
  scalarUpdate('requestedEdition', values(['', ...PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedEdition])),
  scalarUpdate('requestedPrinting', values(['', ...PRODUCT_REQUIREMENT_SCALAR_VALUES.requestedPrinting])),
  scalarUpdate('requestedFeatures', list(values(PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedFeatures))),
  scalarUpdate('requestedVariants', list(values(PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedVariants))),
  scalarUpdate('requestedSizes', list(values(PRODUCT_REQUIREMENT_ARRAY_VALUES.requestedSizes))),
  object({ field: values(['requestedKeywords']), value: list(text(80), 1), evidence: text(), identityType: values(['player', 'team', 'unknown']) }),
] };

export const COMMERCE_INTENT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'commerce_intent', strict: true, schema: object({
    route: values(['product_search', 'product_question', 'store_policy', 'chat']),
    topic: values(['authenticity', 'delivery', 'returns', 'support', 'material', 'sizing', 'price', 'stock', 'other']),
    needsLiveProductData: bool, searchQuery: text(160), referencedProductId: text(160), referencedProductIds: list(text(160), 0, 2),
    knowledgeScope: values(['business', 'general']), knowledgeQuery: text(), answerRequired: bool,
    knowledgeRequest: nullable(object({ kind: values(['catalogue_only', 'business_question', 'sizing_update', 'general_explanation', 'store_policy_only', 'order_and_policy', 'concept_and_policy', 'unclear']), evidence: text() })),
    businessInquiry: nullable(object({ kind: values(['quotation', 'wholesale', 'dropshipping', 'distribution', 'sponsorship', 'partnership', 'business_other']), evidence: text(500) })),
    humanHandoff: nullable(object({ explicitRequest: bool, businessReviewRequired: bool, reviewReason: values(['quotation', 'negotiation', 'contract', 'commercial_terms', 'none']), evidence: text(500) })),
    promotionInquiry: nullable(object({ kind: values(['policy', 'benefit_request']), evidence: text(500) })),
    checkoutIssue: nullable(object({ active: { type: 'boolean', enum: [true] }, evidence: text(160),
      requestScope: values(['checkout_only', 'mixed', 'unknown']), stage: values(['unknown', 'address', 'shipping', 'payment', 'submission']),
      stageEvidence: text(160), errorEvidence: text(160), failedAttempts: list(text(160), 0, 3),
      orderPlaced: nullable(bool), orderEvidence: text(160), lookupRequested: nullable(bool), lookupEvidence: text(160) })),
    replyBoundary: object({ salesAllowed: bool, contactAllowed: bool }),
    commerceConstraints: object({ edition: nullable(object({ value: values(['player', 'fan']), evidence: text() })),
      team: nullable(object({ value: text(120), role: values(['product_target', 'location', 'other']), evidence: text() })) }),
    productRequest,
    productRequirement: object({ action: values(['new', 'continue', 'cancel', 'none']), evidence: text(), priorTargetEvidence: text(1200),
      updates: list(update, 0, 12), suspectedTerm: nullable(object({ value: text(80), evidence: text() })) }),
    candidateResponse: object({ action: values(['confirm', 'reject', 'none']), evidence: text(), candidateId: text(160) }),
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  }) },
};

// Some providers represent unused string slots as explicit null. Normalize
// only a positively inactive action; missing keys, active evidence and all
// other fields still pass through the unchanged strict schema/evidence checks.
export function normalizeInactiveCommerceFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  let result = value;
  const candidate = value.candidateResponse;
  if (candidate && !Array.isArray(candidate) && typeof candidate === 'object' && candidate.action === 'none') {
    const empty = Object.fromEntries(['evidence', 'candidateId'].filter(key => candidate[key] === null).map(key => [key, '']));
    if (Object.keys(empty).length) result = { ...result, candidateResponse: { ...candidate, ...empty } };
  }
  const handoff = value.humanHandoff;
  if (handoff && !Array.isArray(handoff) && typeof handoff === 'object'
    && handoff.explicitRequest === false && handoff.businessReviewRequired === false && handoff.evidence === null) {
    result = { ...result, humanHandoff: { ...handoff, evidence: '' } };
  }
  return result;
}

// The same strict contract is checked locally for routed candidate tasks.
// Native decoding is not an authorization or a substitute
// for validating the complete returned object before semantic interpretation.
export function validateCommerceIntentShape(value, schema = COMMERCE_INTENT_RESPONSE_FORMAT.json_schema.schema) {
  value = normalizeInactiveCommerceFields(value);
  const matches = (schema, input) => {
    if (schema.anyOf) return schema.anyOf.some(branch => matches(branch, input));
    if (schema.enum && !schema.enum.includes(input)) return false;
    if (schema.type === 'null') return input === null;
    if (schema.type === 'object') return input != null && typeof input === 'object' && !Array.isArray(input)
      && schema.required.every(key => Object.hasOwn(input, key))
      && Object.keys(input).every(key => Object.hasOwn(schema.properties, key))
      && Object.entries(schema.properties).every(([key, child]) => matches(child, input[key]));
    if (schema.type === 'array') return Array.isArray(input) && input.length >= (schema.minItems ?? 0)
      && input.length <= (schema.maxItems ?? Infinity) && input.every(item => matches(schema.items, item));
    if (schema.type === 'string') return typeof input === 'string' && Array.from(input).length <= (schema.maxLength ?? Infinity)
      && (!schema.pattern || new RegExp(schema.pattern).test(input));
    if (schema.type === 'boolean') return typeof input === 'boolean';
    return typeof input === 'number' && Number.isFinite(input) && (schema.type !== 'integer' || Number.isInteger(input))
      && input >= (schema.minimum ?? -Infinity) && input <= (schema.maximum ?? Infinity);
  };
  const withKnowledgeRequest = value && typeof value === 'object' && !Array.isArray(value) && !Object.hasOwn(value, 'knowledgeRequest')
    ? { ...value, knowledgeRequest: null } : value;
  const compatible = withKnowledgeRequest && typeof withKnowledgeRequest === 'object' && !Array.isArray(withKnowledgeRequest) && !Object.hasOwn(withKnowledgeRequest, 'referencedProductIds')
    ? { ...withKnowledgeRequest, referencedProductIds: [] } : withKnowledgeRequest;
  const nameCompatible = compatible?.productRequirement && Array.isArray(compatible.productRequirement.updates)
    ? { ...compatible, productRequirement: { ...compatible.productRequirement, updates: compatible.productRequirement.updates.map(update =>
      update?.field === 'requestedKeywords' && !Object.hasOwn(update, 'identityType') ? { ...update, identityType: 'unknown' } : update) } } : compatible;
  return matches(schema, nameCompatible);
}
