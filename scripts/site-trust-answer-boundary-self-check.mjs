import assert from 'node:assert/strict';
import { needsBusinessFactsReview } from '../server/chat-reply-boundary-service.js';
import { buildReplyReviewMessages } from '../server/chat-reply-review-contracts.js';
import { applyCommerceQuestionPromptPolicy } from '../server/commerce-routing-service.js';
const intent={siteTrustOnly:true,commerceRoute:'chat',knowledgeScope:'general',answerRequired:true};
const character={id:'mascot_test',categoryId:'mascot'};
assert.equal(needsBusinessFactsReview(intent,character),true);
const prompt=applyCommerceQuestionPromptPolicy({systemPrompt:'base'},intent).systemPrompt;
assert.match(prompt,/payment protection depends on/); assert.match(prompt,/do not suggest placing an order/);
assert.match(prompt,/chat being accessible/); assert.match(prompt,/current verified store-specific evidence/);
const systems=opts=>buildReplyReviewMessages(opts).filter(x=>x.role==='system').map(x=>x.content).join('\n');
const review=systems({searchIntent:intent,businessFactsRequired:true});
assert.match(review,/payment protection depends on/); assert.match(review,/do not suggest placing an order/);
assert.match(review,/AI chat, platform, role or character is not evidence/);
assert.match(review,/Verified current store-specific evidence/);
assert.match(review,/ordinary AI identity or product authenticity/);
for(const other of [{...intent,siteTrustOnly:false},{commerceRoute:'chat',answerRequired:false},{commerceRoute:'product_question',answerRequired:true},{commerceRoute:'order_lookup',answerRequired:true}]) {
 const r=systems({searchIntent:other,businessFactsRequired:true});assert.doesNotMatch(r,/AI chat, platform, role or character is not evidence/);
}
assert.equal(needsBusinessFactsReview(intent,{id:'ordinary',categoryId:'chat'}),false);
console.log('Site trust prompt and factual review scoping passed; no model/DB');
