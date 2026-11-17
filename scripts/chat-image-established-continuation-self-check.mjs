import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('No provider in established image continuation checks');};
const {classifyChatImageIntent}=await import('../server/chat-image-intent-classifier-service.js');
const context={latestImageKind:'character',recentConversation:[
 {role:'user',kind:'text',text:'Make a normal photo of yourself in a blue football shirt.'},
 {role:'assistant',kind:'image_generation',text:'Photo ready.'},
 {role:'assistant',kind:'text',text:'Here is the photo.'},
]};
const decision={ok:true,primaryIntent:'new_image',imageIntent:'explicit_generation',confidence:.6};
const make=(text,patch={})=>({hasIntent:true,allowed:true,confidence:.62,intentType:'explicit_generation',
 communicativeAction:'request_visual_output',requestKind:'character_image',imageSubject:'character',requestScope:'image_only',
 requestEvidence:text,actionEvidence:text,actorEvidence:'yourself',explicitGeneration:true,wants_clothing:false,wants_no_clothing:false,
 appearanceContext:{previousSubject:'character',previousOutfit:'clothed',relation:'continue',previousEvidence:context.recentConversation[0].text,currentEvidence:text,target:'generic'},...patch});
let calls=0;
async function classify(text,patch={},extra={}){return classifyChatImageIntent(text,{character:{id:'mascot_fixture',category_id:'mascot'},jevDecision:decision,conversationContext:context,
 classifyImageJev:async()=>{calls++;return{ok:true,parsed:make(text,patch)};},...extra});}
for(const text of ['Another normal picture, please.','Once more.']){
 const out=await classify(text);assert.equal(out.hasIntent,true,'An established current image action may reuse the verified character subject without requiring a library-only type');
 assert.equal(out.intentType,'explicit_generation');assert.equal(out.allowed,true);assert.deepEqual(out.conditions,{wants_clothing:false,wants_no_clothing:false},'Only the subject continues, never the old outfit');
}
const plain=await classify('Again, please.',{appearanceContext:{...make('Again, please.').appearanceContext,previousOutfit:'none',relation:'none'}});
assert.equal(plain.allowed,true,'Character identity continuation does not require inheriting a prior outfit');
for(const [patch,extra]of [
 [{actionEvidence:''},{}],[{requestEvidence:'invented'},{}],[{actorEvidence:'invented'},{}],
 [{appearanceContext:{previousSubject:'other'}},{}],[{}, {conversationContext:{recentConversation:[{role:'assistant',kind:'mascot_greeting_image',text:''}]}}],
 [{intentType:'disallowed',requestKind:'unsupported_image',allowed:false},{}],
]){
 const out=await classify('Once more.',patch,extra);assert.equal(out.allowed,false,'Invalid current evidence, foreign actor or unrelated prior media cannot grant a continuation');
}
const before=calls;const chat=await classify('Tell me about football.',{}, {jevDecision:{...decision,primaryIntent:'daily_chat',imageIntent:'none'}});
assert.equal(chat.hasIntent,false);assert.equal(calls,before,'Ordinary chat keeps the primary no-image exit and no extra type call');
const mixed=await classify('Another image, and explain the store points.',{requestScope:'mixed'});assert.equal(mixed.hasIntent,true);assert.equal(mixed.requestScope,'mixed','Subject continuation must not erase an independent business question');
const prior=await classify('Once more.',{}, {conversationContext:{recentConversation:[{role:'user',kind:'text',text:'A photo of someone else.'},{role:'assistant',kind:'image_generation',text:''}]}});
assert.equal(prior.allowed,false,'A foreign prior subject cannot supply the selected actor quote');
console.log('Established image continuation: actual classifier adapter, current-action/source/actor negatives, mixed preservation and non-image no-call checks passed');

// Execute the unchanged guest entitlement branch with the actual accepted
// classifier result. No quota reservation, database query or image job may run.
const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
const triggerService=await import('../server/chat-image-trigger-service.js');
const {applyChatImageCommercePolicy}=await import('../server/chat-image-commerce-policy-service.js');
const {GUEST_IMAGE_ENTITLEMENT_STATUSES}=await import('../server/guest-image-entitlement-service.js');
const {isProductCapableCharacter,normalizeChatImageConditions}=await import('../server/chat-image-intent-classifier-service.js');
const {GUEST_IMAGE_QUOTA_ACCESS_CONTRACT,toImageStatusReviewContext}=await import('../server/chat-image-status-context-service.js');
const source=readFileSync(new URL('../server/chat-image-generation-service.js',import.meta.url),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\n/gm,'').replace(/export /g,'');
let entitlementReads=0;const noWrite=()=>{throw Error('A consumed entitlement cannot cause a catalogue read, reservation or image task');};
const {maybeCreateGuestChatImagePlaceholder}=vm.runInNewContext(source+'\n({maybeCreateGuestChatImagePlaceholder});',{
 console,...triggerService,isProductCapableCharacter,normalizeChatImageConditions,applyChatImageCommercePolicy,GUEST_IMAGE_QUOTA_ACCESS_CONTRACT,
 GUEST_IMAGE_ENTITLEMENT_STATUSES,lockGuestImageEntitlement:async()=>{entitlementReads++;return{entitlement_status:GUEST_IMAGE_ENTITLEMENT_STATUSES.CONSUMED};},
 replyLog:{recordImageDecisionLog:async()=>{}},createMascotLibraryImageMessage:noWrite,lockGuestImageDailyQuota:noWrite,reserveGuestImageEntitlement:noWrite,
});
const imageDecision=await classify('Once more.');
const terminal=await maybeCreateGuestChatImagePlaceholder({execute:noWrite},{guest:{id:'owned-guest'},session:{id:'owned-session'},character:{id:'mascot_fixture',category_id:'mascot'},userText:'Once more.',userMessage:{id:'owned-message',displayOrder:10},jevDecision:decision,conversationContext:context,imageDecision});
assert.equal(terminal.reason,'quota_exhausted');assert.equal(terminal.taskCreated,false);assert.equal(terminal.message,null);assert.equal(entitlementReads,1);
assert.match(terminal.directive.instruction,/register or sign in/);
assert.equal(toImageStatusReviewContext(terminal.directive).currentRequest.guestAccess.additionalQuotaVerified,false);
assert(terminal.directive.instruction.includes(GUEST_IMAGE_QUOTA_ACCESS_CONTRACT));
console.log('Established continuation reaches the real quota-exhausted directive without reserving or creating media');
