import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {buildCommerceJevPacket,resolveJevCommerceDecision}=await import('../server/jev-commerce-decision-service.js');
const {normalizeCommerceDecision,normalizePolicyKnowledgeRequest}=await import('../server/product-intent-classifier-service.js');
const {resolveCommerceSearchIntent,resolveCommerceKnowledgeScope,applyCommerceQuestionPromptPolicy}=await import('../server/commerce-routing-service.js');
const primary={ok:true,confident:true,primaryIntent:'order_lookup',orderIntent:'lookup',orderRequestKind:'existing',productIntent:'none'};
async function routed(text,required,kind='business_question',extras={}) {
 const raw={route:'store_policy',topic:'delivery',knowledgeScope:'business',knowledgeQuery:text,confidence:.99,answerRequired:true,needsLiveProductData:false,
 replyBoundary:{salesAllowed:false,contactAllowed:true},knowledgeRequest:{kind,evidence:text},policyKnowledgeRequest:{required,evidence:text,query:required?text:''},...extras};
 const decision={...normalizeCommerceDecision(raw,{userText:text}),detectionSource:'jev'};
 return resolveCommerceSearchIntent({userText:text,enrichAllTurns:true,jevDecision:primary,classifyCommerce:async()=>decision});
}
for(const [text,required,kind] of [
 ['I have not received any update on my order',false,'unresolved_complaint'],
 ['Can you check where my order is now?',false,'business_question'],
 ['The order was paid on 10/25',false,'business_question'],
 ['Hi the paymentoptions are Not working',false,'unresolved_complaint'],
 ['Order 6857 is still being processed. When will it ship?',true,'business_question'],
 ['My order says delivered but did not arrive. How many days from ordering do I have to contact support?',true,'unresolved_complaint'],
 ['How long does processing take and what is the reporting deadline?',true,'store_policy_only'],
 ]) {
 const intent=await routed(text,required,kind);
 assert.equal(resolveCommerceKnowledgeScope(intent),required?'business':'none',text);
 assert.equal(intent.answerRequired,true);assert.equal(intent.policyKnowledgeRequest.required,required);
 assert.equal(intent.knowledgeScope,'business','no-policy keeps business source restrictions');
 assert.equal(intent.cardAllowed,false);assert.equal(intent.knowledgeQuery,required?text:'');
 assert.equal(intent.policyKnowledgeRequest.source,'jev');
 if(!required)assert(!applyCommerceQuestionPromptPolicy({},intent).systemPrompt.includes('solely a catalogue lookup'), 'no-policy order/payment must not receive catalogue guidance');
}
const text='Where is my order?';
assert.equal(normalizePolicyKnowledgeRequest({required:false,evidence:'my order',query:''},{userText:text}),null,'negative authority covers whole current turn');
assert.equal(normalizePolicyKnowledgeRequest({required:true,evidence:text,query:'invented rule'},{userText:text}),null);
assert.equal(normalizePolicyKnowledgeRequest({required:true,evidence:text,query:'assistant-only terms'},{userText:text,recentMessages:[{senderType:'character',text:'assistant-only terms'}]}),null);
assert.deepEqual(normalizePolicyKnowledgeRequest({required:true,evidence:'And that?',query:'How long is processing?'},{userText:'And that?',recentMessages:[{senderType:'user',text:'How long is processing?'}]}),{required:true,evidence:'And that?',query:'How long is processing?'});
// Legacy and the finite LLM fallback do not acquire JEV-only negative authority.
for (const source of [undefined,'openai']) {
 const text='I have not received an update';
 const decision={...normalizeCommerceDecision({route:'store_policy',topic:'delivery',confidence:.99,knowledgeScope:'business',answerRequired:true,replyBoundary:{salesAllowed:false,contactAllowed:true},policyKnowledgeRequest:{required:false,evidence:text,query:''}},{userText:text}),...(source?{detectionSource:source}:{})};
 const intent=await resolveCommerceSearchIntent({userText:text,enrichAllTurns:true,jevDecision:primary,classifyCommerce:async()=>decision});
 assert.equal(resolveCommerceKnowledgeScope(intent),'business');assert.equal(intent.policyKnowledgeRequest,undefined);
}
const chatText='hey';
const chat=await resolveCommerceSearchIntent({userText:chatText,enrichAllTurns:true,jevDecision:{ok:true,confident:true,primaryIntent:'daily_chat',orderIntent:'none'},classifyCommerce:async()=>({...normalizeCommerceDecision({route:'chat',confidence:.99,topic:'other',knowledgeScope:'general',answerRequired:false,replyBoundary:{salesAllowed:true,contactAllowed:true},knowledgeRequest:{kind:'conversation_only',evidence:chatText},policyKnowledgeRequest:{required:false,evidence:chatText,query:''}},{userText:chatText}),detectionSource:'jev'})});
assert.equal(resolveCommerceKnowledgeScope(chat),'none');assert.equal(chat.knowledgeScope,'general');
// New intent selections have no confidence threshold; evidence is a server-owned
// literal choice. All questions fit in the original one ordinary admission call.
const packet=buildCommerceJevPacket('How long is processing?');assert.equal(Object.keys(packet.questions).length,34);
assert(packet.questions.general_explanation_kind && packet.questions.general_explanation_evidence);
let calls=0;
const result=await resolveJevCommerceDecision('How long is processing?',{evaluate:async({questions})=>{calls++;const answers={};
for(const [key,q] of Object.entries(questions)){let choice=key==='route'?'store_policy':key==='knowledge_scope'?'business':key==='policy_required'?'yes':key==='policy_evidence'?'e0':key==='query_source'?'current':q.criteria.none?'none':q.criteria.no?'no':q.criteria.absent?'absent':Object.keys(q.criteria)[0];answers[key]={choice,confidence:.1};}
return {ok:true,answers};}});
assert.equal(calls,1);assert.equal(result.value.policyKnowledgeRequest.required,true);assert.equal(result.value.policyKnowledgeRequest.evidence,'How long is processing?');
console.log('Policy knowledge demand: independent JEV axis, whole-turn/source provenance, no added ordinary call, no confidence threshold, original order/deadline/mixed/no-policy cases passed');
