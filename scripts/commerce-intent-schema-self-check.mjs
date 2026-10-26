import { commerceClassificationTimeout } from '../server/product-intent-classifier-service.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { COMMERCE_INTENT_RESPONSE_FORMAT } from '../server/commerce-intent-response-format.js';
import { PRODUCT_REQUIREMENT_SCALAR_VALUES, PRODUCT_REQUIREMENT_ARRAY_VALUES, CHILD_PRODUCT_SIZE_LABELS } from '../server/product-requirement-fields.js';
import { normalizeChatProductRoutingContext } from '../server/chat-product-routing-context-service.js';
import { normalizeProductRequirementDecision } from '../server/product-candidate-state-service.js';
import { normalizeProductRequest } from '../server/product-request-scope-service.js';

// A small JSON Schema evaluator for the standard keywords this contract uses.
// Fixtures test emitted schemas independently from business normalization.
function valid(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(branch => valid(branch, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') return value != null && typeof value === 'object' && !Array.isArray(value)
    && schema.required.every(key => Object.hasOwn(value, key))
    && (schema.additionalProperties !== false || Object.keys(value).every(key => Object.hasOwn(schema.properties, key)))
    && Object.entries(schema.properties).every(([key, child]) => !Object.hasOwn(value, key) || valid(child, value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.length <= (schema.maxItems ?? Infinity) && value.every(item => valid(schema.items, item));
  if (schema.type === 'string') return typeof value === 'string' && value.length <= (schema.maxLength ?? Infinity)
    && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value)
    && (schema.type !== 'integer' || Number.isInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  throw new Error(`Unsupported schema keyword: ${JSON.stringify(schema)}`);
}
const schema = COMMERCE_INTENT_RESPONSE_FORMAT.json_schema.schema;
assert.equal(COMMERCE_INTENT_RESPONSE_FORMAT.type, 'json_schema');
assert.equal(COMMERCE_INTENT_RESPONSE_FORMAT.json_schema.strict, true);
const legacyFormat = structuredClone(COMMERCE_INTENT_RESPONSE_FORMAT);
delete legacyFormat.json_schema.schema.properties.referencedProductIds;
delete legacyFormat.json_schema.schema.properties.knowledgeRequest;
legacyFormat.json_schema.schema.required = legacyFormat.json_schema.schema.required.filter(key => key !== 'knowledgeRequest');
assert(schema.required.includes('knowledgeRequest'));
assert(valid(schema.properties.knowledgeRequest, null));
assert(valid(schema.properties.knowledgeRequest, { kind: 'catalogue_only', evidence: 'shirt' }));
assert(!valid(schema.properties.knowledgeRequest, { kind: 'invented', evidence: 'shirt' }));
legacyFormat.json_schema.schema.required = legacyFormat.json_schema.schema.required.filter(key => key !== 'referencedProductIds');
assert.deepEqual(schema.properties.referencedProductIds, { type:'array',items:{type:'string',maxLength:160},minItems:0,maxItems:2 });
assert(schema.required.includes('referencedProductIds'));
// Historical bare years intentionally extend just the season wire value.
// Restore that one prior pattern before checking the unchanged contract hash.
const keywordBranch = schema.properties.productRequirement.properties.updates.items.anyOf.find(branch => branch.properties.field.enum[0] === 'requestedKeywords');
assert.deepEqual(keywordBranch.properties.value, { type:'array', items:{type:'string',maxLength:80}, minItems:1,maxItems:8 });
legacyFormat.json_schema.schema.properties.productRequirement.properties.updates.items.anyOf = legacyFormat.json_schema.schema.properties.productRequirement.properties.updates.items.anyOf.filter(branch => branch.properties.field.enum[0] !== 'requestedKeywords');
const legacySeason=legacyFormat.json_schema.schema.properties.productRequirement.properties.updates.items.anyOf
  .find(branch=>branch.properties.field.enum[0]==='requestedSeason').properties.value;
assert.deepEqual(legacySeason,{type:'string',pattern:'^$|^[0-9]{4}(?:/[0-9]{2})?$',maxLength:7});
legacySeason.pattern='^$|^[0-9]{4}/[0-9]{2}$';
// Child labels extend only the finite sizing value; preserve the entire old contract.
const legacySizes = legacyFormat.json_schema.schema.properties.productRequirement.properties.updates.items.anyOf
  .find(branch => branch.properties.field.enum[0] === 'requestedSizes').properties.value.items.enum;
const originalSizeLabels = ['5XL','4XL','3XL','2XL','XXL','XL','XXS','XS','S','M','L'];
assert.deepEqual(legacySizes, [...originalSizeLabels, ...CHILD_PRODUCT_SIZE_LABELS]);
legacySizes.splice(0, legacySizes.length, ...originalSizeLabels);
assert.equal(createHash('sha256').update(JSON.stringify(legacyFormat)).digest('hex'),
  '813384b5c1520ce72cd1ca1cf3035edea5bc81b95d240c2fea2699bd303be20f',
  'Shared finite values must retain the complete pre-refactor wire contract');
const single = { relation: 'single', action: 'new', items: [], selectedIndex: null, selectionEvidence: '' };
const malformed = { ...single, items: [{ evidence: 'Real Madrid shirt', sharedEvidence: '' }] };
assert.equal(valid(schema.properties.productRequest, single), true);
assert.equal(valid(schema.properties.productRequest, { ...single, relation: 'unclear' }), true, 'Uncertain or over-limit current requests must be representable without truncation');
assert.equal(valid(schema.properties.productRequest, malformed), false);
assert.equal(normalizeProductRequest(malformed, { userText: 'Real Madrid shirt', confidence: 1 }).valid, false);
const multiple = { ...single, relation: 'multiple', items: [
  { evidence: 'Real Madrid shirt', sharedEvidence: '' }, { evidence: 'Barcelona shirt', sharedEvidence: '' },
] };
assert.equal(valid(schema.properties.productRequest, multiple), true);
assert.equal(valid(schema.properties.productRequest, { ...multiple, items: multiple.items.slice(0, 1) }), false);
assert.equal(valid(schema.properties.productRequest, { ...single, action: 'select', selectedIndex: 0 }), false);
assert.equal(valid(schema.properties.productRequest, { ...single, relation: 'multiple', action: 'select', selectedIndex: 0, selectionEvidence: 'first' }), true);
const updates = schema.properties.productRequirement.properties.updates;
for (const definition of [PRODUCT_REQUIREMENT_SCALAR_VALUES, PRODUCT_REQUIREMENT_ARRAY_VALUES]) {
  assert.equal(Object.isFrozen(definition), true);
  for (const [field, allowed] of Object.entries(definition)) {
    assert.equal(Object.isFrozen(allowed), true);
    const array = definition === PRODUCT_REQUIREMENT_ARRAY_VALUES;
    const branch = updates.items.anyOf.find(item => item.properties.field.enum[0] === field);
    assert.deepEqual(array ? branch.properties.value.items.enum : branch.properties.value.enum,
      array ? allowed : ['', ...allowed]);
    for (const value of allowed) {
      const typed = array ? [value] : value;
      const current = { field, value: typed, evidence: 'current' };
      assert.equal(valid(updates, [current]), true);
      assert.ok(normalizeProductRequirementDecision({ action: 'continue', evidence: 'current', updates: [current] }, { userText: 'current' }));
      assert.deepEqual(normalizeChatProductRoutingContext({ targetEvidence: 'current', requirements: { [field]: typed } }).requirements[field], typed);
    }
    const invalid = array ? ['invented'] : 'invented';
    assert.equal(valid(updates, [{ field, value: invalid, evidence: 'current' }]), false);
    assert.equal(normalizeProductRequirementDecision({ action: 'continue', evidence: 'current', updates: [{ field, value: invalid, evidence: 'current' }] }, { userText: 'current' }), null);
    assert.equal(normalizeChatProductRoutingContext({ targetEvidence: 'current', requirements: { [field]: invalid } }).requirements[field], undefined);
    const empty = array ? [] : '';
    assert.equal(valid(updates, [{ field, value: empty, evidence: 'current' }]), true);
    assert.ok(normalizeProductRequirementDecision({ action: 'continue', evidence: 'current', updates: [{ field, value: empty, evidence: 'current' }] }, { userText: 'current' }));
    assert.equal(normalizeChatProductRoutingContext({ targetEvidence: 'current', requirements: { [field]: empty } }).requirements[field], undefined,
      'Routing projection keeps its own rule to omit empty requirements');
  }
}
assert.equal(valid(updates, [{ field: 'requestedProductType', value: 'shirt', evidence: 'camiseta' }]), true);
assert.equal(valid(updates, [{ field: 'requestedProductType', value: 'Soccer Fun Jersey', evidence: 'Soccer Fun Jersey' }]), false);
assert.equal(normalizeProductRequirementDecision({ action: 'new', evidence: 'Soccer Fun Jersey', updates: [
  { field: 'requestedProductType', value: 'Soccer Fun Jersey', evidence: 'Soccer Fun Jersey' },
] }, { userText: 'Soccer Fun Jersey' }), null);
assert.equal(valid(updates, [{ field: 'requestedFeatures', value: ['short_sleeve'], evidence: 'manga corta' }]), true);
assert.equal(valid(updates, [{ field: 'requestedPrinting', value: 'none', evidence: 'sin nombre ni número' }]), true);
assert.equal(valid(updates, [{ field: 'requestedSeason', value: '2026/27', evidence: '2026/27' }]), true);
for(const value of ['', '2022', '2021/22']) assert.equal(valid(updates,[{field:'requestedSeason',value,evidence:'current'}]),true);
for(const value of ['202', '20222', '2022/2023', '2022/2', '2022junk']) assert.equal(valid(updates,[{field:'requestedSeason',value,evidence:'current'}]),false);
assert.equal(valid(updates, [{ field: 'requestedVariants', value: ['some jersey'], evidence: 'some jersey' }]), false);
for (const field of ['businessInquiry', 'humanHandoff', 'promotionInquiry', 'checkoutIssue', 'commerceConstraints', 'replyBoundary']) {
  assert.ok(schema.properties[field], `Existing commerce field retained: ${field}`);
}
assert.equal(valid(schema.properties.checkoutIssue, { active: true, evidence: 'payment failed', requestScope: 'checkout_only', stage: 'payment', stageEvidence: 'payment', errorEvidence: 'failed', failedAttempts: [], orderPlaced: false, orderEvidence: 'not placed', lookupRequested: false, lookupEvidence: 'payment failed' }), true);
assert.equal(valid(schema.properties.replyBoundary, { salesAllowed: true }), false);
console.log('commerce intent schema self-check passed: strict single/multiple shapes, canonical typed requirements, prior business/support contracts retained; no network/DB/model calls');

assert.equal(commerceClassificationTimeout('Real Madrid away jersey 2026/27'),40000);
assert.equal(commerceClassificationTimeout('Hello, how are you?'),10000);
assert.equal(commerceClassificationTimeout('What are your shipping and refund policies?'),10000);
