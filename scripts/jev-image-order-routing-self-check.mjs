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
for(const decision of [{...image,primaryIntent:'unclear',imageIntent:'none'},{...image,primaryIntent:'product_request',imageIntent:'none'}]){
 const r=await classifyChatImageIntent('Show me a shirt',{character:{category_id:'mascot'},jevDecision:decision,classifyImageJev:async()=>{facets++;throw Error('Unexpected facet')}});
 assert.equal(r.hasIntent,false);assert.equal(calls,0);
}
assert.equal(facets,0);
const text='Mándame una foto de ti';
const evaluateFixture=async({questions,state})=>{
 assert.equal(state.message,text);assert(!questions.image_action&&!questions.image_intent&&!questions.image_subject,'detail request selects type, not intent or subject');
 const actor=Object.keys(questions.actor_evidence.criteria).find(key=>questions.actor_evidence.criteria[key]==='ti');assert(actor);
 const action=Object.keys(questions.action_evidence.criteria).find(key=>questions.action_evidence.criteria[key]===text);assert(action);
 const values={actor_evidence:actor,action_evidence:action,image_type:'library_photo',image_scope:'image_only',clothing_target:'none'};
 return {ok:true,answers:Object.fromEntries(Object.keys(questions).map(key=>[key,{choice:values[key],confidence:.01}]))};
};
const detailed=await classifyJevImageDetails(text,{character:{name:'Alba'},primaryDecision:image,evaluate:evaluateFixture});
const output=await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:image,classifyImageJev:async()=>detailed});
assert.equal(output.allowed,true,'detail confidence does not reject primary image intent');assert.equal(output.detectionSource,'jev');assert.equal(output.requestScope,'image_only');assert.equal(calls,0);
const bad={...detailed,parsed:{...detailed.parsed,actorEvidence:''}};
const unverified=await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:image,classifyImageJev:async()=>bad});
assert.equal(unverified.allowed,false,'missing grounded actor never permits image');assert.equal(calls,0);
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
await classifyChatImageIntent(text,{character:{category_id:'mascot'},jevDecision:{...image,routingSource:'llm_fallback',llmFallbackAllowed:true,jevFailure:{attempts:2}},classifyImageJev:async()=>{throw Error('Unexpected JEV')}});
assert.equal(calls,beforeSharedFallback+1,'only exhausted JEV lineage permits LLM image fallback');
console.log('JEV image/order routing passed: primary intent authoritative, detail type selection and bounded fallback');
