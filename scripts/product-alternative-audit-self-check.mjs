import assert from 'node:assert/strict';
import { PRODUCT_ALTERNATIVE_AUDIT_SCHEMA, PRODUCT_ALTERNATIVE_AUDIT_CONTRACT, validateProductAlternativeAudit } from '../server/product-alternative-service.js';
globalThis.fetch = async () => { throw new Error('Pure audit must not call providers'); };
const text = 'Lo siento. Esta búsqueda no encontró la original de 2022. La alternativa es 2024/25 en vez de 2022.';
const speechText = 'Sorry. This search did not find the original from 2022. The alternative is 2024/25 rather than 2022.';
const audit = { display: { apologyQuote: 'Lo siento.', originalSearchQuote: 'Esta búsqueda no encontró la original de 2022.', differenceQuote: 'La alternativa es 2024/25 en vez de 2022.' },
 speech: { apologyQuote: 'Sorry.', originalSearchQuote: 'This search did not find the original from 2022.', differenceQuote: 'The alternative is 2024/25 rather than 2022.' }, boundedSearchOnly: true };
const context = { requestedSeason: '2022', alternativeSeason: '2024/25' };
const run = value => validateProductAlternativeAudit(value, { text, speechText, context });
assert.deepEqual(run(audit), { valid: true, accepted: true });
for (const side of ['display', 'speech']) for (const field of ['apologyQuote', 'originalSearchQuote', 'differenceQuote']) {
 for (const quote of ['', '   ', 'Not actually in the output', 'a'.repeat(241)]) {
  assert.deepEqual(run({ ...audit, [side]: { ...audit[side], [field]: quote } }), { valid: true, accepted: false });
 }
 const missing = structuredClone(audit); delete missing[side][field]; assert.equal(run(missing).valid, false);
 assert.equal(run({ ...audit, [side]: { ...audit[side], [field]: null } }).valid, false);
}
assert.deepEqual(run({ ...audit, boundedSearchOnly: false }), { valid: true, accepted: false });
for (const malformed of [null, [], {}, { ...audit, display: [] }, { ...audit, boundedSearchOnly: 'true' }]) assert.equal(run(malformed).valid, false);
assert.deepEqual(run({ ...audit, speech: audit.display }), { valid: true, accepted: false }, 'quotes cannot be borrowed from the other output');
assert.deepEqual(validateProductAlternativeAudit(audit, { text: text + ' Extra', speechText, context }), { valid: true, accepted: true });
assert.equal(PRODUCT_ALTERNATIVE_AUDIT_SCHEMA.additionalProperties, false);
assert.match(PRODUCT_ALTERNATIVE_AUDIT_CONTRACT, /greetings, no-result statements.*not apologies/);
assert.match(PRODUCT_ALTERNATIVE_AUDIT_CONTRACT, /different verified catalogue year\/season/);
console.log('Product alternative quote audit: both outputs, structural vs semantic refusal, exact bounded quotes and source limitation passed (pure, no DB/network/model).');

for (const separator of ['/', '-', '–', '—']) for (const end of ['25', '2025']) {
 const quote = 'Alternative 2024' + separator + end;
 const changed = { ...audit, display: { ...audit.display, differenceQuote: quote } };
 assert.equal(validateProductAlternativeAudit(changed, { text: text + quote, speechText, context }).accepted, true);
}
assert.equal(validateProductAlternativeAudit(audit, { text, speechText, context: { ...context, alternativeSeason: '2023/24' } }).accepted, false);
assert.equal(validateProductAlternativeAudit(audit, { text, speechText, context: { ...context, requestedSeason: '2022/23' } }).accepted, false);
assert.equal(validateProductAlternativeAudit(audit, { text, speechText }).accepted, false);
