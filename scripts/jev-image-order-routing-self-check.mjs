import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
process.env.VENICE_API_KEY='fixture-routing-key';
process.env.VENICE_BASE_URL='https://fixture.invalid/v1';
process.env.VENICE_MODEL='fixture';
process.env.TYPESAFE_API_KEY='';
let calls=0;
globalThis.fetch=async(_url,options)=>{
 calls++;
 const body=JSON.parse(options.body),order=body.messages[0].content.includes('orderLookup');
 const content=order?{orderLookup:true,referenceKind:'existing_order',requestEvidence:'my order'}:{isProductRequest:true,confidence:.99};
 return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{headers:{'content-type':'application/json'}});
};
const {classifyChatImageIntent}=await import('../server/chat-image-intent-classifier-service.js');
const {classifyJevImageDetails}=await import('../server/jev-image-decision-service.js');
const {classifyOrderLookup,resolveTtmallOrderAction}=await import('../server/chat-order-intent-service.js');
const {classifyProductIntent}=await import('../server/product-intent-classifier-service.js');
const image={ok:true,confident:true,confidence:.99,primaryIntent:'character_photo',imageIntent:'library_photo',imageConditions:{wants_clothing:false,wants_no_clothing:false}};
let facets=0;
for(const decision of [{...image,confident:false,confidence:.4},{...image,primaryIntent:'product_request',imageIntent:'none'}]){
 const r=await classifyChatImageIntent('Show me a shirt',{character:{category_id:'mascot'},jevDecision:decision,classifyImageJev:async()=>{facets++;throw Error('Unexpected facet')}});
 assert.equal(r.hasIntent,false);assert.equal(calls,0);
}
assert.equal(facets,0);
const text='Mándame una foto de ti';
const evaluateFixture=async({questions,state})=>{
 assert.equal(state.message,text);
 if (questions.actor_is_character) return {ok:true,answers:{actor_is_character:{noul:.99},current_visual_action:{noul:.99}},llmFallbackAllowed:false};
 assert(questions.actor_evidence.criteria);
 const actor=Object.keys(questions.actor_evidence.criteria).find(key=>questions.actor_evidence.criteria[key]==='ti');assert(actor);
 const action=Object.keys(questions.action_evidence.criteria).find(key=>questions.action_evidence.criteria[key]===text);
 const values={action_evidence:action,image_intent:'library_photo',image_action:'request_visual_output',image_kind:'character_image',image_subject:'character',image_scope:'image_only',clothing_target:'none',actor_evidence:actor};
 return {ok:true,answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>[key,q.type==='choice'?{choice:values[key],confidence:.99}:{noul:0}])),llmFallbackAllowed:false};
};
const detailed=await classifyJevImageDetails(text,{character:{name:'Alba'},evaluate:evaluateFixture});
const output=await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:image,classifyImageJev:async()=>detailed});
assert.equal(output.allowed,true);assert.equal(output.detectionSource,'jev');assert.equal(output.requestScope,'image_only');assert.equal(calls,0);
const entropy=await classifyJevImageDetails(text,{evaluate:async request=>{
 const result=await evaluateFixture(request);
 if(request.questions.actor_evidence) {
  result.answers.actor_evidence.confidence=.32;result.answers.action_evidence.confidence=.24;
  result.answers.image_scope.confidence=.4;result.answers.clothing_target.confidence=.01;
 }
 return result;
}});
const entropyOutput=await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:image,classifyImageJev:async()=>entropy});
assert.equal(entropyOutput.allowed,true,'overlapping evidence choices do not measure semantic action confidence; focused verification still gates it');
assert.equal(entropyOutput.requestScope,'unknown','uncertain mixed-scope annotation cannot erase an additional question');
const unverified=await classifyJevImageDetails(text,{evaluate:async request=>{
 const result=await evaluateFixture(request);if(request.questions.actor_is_character) result.answers.actor_is_character.noul=.69;return result;
}});
const unverifiedOutput=await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:image,classifyImageJev:async()=>unverified});
assert.equal(unverifiedOutput.allowed,false,'uncertain focused actor verification never permits an image');assert.equal(calls,0,'valid uncertain JEV proof never triggers LLM classification');
const uncertain=await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:image,classifyImageJev:async()=>({...detailed,parsed:{...detailed.parsed,confidence:.4}})});
assert.equal(uncertain.allowed,false);assert.equal(calls,0);
for(const decision of [{ok:true,confident:false,orderIntent:'lookup'}, {ok:true,confident:true,orderIntent:'none'}, {ok:false,llmFallbackAllowed:false}]){
 assert.equal(await classifyOrderLookup('my order',{classifyJev:async()=>decision}),false);assert.equal(calls,0);
 const p=await classifyProductIntent('show me a shirt',{classifyJev:async()=>({...decision,productIntent:'search',productAction:1})});
 assert.equal(p.isProductRequest,decision.ok===true&&decision.confident===true);assert.equal(calls,0);
}
const exhausted={ok:false,llmFallbackAllowed:true,attempts:2,exhausted:true};
assert.equal(await classifyOrderLookup('my order',{classifyJev:async()=>exhausted}),true);assert.equal(calls,1);
assert.equal((await classifyProductIntent('show me a shirt',{classifyJev:async()=>exhausted})).isProductRequest,true);assert.equal(calls,2);
let unexpectedPrimaryCalls=0;
const sharedOrder={ok:true,confident:true,orderIntent:'lookup',unsupported:true,unsupportedIntent:'order_lookup'};
const reuse={text:'my order',siteSlug:'fixture',jevDecision:sharedOrder,
 classifyJev:async()=>{unexpectedPrimaryCalls++;throw Error('Shared decision must be reused');},
 dependencies:{resolveSiteAccess:async()=>({mode:'ttmall',source:{}})}};
assert.equal((await resolveTtmallOrderAction(reuse)).kind,'ttmall_order_lookup');
assert.equal(unexpectedPrimaryCalls,0);
assert.equal(await resolveTtmallOrderAction({...reuse,dependencies:{resolveSiteAccess:async()=>({mode:'not_ttmall',source:null})}}),null);
assert.equal(unexpectedPrimaryCalls,0,'A valid JEV decision cannot grant unsupported site capabilities');
const beforeSharedFallback=calls;
await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:{...image,
 routingSource:'llm_fallback',llmFallbackAllowed:true,jevFailure:{attempts:2}},
 classifyImageJev:async()=>{throw Error('Exhausted primary must not start a new JEV domain attempt');}});
assert.equal(calls,beforeSharedFallback+1,'The original detailed image classifier is permitted only by actual exhausted JEV lineage');
console.log('JEV image/order/legacy routing passed: valid and uncertain JEV never call LLM; bounded exhausted failure alone permits fallback; grounded image facet source mapping, no DB/network writes');
