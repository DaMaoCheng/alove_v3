import assert from 'node:assert/strict';
import { buildChatImageGenerationContext, buildChatImagePromptContextPayload } from '../server/chat-image-context-builder.js';
import { collectChatImageReferenceImages } from '../server/chat-image-reference-material-service.js';

// In-memory DB responses exercise actual context code; no DB writes or providers.
const historicalProduct = { id: 'old-shirt', name: 'Old team shirt', imageUrl: '/assets/jersey_product.png' };
const selectedProduct = { id: 'new-shirt', siteId: 'site-pro', name: 'Selected Real Madrid Away Fan Jersey', imageUrl: '/assets/jersey_product.png' };
const db = { async execute(sql) {
  if (sql.includes('FROM chat_image_assets')) return [[{ session_id: 'session', character_id: 'alba', site_id: 'site-pro', name: 'Alba', avatar_url: '/assets/char_fan.png' }]];
  if (sql.includes('SELECT display_order')) return [[{ display_order: 40 }]];
  return [[
    { sender_type: 'character', content_type: 'product', product_payload_json: JSON.stringify(historicalProduct), display_order: 10 },
    { sender_type: 'user', content_type: 'text', text_content: 'Póntela, por favor.', display_order: 30 },
  ]];
} };
const options = { assetId: 'asset', messageId: 'image-message', productReferenceRequired: true, requiredProductReference: selectedProduct, imageConditions: { wants_clothing: true, wants_no_clothing: false } };
const context = await buildChatImageGenerationContext(db, options);
assert.equal(context.latestProduct.id, selectedProduct.id, 'worker must bind the queued product snapshot, never the historical card');
assert.equal(context.latestProduct.name, selectedProduct.name);
assert.equal(context.imageRequestConstraints.usesProductReference, true, 'required product reference must not depend on language keyword matching');
assert.equal(context.imageRequestConstraints.productReferenceRequired, true);
assert.equal(buildChatImagePromptContextPayload(context).latestProduct.id, selectedProduct.id, 'audit payload must identify the same product used to generate');
for (const requiredProductReference of [null, {}, { id: 'new-shirt', name: 'Missing image' }, { imageUrl: '/assets/jersey_product.png' }, { ...selectedProduct, siteId: 'other-site' }, { ...selectedProduct, siteId: null }, { ...selectedProduct, siteId: '' }]) {
  await assert.rejects(() => buildChatImageGenerationContext(db, { ...options, requiredProductReference }), /required product reference/i, 'missing/foreign product reference must not use the old shirt');
}
for (const productSiteId of ['site-pro', null]) {
  const unscopedDb = { async execute(sql) {
    const result = await db.execute(sql);
    if (sql.includes('FROM chat_image_assets')) result[0][0].site_id = null;
    return result;
  } };
  await assert.rejects(() => buildChatImageGenerationContext(unscopedDb, { ...options, requiredProductReference: { ...selectedProduct, siteId: productSiteId } }), /required product reference/i, 'missing character site cannot approve a required product, including when both sites are absent');
}
await assert.rejects(() => buildChatImageGenerationContext(db, { ...options, imageConditions: { wants_no_clothing: true, wants_clothing: false } }), /required product reference/i, 'contradictory typed intent must fail closed');
const loaded = await collectChatImageReferenceImages(context);
assert.deepEqual(loaded.map(item => item.kind), ['character', 'product']);
await assert.rejects(() => collectChatImageReferenceImages({ ...context, latestProduct: { ...context.latestProduct, imageUrl: '/assets/nonexistent-product-required.png', imageUrls: [] } }), /required product reference/i, 'avatar loading successfully must not hide required product load failure');
await assert.rejects(() => collectChatImageReferenceImages({ ...context, latestProduct: null }), /required product reference/i);
const sameUrl = await collectChatImageReferenceImages({ ...context, latestProduct: { ...context.latestProduct, imageUrl: context.character.avatarUrl, imageUrls: [] } });
assert.ok(sameUrl.some(item => item.kind === 'product'), 'URL deduplication must not erase required product identity');
const ordinary = await buildChatImageGenerationContext(db, { assetId: 'asset', messageId: 'image-message', imageConditions: { wants_no_clothing: false, wants_clothing: false } });
assert.equal(ordinary.latestProduct, undefined, 'ordinary portrait must not inherit historical product');
assert.deepEqual((await collectChatImageReferenceImages(ordinary)).map(item => item.kind), ['character']);
console.log('chat image required product reference self-check passed');
