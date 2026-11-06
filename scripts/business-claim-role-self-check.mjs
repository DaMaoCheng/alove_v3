import assert from 'node:assert/strict';
import {buildBusinessClaimContext,businessClaimAuditSchema,validateBusinessClaimAudit} from '../server/business-claim-audit-service.js';
const options={businessFactsRequired:true,text:'The order is in the warehouse.',userText:'My order is processing.',characterId:'c',siteId:'s',knowledgeContext:{items:[{id:'policy',sourceContent:'Processing takes 1–3 days. Report missing deliveries within 45 days.',content:'Processing takes 1–3 days.',answerEvidence:[{id:'s0',text:'Processing takes 1–3 days.',role:'answer'}]}]}};
const context=buildBusinessClaimContext(options);
assert(context.typedClaims);
assert(!context.references.some(r=>r.text.includes('45 days')),'Unselected source clause cannot be cited');
assert(businessClaimAuditSchema(context).items.required.includes('roles'));
const row={relationEvidence:[],unitId:'u0',factual:true,roles:['live_order_state'],referenceIds:['k0.s0'],supported:true,sourceAllowsException:false,replyPreservesException:false};
let result=validateBusinessClaimAudit([row],context);
assert.equal(result.valid,true);assert.equal(result.accepted,false);assert.deepEqual(result.failedUnitIds,['u0']);
assert.equal(validateBusinessClaimAudit([{...row,roles:['store_policy']}],context).accepted,true);
assert.equal(validateBusinessClaimAudit([{...row,roles:['user_report']}],context).accepted,false);
assert.equal(validateBusinessClaimAudit([{...row,roles:['user_report'],referenceIds:['r0']}],context).accepted,true);
assert.equal(validateBusinessClaimAudit([{...row,roles:['capability']}],context).accepted,false);
assert.equal(validateBusinessClaimAudit([{...row,roles:['social'],factual:false,referenceIds:[]}],context).accepted,true);
assert.equal(validateBusinessClaimAudit([{...row,roles:undefined}],context).valid,false);
const qualified={...context,references:context.references.map(r=>({...r,evidenceRole:'qualification'}))};
assert.equal(validateBusinessClaimAudit([{...row,roles:['store_policy']}],qualified).accepted,false);
const actualTool={...context,references:[{id:'actual',kind:'live_order',text:'verified tool result'}]};
assert.equal(validateBusinessClaimAudit([{...row,referenceIds:['actual']}],actualTool).accepted,true);
assert.equal(validateBusinessClaimAudit([{...row,roles:['store_policy','live_order_state']}],context).accepted,false);
console.log('Typed claim role checks passed: selected evidence, source authority, mixed claims, semantic rejection and legacy separation');

const {buildReplyReviewMessages} = await import('../server/chat-reply-review-contracts.js');
const poisonedItem = {...options.knowledgeContext.items[0], evidenceQuote:'Report missing deliveries within 45 days.', content:options.knowledgeContext.items[0].sourceContent};
const scopedPacket = JSON.stringify(buildReplyReviewMessages({...options,knowledgeContext:{items:[poisonedItem]}}));
assert(!scopedPacket.includes('45 days'), 'An unselected clause cannot reenter the actual reviewer through original quote, source context or content');
const legacyItem = {...poisonedItem}; delete legacyItem.answerEvidence;
assert(JSON.stringify(buildReplyReviewMessages({...options,knowledgeContext:{items:[legacyItem]}})).includes('45 days'), 'Legacy evidence retains its original packet');
console.log('Actual review packet scoped quote bypass and legacy compatibility passed');

const emptyOwned = {...options,searchIntent:{commerceRoute:'chat',knowledgeScope:'business',answerRequired:false},catalogueOwner:{character:{id:'c'},trustedSite:{id:'s'}},knowledgeContext:{ok:true,evidenceSchemaVersion:1,customerServiceIntent:true,businessOwner:{siteId:'s',characterId:'c'},items:[]}};
for (const strategy of ['business_no_verified_answer','business_selection_unavailable']) {
 const empty = buildBusinessClaimContext({...emptyOwned,knowledgeContext:{...emptyOwned.knowledgeContext,strategy}});
 assert(empty?.typedClaims, 'No result or provider failure must not downgrade the typed audit');
 assert.equal(validateBusinessClaimAudit([{...row,referenceIds:['r0']}],empty).accepted,false);
 assert.equal(buildBusinessClaimContext({...emptyOwned,knowledgeContext:{...emptyOwned.knowledgeContext,businessOwner:{siteId:'other',characterId:'c'}}}),null);
}
console.log('Empty owned business evidence retains typed audit; wrong owners remain isolated');

const dependencyContext = {bounded:true,typedClaims:true,units:[{id:'u0',text:'Processing usually takes 1–3 days.'},{id:'u1',text:'Customization can add time.'}],references:[{id:'a',kind:'knowledge',evidenceRole:'answer',sectionId:'shipping',text:'Processing usually takes 1–3 days.'},{id:'q',kind:'knowledge',evidenceRole:'qualification',sectionId:'shipping',text:'Customization can add time.'}]};
const parent = {...row,roles:['store_policy'],referenceIds:['a']};
const child = {...row,unitId:'u1',roles:['store_policy'],referenceIds:['q']};
assert.equal(validateBusinessClaimAudit([parent,child],dependencyContext).accepted,true);
assert.equal(validateBusinessClaimAudit([child,parent],dependencyContext).accepted,true,'Dependency is independent of sentence order');
assert.equal(validateBusinessClaimAudit([child],{...dependencyContext,units:[dependencyContext.units[1]]}).accepted,false);
assert.equal(validateBusinessClaimAudit([parent,child],{...dependencyContext,references:dependencyContext.references.map(r=>r.id==='q'?{...r,sectionId:'returns'}:r)}).accepted,false);
for(const invalid of [{supported:false},{sourceAllowsException:true,replyPreservesException:false},{roles:['store_policy','live_order_state']}]){
 const result=validateBusinessClaimAudit([{...parent,...invalid},child],dependencyContext);
 assert(result.failedUnitIds.includes('u1'),'An unsupported parent cannot authorize a separate qualification');
}
console.log('Same-response qualification dependencies preserve supported answers without cross-section or rejected-parent authority');

const definition={...row,roles:['general_definition','verification_limit'],factual:false,referenceIds:[]};
const definitionRefusal=validateBusinessClaimAudit([definition],context);
assert.equal(definitionRefusal.valid,true);assert.equal(definitionRefusal.accepted,false);assert.deepEqual(definitionRefusal.failedUnitIds,['u0']);
assert(!businessClaimAuditSchema(context).items.properties.roles.items.enum.includes('general_definition'));
const mixedConcept=buildBusinessClaimContext({...options,searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business',conceptAndPolicy:true}});
assert(mixedConcept.generalDefinitionAllowed);
assert(businessClaimAuditSchema(mixedConcept).items.properties.roles.items.enum.includes('general_definition'));
assert.equal(validateBusinessClaimAudit([definition],mixedConcept).accepted,true);
assert.equal(buildBusinessClaimContext({...options,searchIntent:{commerceRoute:'chat',knowledgeScope:'general',answerRequired:true,generalTermExplanation:true}}),null,'Pure conceptual explanation keeps its existing separate path');
console.log('General-definition permission follows existing semantic intent; actual-order claims cannot use an unrequested definition escape');

const noPolicyDemand = {...emptyOwned,searchIntent:{...emptyOwned.searchIntent,detectionSource:'jev',policyKnowledgeRequest:{source:'jev',required:false,evidence:'My order is processing.',query:''}},knowledgeContext:{ok:true,strategy:'not_requested',customerServiceIntent:false,items:[]},orderActionState:'login_required'};
const noPolicyAudit=buildBusinessClaimContext(noPolicyDemand);
assert(noPolicyAudit.typedClaims,'Skipping knowledge must not skip source-role review');
assert(noPolicyAudit.references.some(r=>r.kind==='capability'));
assert(!noPolicyAudit.references.some(r=>r.kind==='knowledge'));
assert.equal(validateBusinessClaimAudit([{...row,referenceIds:['r0']}],noPolicyAudit).accepted,false,'User reports cannot establish actual order stage');
assert.equal(buildBusinessClaimContext({...noPolicyDemand,catalogueOwner:{}}),null);
assert.equal(buildBusinessClaimContext({...noPolicyDemand,searchIntent:{...noPolicyDemand.searchIntent,policyKnowledgeRequest:{...noPolicyDemand.searchIntent.policyKnowledgeRequest,source:'llm'}}}),null);
assert.equal(buildBusinessClaimContext({...noPolicyDemand,searchIntent:{...noPolicyDemand.searchIntent,knowledgeScope:'general'}}),null);
const foreignKnowledge=buildBusinessClaimContext({...noPolicyDemand,knowledgeContext:{...options.knowledgeContext,businessOwner:{siteId:'foreign',characterId:'c'}}});
assert(!foreignKnowledge.references.some(r=>r.kind==='knowledge'),'New decision cannot authorize foreign source content');
console.log('Independent no-policy decision keeps typed empty-evidence review without authorizing foreign knowledge');

const foreignSubmission = buildBusinessClaimContext({...noPolicyDemand,knowledgeContext:{ok:true,items:[],businessOwner:{siteId:'foreign',characterId:'c'},feedbackSubmission:{verified:true,source:'owned_feedback_record',status:'new'}}});
assert(!foreignSubmission.references.some(r=>r.kind==='feedback_submission'),'Foreign submission metadata cannot become current-site evidence');

const relationshipContext={bounded:true,typedClaims:true,relationshipAudit:true,units:[{id:'u0',text:'The second period starts after the first.'}],references:[{id:'k0.s0',kind:'knowledge',evidenceRole:'answer',sectionId:'policy',text:'First period takes three days.'},{id:'k0.s1',kind:'knowledge',evidenceRole:'answer',sectionId:'policy',text:'Second period takes two days.'}]};
const relationshipRow={...row,relationEvidence:[],roles:['store_policy','policy_sequence'],referenceIds:['k0.s0','k0.s1']};
const unprovenRelation=validateBusinessClaimAudit([relationshipRow],relationshipContext);
assert(unprovenRelation.valid && !unprovenRelation.accepted);
assert.deepEqual(unprovenRelation.failedUnitIds,['u0'],'Unsupported relation enters existing semantic correction, not protocol fallback');
const explicitRelationship={...relationshipContext,references:[...relationshipContext.references,{id:'k0.rel0',kind:'knowledge_relation',relationType:'sequence',text:'The second period starts after the first.'}]};
assert(validateBusinessClaimAudit([{...relationshipRow,relationEvidence:[{type:'sequence',quote:'The second period starts after the first.'}],referenceIds:[...relationshipRow.referenceIds,'k0.rel0']}],explicitRelationship).accepted);
assert(validateBusinessClaimAudit([{...relationshipRow,roles:['store_policy'],relationEvidence:[]}],relationshipContext).accepted,'Parallel source facts need no extra relation');
console.log('Policy relationship permissions: separate facts cannot authorize a new relation; explicit relationship and ordinary facts remain supported');

assert(!validateBusinessClaimAudit([{...relationshipRow,relationEvidence:[{type:'sequence',quote:'The second period starts after the first.'}],referenceIds:[...relationshipRow.referenceIds,'k0.rel0']}],{...explicitRelationship,references:explicitRelationship.references.map(r=>r.kind==='knowledge_relation'?{...r,relationType:'alternative'}:r)}).accepted,'Alternative source cannot authorize sequence');

assert(!businessClaimAuditSchema({...relationshipContext,relationshipAudit:false}).items.properties.roles.description.includes('policy_sequence'),'Legacy typed schema must not require a relation role excluded from its enum');
assert(!validateBusinessClaimAudit([{...relationshipRow,relationEvidence:[{type:'sequence',quote:'The second period starts after the first. Made up.'}],referenceIds:[...relationshipRow.referenceIds,'k0.rel0']}],explicitRelationship).accepted,'Invented or combined proof is not a complete original sentence');
assert(!validateBusinessClaimAudit([{...relationshipRow,relationEvidence:[{type:'sequence',quote:'starts after'}],referenceIds:[...relationshipRow.referenceIds,'k0.rel0']}],explicitRelationship).accepted,'Partial connective quote cannot authorize a complete relationship');

const {isGroundedCommerceRepairEligible}=await import('../server/chat-grounded-reply-repair-service.js');
const noPolicyFollowup={character:{id:'c',category_id:'mascot'},trustedSite:{id:'s'},searchIntent:noPolicyDemand.searchIntent,userText:'The order was paid on 10/25',knowledgeContext:noPolicyDemand.knowledgeContext,replyResult:{sourceType:'ai',sourceRef:'venice-chat-completions',text:'The order is in the warehouse.'},reviewResult:{allowed:false,confidence:.9,boundarySupported:true},reviewStatus:'valid',failedContracts:['business_facts']};
assert(isGroundedCommerceRepairEligible(noPolicyFollowup),'Verified no-policy business continuation retains one diagnostic correction after rejected facts');
assert(!isGroundedCommerceRepairEligible({...noPolicyFollowup,groundedRepairAttempted:true}),'New permission never starts a second correction');
assert(!isGroundedCommerceRepairEligible({...noPolicyFollowup,trustedSite:null}));
assert(!isGroundedCommerceRepairEligible({...noPolicyFollowup,searchIntent:{...noPolicyFollowup.searchIntent,policyKnowledgeRequest:{...noPolicyFollowup.searchIntent.policyKnowledgeRequest,source:'llm'}}}));
const intrinsicContext={...relationshipContext,units:[{id:'u0',text:relationshipContext.references[1].text}]};
assert(validateBusinessClaimAudit([{...relationshipRow,roles:['store_policy','policy_condition'],referenceIds:['k0.s1']}],intrinsicContext).accepted,'A verbatim single source sentence needs no separately extracted relationship');
assert(validateBusinessClaimAudit([{...relationshipRow,roles:['store_policy','policy_condition'],referenceIds:['k0.s1'],relationEvidence:[{type:'condition',quote:relationshipContext.references[1].text}]}],relationshipContext).accepted,'Explicit single-sentence proof can support its own internal relationship without extractor metadata');

assert(!validateBusinessClaimAudit([{...child,roles:['policy_condition']}],{...dependencyContext,units:[dependencyContext.units[1]]}).accepted,'A relation role inherits store-policy qualification dependencies even when the reviewer omits store_policy');

// A validated relation range may span source sentences; its meaning still
// requires the independent reviewer's supported vote.
const alternativeQuote='Redeem from the personal center. Alternatively, email store support.';
const multiSentenceRelation={...relationshipContext,references:[...relationshipContext.references,{id:'k0.rel0',kind:'knowledge_relation',relationType:'alternative',text:alternativeQuote}]};
const alternativeRow={...relationshipRow,roles:['store_policy','policy_alternative'],referenceIds:['k0.s0','k0.rel0'],relationEvidence:[{type:'alternative',quote:alternativeQuote}]};
assert(validateBusinessClaimAudit([alternativeRow],multiSentenceRelation).accepted,'A complete validated multi-sentence alternative must not fail a single-sentence-only check');
assert(!validateBusinessClaimAudit([{...alternativeRow,supported:false}],multiSentenceRelation).accepted,'Source relation metadata never overrides the independent semantic rejection');
assert(!validateBusinessClaimAudit([{...alternativeRow,relationEvidence:[{type:'alternative',quote:alternativeQuote+' Added guarantee.'}]}],multiSentenceRelation).accepted);
assert(!validateBusinessClaimAudit([{...alternativeRow,roles:['store_policy','policy_addition']}],multiSentenceRelation).accepted);
console.log('Complete relation range and independent semantic vote checks passed');
