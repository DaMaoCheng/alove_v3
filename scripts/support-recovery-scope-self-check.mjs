import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw new Error('External requests forbidden');};
const {buildBusinessClaimContext,hasGeneralCommerceDefinitionPermission,validateBusinessClaimAudit}=await import('../server/business-claim-audit-service.js');
const {isGroundedCommerceRepairEligible,repairGroundedCommerceReply}=await import('../server/chat-grounded-reply-repair-service.js');
const character={id:'guide',category_id:'mascot',site_id:'shop'},trustedSite={id:'shop'};
const userText='How long after shipping will take for that tracking link to come through';
const searchIntent={commerceRoute:'store_policy',commerceTopic:'delivery',knowledgeScope:'business',customerServiceKnowledgeRequest:true,answerRequired:true,policyKnowledgeRequest:{source:'jev',required:true,evidence:userText,query:userText},generalExplanationRequest:{source:'jev',kind:'term_meaning',required:true,evidence:userText,subject:userText},replyBoundary:{salesAllowed:false,contactAllowed:true}};
const knowledgeContext={ok:true,evidenceSchemaVersion:1,customerServiceIntent:true,businessOwner:{siteId:'shop',characterId:'guide'},strategy:'business_selection_unavailable',selectionFailure:{stage:'evidence',kind:'timeout'},items:[]};
const options={businessFactsRequired:true,text:'Usually the tracking comes attached to the shipping confirmation rather than right at dispatch.',userText,searchIntent,catalogueOwner:{character,trustedSite},knowledgeContext,feedbackActionAvailable:true};
assert.equal(hasGeneralCommerceDefinitionPermission(options),false,'An entire timing question is not a source-owned term to define');
const context=buildBusinessClaimContext(options);
const entry={unitId:'u0',roles:['general_definition'],factual:false,referenceIds:[],supported:true,sourceAllowsException:false,replyPreservesException:false};
assert.equal(validateBusinessClaimAudit([entry],context).accepted,false,'The captured general-definition vote cannot bypass missing business evidence');
assert(!context.references.some(r=>r.id==='a0'),'No mixed capability source may stand in for unavailable order access');
assert(!context.references.some(r=>r.id==='a0.orderEntry'));
assert(context.references.some(r=>r.id==='a0.platformAccess'));
assert(context.references.some(r=>r.id==='a0.feedback'));
assert(!context.references.filter(r=>r.kind==='capability').some(r=>JSON.parse(r.text).orderEntry===null),'Unavailable capabilities cannot be laundered through another available capability');
assert.equal(validateBusinessClaimAudit([{...entry,roles:['capability'],factual:true,referenceIds:['a0']}],context).valid,false,'The actual captured broad a0 reference is rejected');
const actualOrder=buildBusinessClaimContext({...options,orderActionState:'login_required'});
assert.equal(JSON.parse(actualOrder.references.find(r=>r.id==='a0.orderEntry').text).orderEntry,'login_required');
assert(validateBusinessClaimAudit([{...entry,roles:['capability'],factual:true,referenceIds:['a0.orderEntry']}],actualOrder).accepted);
for(const subject of ['completed','waiting for customs']){
 const text=`What does ${subject} mean?`;
 assert(hasGeneralCommerceDefinitionPermission({...options,userText:text,searchIntent:{...searchIntent,generalExplanationRequest:{source:'jev',kind:'reported_status_meaning',required:true,evidence:text,subject}}}),'An actual current USER term still permits conditional meaning');
}
for(const subject of ['', 'invented term',userText])assert(!hasGeneralCommerceDefinitionPermission({...options,searchIntent:{...searchIntent,generalExplanationRequest:{...searchIntent.generalExplanationRequest,subject}}}));
const discountText='hay algun codigo descuento para comprar?';
const discount={replyResult:{text:'Unverified login benefit claim.',sourceType:'ai',sourceRef:'venice-chat-completions'},character,trustedSite,userText:discountText,reviewStatus:'valid',reviewResult:{allowed:false,confidence:.78,boundarySupported:true,guidanceSupported:false,businessFactsSupported:false},failedContracts:['guidance','business_facts'],searchIntent:{...searchIntent,commerceTopic:'price',generalExplanationRequest:{source:'jev',kind:'none',required:false,evidence:discountText},promotionInquiry:{kind:'policy',evidence:discountText},discountExplanationRequired:true,replyBoundary:{salesAllowed:true,contactAllowed:true}},knowledgeContext:{...knowledgeContext,selectionFailure:undefined,strategy:'business_no_relevant_section',selectionDiagnostics:{stage:'directory',outcome:'empty',counts:{selected:0}}},feedbackActionCandidate:{kind:'feedback'},factualContext:{required:true,status:'blocked',reason:'business_or_order_scope',searched:false,items:[]}};
assert(isGroundedCommerceRepairEligible(discount),'A successful owned empty promotion-policy lookup may rewrite an honest limitation');
for(const patch of [{promotionInquiry:{kind:'benefit_request',evidence:discountText}},{promotionInquiry:{kind:'policy',evidence:'invented'}},{promotionInquiry:{}},{cardAllowed:true}])assert(!isGroundedCommerceRepairEligible({...discount,searchIntent:{...discount.searchIntent,...patch}}),JSON.stringify(patch));
for(const patch of [{guestBenefitContext:{}},{groundedRepairAttempted:true},{orderActionCandidate:{}},{trustedSite:{id:'foreign'}},{replyResult:{...discount.replyResult,verifiedDiscountOffers:[{code:'X'}]}}])assert(!isGroundedCommerceRepairEligible({...discount,...patch}));
let calls=0;
const fresh=await repairGroundedCommerceReply({...discount,config:{apiKey:'fixture',model:'fixture',apiMode:'chat_completions'},requestText:async()=>{calls++;return JSON.stringify({displayText:'Ahora no puedo confirmar un código de descuento vigente.'});}});
assert.equal(calls,1);assert(fresh);assert.equal(fresh.verifiedDiscountOffers.length,0);assert(!fresh.discountOfferReply);
const {resolveJevCommerceDecision}=await import('../server/jev-commerce-decision-service.js');
for(const [text,kind,subject] of [[userText,'term_meaning',''],['What does completed mean?','reported_status_meaning','completed']]) {
 let calls=0;
 const r=await resolveJevCommerceDecision(text,{evaluate:async({questions})=>{calls++;return{ok:true,answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>{let choice=({route:'store_policy',knowledge_scope:'business',knowledge_kind:'business_question',general_explanation_kind:kind,answer_required:'yes'})[key]||(q.criteria.none?'none':q.criteria.absent?'absent':q.criteria.no?'no':Object.keys(q.criteria)[0]);if(key==='general_explanation_evidence'&&subject)choice=Object.entries(q.criteria).find(([,value])=>value===JSON.stringify(subject))?.[0]||'none';return[key,{choice,confidence:.99}];}))};}});
 assert(calls<=2,'Term extraction reuses the existing bounded RPC batches');assert.equal(r.value.generalExplanationRequest.subject,subject);
 assert.equal(hasGeneralCommerceDefinitionPermission({...options,userText:text,searchIntent:{...searchIntent,generalExplanationRequest:{...r.value.generalExplanationRequest,source:'jev'}}}),Boolean(subject),'Absent source span must retain an explicit denied subject, never fall back to legacy definition flags');
}
console.log('Support scope: source-owned definitions, split capabilities, actual order access and bounded empty-promotion correction passed (no network/DB/models)');
