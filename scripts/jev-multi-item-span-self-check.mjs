import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
const {resolveJevCommerceDecision,buildCommerceJevPacket}=await import('../server/jev-commerce-decision-service.js');
const {normalizeCommerceDecision}=await import('../server/product-intent-classifier-service.js');
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const text='Find a long sleeve Manchester City football shirt from 2008 and a Xolos Gilberto Mora shirt for children';
const first='a long sleeve Manchester City football shirt from 2008',second='a Xolos Gilberto Mora shirt for children';
let packet, calls=0;
const values={route:'product_search',topic:'other',knowledge_scope:'business',knowledge_kind:'catalogue_only',request_relation:'multiple',request_action:'new',requirement_action:'none',item_count:'two',team:'t0',team_role:'product_target'};
const evaluate=async({questions,state})=>{calls++;packet=state;return{ok:true,answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>{
 let choice=values[key]|| (q.criteria.none?'none':q.criteria.absent?'absent':q.criteria.no?'no':Object.keys(q.criteria)[0]);
 if(['sales_allowed','contact_allowed','live_required','answer_required'].includes(key))choice='yes';
 const endpoint=/^item_([01])_(start|end)$/.exec(key);
 if(endpoint){const value=endpoint[1]==='0'?first:second;const offset=endpoint[2]==='start'?text.indexOf(value):text.indexOf(value)+value.length;
 choice=Object.entries(q.criteria).find(([,v])=>{try{const t=JSON.parse(v);return t[endpoint[2]]===offset;}catch{return false;}})?.[0];assert(choice,'full target endpoints are available');}
 if(key==='team_evidence')choice=Object.entries(q.criteria).find(([,v])=>v===JSON.stringify('Manchester City'))?.[0]||'none';
 if(key.startsWith('shared_'))choice='none';
 return[key,{choice,confidence:.3}];}))};};
const result=await resolveJevCommerceDecision(text,{siteId:'s',characterId:'c',evaluate});assert(result.ok);
assert.deepEqual(result.value.productRequest.items.map(x=>x.evidence),[first,second],'long complete targets remain representable and do not become unclear');
const normalized=normalizeCommerceDecision(result.value,{userText:text});
const intent=await resolveCommerceSearchIntent({userText:text,searchIntent:buildProductSearchIntent(text),siteId:'s',characterId:'c',enrichAllTurns:true,jevDecision:{ok:true,confident:true,primaryIntent:'product_request',productIntent:'search'},classifyCommerce:async()=>({...normalized,detectionSource:'jev'})});
assert.equal(intent.productRequestState?.status,'pending');assert.equal(intent.productRequestState.items.length,2);assert.equal(intent.cardAllowed,false);assert.equal(intent.shouldLoadProductContext,false);
assert(!intent.productRequestState.items[0].text.includes('children'),'second-only condition cannot leak into first item');
for (const patch of [
 {item_0_start:'none'}, {item_0_end:'t999'}, {item_1_start:'t0'},
]) {
 const broken=await resolveJevCommerceDecision(text,{evaluate:async request=>{const result=await evaluate(request);for(const[k,v]of Object.entries(patch))if(result.answers[k])result.answers[k].choice=v;return result;}});
 assert.equal(broken.value.productRequest.relation,'unclear','Absent, foreign or overlapping item boundaries fail closed');
}
const shared=await resolveJevCommerceDecision(text,{evaluate:async request=>{const result=await evaluate(request);for(const k of ['shared_0_start','shared_1_start'])if(result.answers[k])result.answers[k]={choice:'t0',confidence:.99};for(const k of ['shared_0_end','shared_1_end'])if(result.answers[k])result.answers[k]={choice:Object.keys(request.questions[k].criteria).at(-1),confidence:.99};return result;}});
assert(shared.value.productRequest.items.every(item=>item.sharedEvidence===''),'A whole multi-target turn cannot be treated as a shared specification');
const {applyProductRequestScope}=await import('../server/product-request-scope-service.js');
const selected=applyProductRequestScope({shouldLoadProductContext:true,cardAllowed:true,replyBoundary:{salesAllowed:true}},
 {route:'product_search',confidence:.3,productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:0,selectionEvidence:'Manchester'}},
 {userText:'Manchester',siteId:'s',characterId:'c',recentMessages:[{senderType:'character',productRequestState:intent.productRequestState}],buildIntent:buildProductSearchIntent});
assert.equal(selected.productRequestState.status,'selected');assert.equal(selected.requestedTeam,'Manchester City');
assert.equal(selected.requestedSeason,'2008');assert.notEqual(selected.requestedAudience,'kids');assert(selected.shouldLoadProductContext);
const foreign=applyProductRequestScope({shouldLoadProductContext:true,cardAllowed:true},
 {route:'product_search',confidence:.3,productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:0,selectionEvidence:'Manchester'}},
 {userText:'Manchester',siteId:'other',characterId:'c',recentMessages:[{senderType:'character',productRequestState:intent.productRequestState}],buildIntent:buildProductSearchIntent});
assert.equal(foreign.shouldLoadProductContext,false,'A selection cannot borrow a foreign site scope');
console.log('JEV multi-item complete source spans, low-score choices and owned pending scope passed; no DB/network/model calls');

const scopeRows=[{senderType:'character',productRequestState:intent.productRequestState}];
const selectionPacket=buildCommerceJevPacket('Manchester',{siteId:'s',characterId:'c',recentMessages:scopeRows});
assert.deepEqual(Object.keys(selectionPacket.questions.selected_index.criteria),['none','all','i0','i1'],'Only existing owned indices and the explicit whole-set option are offered');
assert(JSON.parse(selectionPacket.questions.selected_index.criteria.i0).evidence===first);
assert(JSON.parse(selectionPacket.questions.selected_index.criteria.i1).evidence===second);
assert.deepEqual(Object.keys(buildCommerceJevPacket('Manchester',{siteId:'foreign',characterId:'c',recentMessages:scopeRows}).questions.selected_index.criteria),['none'],'No foreign set can supply an index');
assert(selectionPacket.questions.request_action.instructions.includes('USER need not say a numeric index'));
for (const [input,action,index] of [['Manchester','select',0],['Yes, that one','continue',0],['10 or 12','continue',0]]) {
 const earlier=index===0&&action==='continue'?selected.productRequestState:intent.productRequestState;
 const raw=await resolveJevCommerceDecision(input,{siteId:'s',characterId:'c',recentMessages:[{senderType:'character',productRequestState:earlier}],evaluate:async({questions})=>({ok:true,answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>[key,{choice:({route:'product_search',request_relation:'multiple',request_action:action,selected_index:'i0',requirement_action:'none',sales_allowed:'yes',contact_allowed:'yes',live_required:'yes',answer_required:'yes'})[key]||(q.criteria.none?'none':q.criteria.absent?'absent':q.criteria.no?'no':Object.keys(q.criteria)[0]),confidence:.1}]))})});
 assert(raw.ok);assert.equal(raw.value.productRequest.selectedIndex,index);
 const out=applyProductRequestScope({shouldLoadProductContext:true,cardAllowed:true},raw.value,{userText:input,siteId:'s',characterId:'c',recentMessages:[{senderType:'character',productRequestState:earlier}],buildIntent:buildProductSearchIntent});
 assert.equal(out.productRequestState.status,'selected');assert.equal(out.requestedTeam,'Manchester City');assert.notEqual(out.requestedAudience,'kids');
}
console.log('Natural selection, assent and size continuation use actual closed-set USER targets, with foreign scopes excluded');
