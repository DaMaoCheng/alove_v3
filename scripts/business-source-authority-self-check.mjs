import assert from 'node:assert/strict';
import {buildBusinessClaimContext, validateBusinessClaimAudit, businessClaimAuditSchema} from '../server/business-claim-audit-service.js';
const character={id:'guide',category_id:'mascot',site_id:'shop'}, trustedSite={id:'shop'};
const intent={query:'Arsenal kids away shirt',commerceRoute:'product_search',commerceTopic:'other',primarySearchVerified:true,
  shouldLoadProductContext:true,needsLiveProductData:true,cardAllowed:true,requestedTeam:'Arsenal',requestedProductType:'shirt',
  knowledgeScope:'business',replyBoundary:{salesAllowed:true,contactAllowed:true}};
const product={id:'shirt',name:'Arsenal Kids Away Jersey 2026/27',siteId:'shop',url:'https://fixture.invalid/shirt',available:true,matchStatus:'matched'};
const base={businessFactsRequired:true,text:'This is the Arsenal kids away shirt.',userText:'Show the Arsenal kids away shirt.',
  catalogueOwner:{character,trustedSite},searchIntent:intent,productContext:{sourceType:'product_api',sourceRef:'guest-site-product-context',siteId:'shop',
    searchOutcome:'matched',cardAllowed:true,searchIntent:intent,products:[product]}};
const entry=(roles,referenceIds,patch={})=>({unitId:'u0',roles,referenceIds,relationEvidence:[],factual:true,supported:true,sourceAllowsException:false,replyPreservesException:false,...patch});
const catalogue=buildBusinessClaimContext(base);
assert(catalogue?.references.some(r=>r.id==='p0'),'A completed owned catalogue search supports product claims without a knowledge lookup');
assert(validateBusinessClaimAudit([entry(['catalogue'],['p0'])],catalogue).accepted);
for(const patch of [
 {catalogueOwner:{character,trustedSite:{id:'foreign'}}},
 {catalogueOwner:{character:{...character,site_id:'foreign'},trustedSite}},
 {productContext:{...base.productContext,sourceErrorCode:'timeout'}},
 {productContext:{...base.productContext,snapshotOnly:true}},
 {searchIntent:{...intent,primarySearchVerified:false}},
]) assert(!buildBusinessClaimContext({...base,...patch})?.references.some(r=>r.kind==='catalogue'),'Wrong owner, failed, cached or unverified source cannot acquire catalogue authority');
const canonical=buildBusinessClaimContext({...base,catalogueOwner:{character:{...character,site_id:'legacy'},trustedSite:{...trustedSite,identity_mascot_character_id:'guide'}}});
assert(canonical.references.some(r=>r.id==='p0'),'Explicit canonical current-site binding remains supported');
console.log('Business source authority: catalogue without knowledge and source/ownership negatives passed');
const policy={id:'points',sourceContent:'Redeem from the personal center.',answerEvidence:[{id:'s0',text:'Redeem from the personal center.',role:'answer'}]};
const business={businessFactsRequired:true,text:'The image is generating.',userText:'Generate a photo and explain my points.',catalogueOwner:{character,trustedSite},
  searchIntent:{commerceRoute:'store_policy',knowledgeScope:'business',answerRequired:true,policyKnowledgeRequest:{source:'jev',required:true,evidence:'explain my points',query:'points'}},
  knowledgeContext:{ok:true,customerServiceIntent:true,evidenceSchemaVersion:1,businessOwner:{siteId:'shop',characterId:'guide'},items:[policy]}};
const imageAudit=buildBusinessClaimContext({...business,imageStatusContext:{kind:'generated',status:'generating',currentTurn:true}});
assert(imageAudit.references.some(r=>r.id==='a0' && JSON.parse(r.text).imageStatus?.status==='generating'),'Existing image state receives bounded capability authority in the mixed business audit');
assert(validateBusinessClaimAudit([entry(['capability'],['a0'])],imageAudit).accepted);
assert(!validateBusinessClaimAudit([entry(['capability'],[],{factual:false})],imageAudit).accepted,'A nonfactual capability label cannot bypass citations');
assert(!validateBusinessClaimAudit([entry(['store_policy'],['a0'])],imageAudit).accepted,'Image task state cannot support store policy');
const feedbackAudit=buildBusinessClaimContext({...business,feedbackActionAvailable:true,knowledgeContext:{ok:true,strategy:'not_requested',customerServiceIntent:false,items:[]},searchIntent:{...business.searchIntent,policyKnowledgeRequest:{source:'jev',required:false,evidence:'explain my points',query:''}}});
assert(feedbackAudit.references.some(r=>r.id==='a0' && JSON.parse(r.text).feedbackActionAvailable===true),'A real attached feedback entry does not require a knowledge hit');
assert(validateBusinessClaimAudit([entry(['capability'],['a0'])],feedbackAudit).accepted);
assert(!validateBusinessClaimAudit([entry(['feedback_submission'],['a0'])],feedbackAudit).accepted,'Entry availability does not prove a saved submission');
assert(!buildBusinessClaimContext({...business,feedbackActionAvailable:true,boundary:{contactAllowed:false}}).references.some(r=>r.kind==='capability'),'Contact boundary still forbids feedback invitations');
console.log('Mixed image and no-policy feedback bounded capabilities passed');
const noPolicy={...business,knowledgeContext:{ok:true,strategy:'not_requested',customerServiceIntent:false,items:[]},searchIntent:{...business.searchIntent,policyKnowledgeRequest:{source:'jev',required:false,evidence:'explain my points',query:''}}};
const imageWithoutPolicy=buildBusinessClaimContext({...noPolicy,imageStatusContext:{kind:'generated',status:'generating',currentTurn:true}});
assert(imageWithoutPolicy?.references.some(r=>r.id==='a0'),'Mixed no-policy/image turns keep their existing owned typed audit');
const safety=buildBusinessClaimContext({...noPolicy,text:'Check independent reviews before deciding.',searchIntent:{...noPolicy.searchIntent,siteTrustOnly:true}});
assert(businessClaimAuditSchema(safety).items.properties.roles.items.enum.includes('general_guidance'),'A site-trust answer has a bounded general-guidance role');
assert(safety.references.some(r=>r.id==='g0' && r.kind==='general_guidance'));
assert(validateBusinessClaimAudit([entry(['general_guidance'],['g0'])],safety).accepted);
assert(!validateBusinessClaimAudit([entry(['store_policy'],['g0'])],safety).accepted,'General safety advice never proves merchant reliability or payment availability');
assert(!validateBusinessClaimAudit([entry(['general_guidance'],[],{factual:false})],safety).accepted,'Guidance role must cite its bounded contract');
assert(!businessClaimAuditSchema(feedbackAudit).items.properties.roles.items.enum.includes('general_guidance'),'Ordinary complaints do not acquire unrelated buying-safety permission');
assert(!validateBusinessClaimAudit([entry(['general_guidance'],['r0'])],feedbackAudit).accepted);
assert(validateBusinessClaimAudit([entry(['user_report'],['r0'])],feedbackAudit).accepted);
assert(!validateBusinessClaimAudit([entry(['store_policy','user_report'],['r0'])],feedbackAudit).accepted,'A user-reported promotion does not verify the campaign');
assert(!validateBusinessClaimAudit([entry(['user_report'],['r0'],{factual:false})],feedbackAudit).valid,'Acknowledgement references retain protocol consistency instead of silent auto-approval');
console.log('General safety guidance, user-report authority and no-policy mixed evidence passed');
const definitionOptions={...noPolicy,text:'A waiting status usually means the next step has not started.',userText:'What does waiting mean? Also check my order.',
  searchIntent:{...noPolicy.searchIntent,generalExplanationRequest:{source:'jev',required:true,evidence:'What does waiting mean?'}}};
const definitionAudit=buildBusinessClaimContext(definitionOptions);
assert(definitionAudit.generalDefinitionAllowed,'Validated independent explanation and an order request may coexist');
const definitionEntry=entry(['general_definition'],[],{factual:false});
assert(validateBusinessClaimAudit([definitionEntry],definitionAudit).accepted);
assert(!validateBusinessClaimAudit([entry(['general_definition','live_order_state'],[],{factual:false})],definitionAudit).accepted,'Definition permission cannot authorize a stage of the actual parcel');
for(const patch of [
 {searchIntent:{...definitionOptions.searchIntent,generalExplanationRequest:{source:'llm',required:true,evidence:'What does waiting mean?'}}},
 {searchIntent:{...definitionOptions.searchIntent,generalExplanationRequest:{source:'jev',required:false,evidence:'What does waiting mean?'}}},
 {searchIntent:{...definitionOptions.searchIntent,generalExplanationRequest:{source:'jev',required:true,evidence:'unrelated'}}},
 {catalogueOwner:{character,trustedSite:{id:'foreign'}}},
]) assert(!buildBusinessClaimContext({...definitionOptions,...patch})?.generalDefinitionAllowed,'Only the owned current-user JEV explanation decision grants definition permission');
console.log('Independent whole-turn definition permission and live-order separation passed');

const mixedText='The image is generating. Redeem from the personal center.';
const mixedAudit=buildBusinessClaimContext({...business,text:mixedText,imageStatusContext:{kind:'generated',status:'generating',currentTurn:true}});
assert(validateBusinessClaimAudit([entry(['capability'],['a0']),entry(['store_policy'],['k0.s0'],{unitId:'u1'})],mixedAudit).accepted,'The same audit can keep the image acknowledgement and independent supported policy answer');
assert(!validateBusinessClaimAudit([entry(['capability'],['k0.s0']),entry(['store_policy'],['a0'],{unitId:'u1'})],mixedAudit).accepted,'Mixed reply sources cannot be interchanged');
for(const state of ['queued','generating','ready','failed','unknown']){
 const context=buildBusinessClaimContext({...business,imageStatusContext:{kind:'generated',status:state,currentTurn:false},feedbackActionAvailable:true});
 const capability=JSON.parse(context.references.find(r=>r.id==='a0').text);
 assert.equal(capability.imageStatus.status,state);assert.equal(capability.imageStatus.currentTurn,false);
 assert(!('clothing' in capability.imageStatus));
}
const unavailableImage=buildBusinessClaimContext({...business,imageStatusContext:{kind:'generated',status:'ready',currentTurn:false,currentRequest:{outcome:'not_created'}}});
assert.equal(JSON.parse(unavailableImage.references.find(r=>r.id==='a0').text).imageStatus.currentRequest.outcome,'not_created');
console.log('Complete mixed response, source separation and bounded image-state projection passed');
const catalogueWithForeignPolicy=buildBusinessClaimContext({...base,knowledgeContext:{ok:true,customerServiceIntent:true,businessOwner:{siteId:'foreign',characterId:'guide'},items:[policy]}});
assert(catalogueWithForeignPolicy.references.some(r=>r.kind==='catalogue'),'A foreign policy result cannot suppress the separately verified current catalogue');
assert(!catalogueWithForeignPolicy.references.some(r=>r.kind==='knowledge'),'Independent catalogue grounding must not import foreign policy evidence');

const {hasGeneralCommerceDefinitionPermission,isGeneralCommerceExplanation}=await import('../server/business-claim-audit-service.js');
for(const kind of ['case_diagnosis','none','unknown']) {
 const candidate={...definitionOptions,searchIntent:{...definitionOptions.searchIntent,generalTermExplanation:true,conceptAndPolicy:true,
   generalExplanationRequest:{source:'jev',kind,required:kind!=='none',evidence:definitionOptions.userText}}};
 assert.equal(hasGeneralCommerceDefinitionPermission(candidate),false,'A diagnostic/absent/invalid kind cannot be reauthorized by legacy explanation flags');
 const context=buildBusinessClaimContext(candidate);
 assert(!context.generalDefinitionAllowed);
 assert(!businessClaimAuditSchema(context).items.properties.roles.items.enum.includes('general_definition'));
 assert(!validateBusinessClaimAudit([definitionEntry],context).accepted);
 assert(!isGeneralCommerceExplanation({...candidate.searchIntent,commerceRoute:'chat',knowledgeScope:'general',commerceTopic:'delivery'}),'Pure-concept compatibility cannot bypass an explicit non-meaning kind');
}
for(const kind of ['term_meaning','reported_status_meaning']) {
 const candidate={...definitionOptions,searchIntent:{...definitionOptions.searchIntent,generalExplanationRequest:{source:'jev',kind,required:true,evidence:definitionOptions.userText}}};
 assert(hasGeneralCommerceDefinitionPermission(candidate));
 assert(buildBusinessClaimContext(candidate).generalDefinitionAllowed);
 for(const patch of [{source:'llm'},{required:false},{evidence:'not current'}]) assert(!hasGeneralCommerceDefinitionPermission({...candidate,searchIntent:{...candidate.searchIntent,generalTermExplanation:true,conceptAndPolicy:true,generalExplanationRequest:{...candidate.searchIntent.generalExplanationRequest,...patch}}}));
}
console.log('Meaning categories grant only current owned definitions; diagnostic/absent and invalid evidence cannot regain permission through legacy flags');
