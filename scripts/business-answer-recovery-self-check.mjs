import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { isGroundedCommerceRepairEligible, repairGroundedCommerceReply } = await import('../server/chat-grounded-reply-repair-service.js');
const { shouldRecheckBusinessKnowledge } = await import('../server/business-knowledge-selection-service.js');
const quote = 'Standard shipping usually takes 15–30 days; this varies by destination.';
const base = { character: { id: 'guide', category_id: 'mascot', site_id: 'shop' }, trustedSite: { id: 'shop' }, userText: 'And if I order from my city?',
 searchIntent: { commerceRoute: 'product_question', commerceTopic: 'delivery', knowledgeScope: 'business', customerServiceKnowledgeRequest: true, answerRequired: true, shouldLoadProductContext: false, cardAllowed: false },
 knowledgeContext: { ok: true, strategy: 'business_verified_reference', businessOwner: { siteId: 'shop', characterId: 'guide' }, items: [{ id: 'p', category: 'customer_service', content: quote, evidenceQuote: quote }] },
 replyResult: { text: 'It always arrives in one day.', sourceType: 'ai' }, reviewStatus: 'valid', reviewResult: { allowed: false, confidence: .9, boundarySupported: true, businessFactsSupported: false }, failedContracts: ['business_facts'] };
for (const route of ['product_question', 'store_policy', 'chat']) {
 const input = structuredClone(base); input.searchIntent.commerceRoute = route;
 assert(shouldRecheckBusinessKnowledge(input.searchIntent));
 assert(isGroundedCommerceRepairEligible(input), `${route} verified business evidence supports one correction`);
 const empty = { ...input, knowledgeContext: { ...input.knowledgeContext, strategy: 'business_no_verified_answer', items: [] } };
 assert(isGroundedCommerceRepairEligible(empty), `${route} empty owned evidence permits limitation wording`);
 assert(!isGroundedCommerceRepairEligible({ ...empty, groundedRepairAttempted: true }));
 assert(!isGroundedCommerceRepairEligible({ ...input, knowledgeContext: { ...input.knowledgeContext, businessOwner: { siteId: 'other', characterId: 'guide' } } }));
 assert(!isGroundedCommerceRepairEligible({ ...input, searchIntent: { ...input.searchIntent, commerceClassificationUnavailable: true } }));
}
for (const patch of [{answerRequired:false},{knowledgeScope:'general'},{businessKnowledgeRequired:false},{commerceClassificationUnavailable:true}]) assert(!shouldRecheckBusinessKnowledge({...base.searchIntent,...patch}));
let packet, correctionPrompt;
await repairGroundedCommerceReply({ ...base, language:'en', recentMessages:[{senderType:'user',text:'How long is standard shipping?'}], repairFeedback:{reviewStatus:'valid',failedContracts:['business_facts'],issues:[{type:'business_facts',span:'one day',reason:'not in the supplied source'}]}, config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'}, requestText:async request=>{correctionPrompt=request.systemPrompt;packet=JSON.parse(request.messages[0].content);return JSON.stringify({displayText:'Standard shipping is usually 15–30 days; no city-specific estimate is confirmed.'});},recordLog:async()=>{} });
assert(packet); assert(packet.proposedResponse.includes('one day')); assert(packet.reviewFeedback.issues.length); assert(packet.recentUserMessages.length); assert.equal(packet.knowledge[0].evidenceQuote,quote);
console.log('business answer recovery: route-independent owned evidence, bounded correction, failed-draft feedback and source boundaries passed');

const { BUSINESS_SOURCE_MODALITY_CONTRACT } = await import('../server/business-claim-audit-service.js');
const { buildKnowledgeContextLayer } = await import('../server/chat-prompt-layers.js');
const layer = buildKnowledgeContextLayer({...base.knowledgeContext, customerServiceIntent:true});
assert(layer.content.includes(BUSINESS_SOURCE_MODALITY_CONTRACT), 'initial generation retains source modality');
assert(correctionPrompt.includes(BUSINESS_SOURCE_MODALITY_CONTRACT), 'correction receives the same source modality rule');
assert(!buildKnowledgeContextLayer({items:[{id:'general',title:'Football',content:'A ball is round.'}]}).content.includes(BUSINESS_SOURCE_MODALITY_CONTRACT), 'unrelated general knowledge is unchanged');
console.log('source modality contract reaches business generation and correction, not unrelated general knowledge');

const emptyDirectory = { ...base, searchIntent:{...base.searchIntent,commerceRoute:'chat'}, knowledgeContext:{...base.knowledgeContext,strategy:'business_no_relevant_section',items:[],selectionDiagnostics:{stage:'directory',outcome:'empty',counts:{selected:0}}}};
assert(isGroundedCommerceRepairEligible(emptyDirectory), 'successful empty directory permits a natural limitation just like empty selected evidence');
for(const diagnostics of [null,{stage:'directory',outcome:'unavailable',counts:{selected:0}},{stage:'evidence',outcome:'empty',counts:{selected:0}},{stage:'directory',outcome:'empty',counts:{selected:1}}]) assert(!isGroundedCommerceRepairEligible({...emptyDirectory,knowledgeContext:{...emptyDirectory.knowledgeContext,selectionDiagnostics:diagnostics}}));
console.log('empty directory recovery requires successful precise diagnostics, not an unavailable lookup');

assert.match(BUSINESS_SOURCE_MODALITY_CONTRACT,/broad service description does not establish coverage/);
assert.match(correctionPrompt,/specific destination, customer group or item/);
assert.match(layer.content,/do not first say it should or probably applies and then append a disclaimer/);
console.log('broad-to-specific service claims retain missing-scope limits in both generation paths');
