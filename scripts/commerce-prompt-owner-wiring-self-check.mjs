import assert from 'node:assert/strict';
import fs from 'node:fs';
import {applyCommerceQuestionPromptPolicy} from '../server/commerce-routing-service.js';
import {GENERAL_COMMERCE_EXPLANATION_CONTRACT} from '../server/business-claim-audit-service.js';

// Execute each actual production call expression with the real policy. The
// surrounding DB/model orchestration is deliberately outside this wiring seam.
function productionCall(file, intentName) {
  const source=fs.readFileSync(new URL('../server/'+file,import.meta.url),'utf8');
  const start=source.indexOf('applyCommerceQuestionPromptPolicy(buildChatReplyPrompt({');
  const marker='), '+intentName+')';
  const end=source.indexOf(marker,start);
  assert(start>=0&&end>start,'The real prompt-policy call must be present');
  return source.slice(start,end+1);
}
const userText='For 4 days the reported status has not progressed; what does it mean?';
const character={id:'guide',category_id:'mascot',site_id:'shop',name:'Guide'};
const site={id:'shop',slug:'shop',name:'Shop',identity_mascot_character_id:'guide'};
const baseIntent={commerceRoute:'store_policy',commerceTopic:'delivery',knowledgeScope:'business',answerRequired:true,
 replyBoundary:{salesAllowed:false,contactAllowed:true},generalExplanationRequest:{source:'jev',kind:'reported_status_meaning',required:true,evidence:userText}};
for(const [file,intentName] of [['chat-reply-orchestrator-service.js','commerceSearchIntent'],['guest-reply-service.js','productRecommendation.searchIntent']]){
 const expression=productionCall(file,intentName);
 for(const kind of ['reported_status_meaning','case_diagnosis']) for(const owner of [site,{...site,id:'foreign',identity_mascot_character_id:'other'}]){
  const intent={...baseIntent,generalExplanationRequest:{...baseIntent.generalExplanationRequest,kind,required:kind==='reported_status_meaning'}};
  let built;
  const environment={promptCharacter:character,commerceSite:owner,promptSite:owner,userText,recentMessages:[],sizeUpdatePrompt:{recentMessages:[],productContext:null},
   userContext:null,productContext:null,discountOffersContext:null,knowledgeContext:null,factualContext:null,feedbackActionCandidate:null,orderAction:null,
   chatImageContext:null,visionInputs:[],externalSourceContext:null,commerceSearchIntent:intent,productRecommendation:{searchIntent:intent},
   prepared:{text:userText,guest:{site_id:owner.id,site_slug:owner.slug,site_name:owner.name,site_mascot_character_id:owner.identity_mascot_character_id}},
   buildChatReplyPrompt:options=>{built=options;return{systemPrompt:'Original character rules.',layers:[]}},
   applyCommerceQuestionPromptPolicy:(prompt,searchIntent,options)=>{
    assert.equal(options.character,built.character,'The real call must forward the same authoritative character as the base prompt');
    assert.equal(options.trustedSite,built.trustedSite,'The real call must forward the same authoritative site values as the base prompt');
    return applyCommerceQuestionPromptPolicy(prompt,searchIntent,options);
   }};
  const prompt=Function(...Object.keys(environment),'return '+expression)(...Object.values(environment));
  assert.equal(prompt.systemPrompt.includes(GENERAL_COMMERCE_EXPLANATION_CONTRACT),kind==='reported_status_meaning'&&owner.id==='shop',file+' meaning permission must reach generation without authorizing diagnosis/foreign owners');
  assert(prompt.systemPrompt.startsWith('Original character rules.'));
 }
}
console.log('Actual member/guest prompt call wiring: authoritative owners, supported status meaning and diagnosis/foreign-owner negatives passed; no DB/network/models');
