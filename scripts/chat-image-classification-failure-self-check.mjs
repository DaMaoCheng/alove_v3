import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {analyzeChatImageTrigger, CHAT_IMAGE_BLOCK_REASONS} from '../server/chat-image-trigger-service.js';
import {isProductCapableCharacter} from '../server/chat-image-intent-classifier-service.js';
import {buildImageDecisionLogEvent} from '../server/ai-reply-log-service.js';

// Run production decision/directive code; every attempted DB/tool side effect
// fails this fixture. An unavailable classifier is not image permission.
const source=readFileSync(new URL('../server/chat-image-generation-service.js',import.meta.url),'utf8')
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\n/gm,'').replace(/export /g,'');
const events=[];
const noSideEffect=()=>{throw Error('Unavailable classification cannot read/write quota, create a task or serve a library image');};
const {maybeCreateGuestChatImagePlaceholder,maybeCreateChatImagePlaceholder,resolveChatImageReplyDirective}=vm.runInNewContext(source+'\n({maybeCreateGuestChatImagePlaceholder,maybeCreateChatImagePlaceholder,resolveChatImageReplyDirective});',{
  console,CHAT_IMAGE_BLOCK_REASONS,analyzeChatImageTrigger,isProductCapableCharacter,
  isMockChatImageRequest:()=>false,normalizeChatImageConditions:()=>null,
  replyLog:{recordImageDecisionLog:async payload=>events.push(buildImageDecisionLogEvent(payload))},
  hasActiveChatImageGeneration:noSideEffect,lockChatImageQuota:noSideEffect,hasChatImageQuota:noSideEffect,
  createMascotLibraryImageMessage:noSideEffect,lockGuestImageEntitlement:noSideEffect,
});
const session={id:'session',internal_uid:'owner',character_id:'mascot_fixture'};
const opts={session,character:{id:'mascot_fixture',category_id:'mascot'},userId:'owner',guest:{id:'guest'},userMessage:{id:'trigger',displayOrder:10},
  userText:'Ahora envíame otra foto normal de tu galería, sin ese conjunto ni ropa especial.',
  jevDecision:{ok:true,confident:false,imageIntent:'library_photo',confidence:.49},conversationContext:{},
  imageDecision:{hasIntent:false,allowed:false,detectionSource:'classifier',classificationFailure:'timeout',confidence:0}};
const db={execute:noSideEffect};
const guest=await maybeCreateGuestChatImagePlaceholder(db,opts);
assert.equal(guest.directive?.reason,'classification_unavailable','a failed image-intent check must not disappear as no photo request');
assert.equal(guest.taskCreated,false);assert.equal(guest.message,null);
assert.match(guest.directive.instruction,/No image was created or sent/);
assert.match(guest.directive.instruction,/other|mixed/i,'mixed independent answers remain required');
const directive=await resolveChatImageReplyDirective(db,{...opts,userDisplayOrder:10});
assert.equal(directive.reason,'classification_unavailable');
assert.equal(await maybeCreateChatImagePlaceholder(db,opts),null);
for(const failure of ['timeout','invalid_json','provider_error','not_configured']){
  const failed=await maybeCreateGuestChatImagePlaceholder(db,{...opts,imageDecision:{...opts.imageDecision,classificationFailure:failure}});
  assert.equal(failed.directive.reason,'classification_unavailable');assert.equal(failed.taskCreated,false);
}
for(const [text,imageIntent]of [['Hello, how are you?','none'],['Show me the Peru shirt from your catalogue.','none'],['Where is my photo?','image_inspection']]){
 const unrelated={...opts,userText:text,jevDecision:{...opts.jevDecision,imageIntent}};
 assert.equal(await resolveChatImageReplyDirective(db,unrelated),null,'no unrelated image failure notice');
 const result=await maybeCreateGuestChatImagePlaceholder(db,unrelated);
 assert.equal(result.taskCreated,false);assert.equal(result.directive,null);
}
const event=JSON.parse(events[0].errorMessage);
assert.equal(event.reason,'classification_unavailable');
assert.notEqual(event.outcome,'not_requested','observability separates failed determination from a semantic no-image verdict');
assert.equal(event.image.failure,'timeout');assert.equal(event.image.allowed,false);
console.log('image classification failure self-check passed (guest/member no-action notices, all failure kinds, mixed preservation, ordinary/product/inspection negatives, typed audit)');

for (const classificationOutcome of ['grounding_rejected', 'low_confidence']) {
 const uncertain={...opts,imageDecision:{...opts.imageDecision,classificationFailure:undefined,classificationOutcome}};
 assert.equal((await maybeCreateGuestChatImagePlaceholder(db,uncertain)).directive?.reason,'classification_unavailable');
 assert.equal((await resolveChatImageReplyDirective(db,{...uncertain,userDisplayOrder:10}))?.reason,'classification_unavailable');
 assert.equal(await resolveChatImageReplyDirective(db,{...uncertain,jevDecision:{ok:true,imageIntent:'none'}}),null);
}
