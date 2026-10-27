import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';process.env.VENICE_API_KEY='isolated';process.env.TYPESAFE_API_KEY='';
const {classifyChatImageIntent}=await import('../server/chat-image-intent-classifier-service.js');
const text='La quiero en manga corta. Muéstrame la candidata y dime si el nombre del catálogo es diferente.';
globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({hasIntent:true,allowed:true,confidence:.99,intentType:'try_on',communicativeAction:'request_visual_output',requestKind:'character_image',imageSubject:'character',requestEvidence:'Muéstrame la candidata',explicitGeneration:true,wants_clothing:true,wants_no_clothing:false})}}]})});
const result=await classifyChatImageIntent(text,{character:{id:'mascot_test',category_id:'mascot'},jevDecision:{ok:false,confident:false}});
assert.equal(result.hasIntent,false,'catalogue viewing span alone cannot establish an independently requested depicted actor');
console.log('image reference routing reproduced and guarded');
const {applyChatImageCommercePolicy}=await import('../server/chat-image-commerce-policy-service.js');
const role={actionEvidence:'Wear this shirt',actorEvidence:'Wear',hasIntent:true,allowed:true,intentType:'try_on',conditions:{wants_clothing:true,wants_no_clothing:false},clothingTarget:'catalogue_product'};
const commerceIntent={commerceRoute:'product_search'};
const context={commerceIntent,siteId:'site_a',characterId:'mascot_test',recentMessages:[]};
assert.equal(applyChatImageCommercePolicy(role,context).hasIntent,false,'unresolved real merchandise must defer before quota');
const actual={id:'product_a',siteId:'site_a',siteSlug:'store',name:'Real Madrid shirt',imageUrl:'https://img.example.test/shirt.jpg'};
context.recentMessages=[{senderType:'character',characterId:'mascot_test',contentType:'product',product:actual}];
assert.deepEqual(applyChatImageCommercePolicy(role,context).referenceProduct.id,'product_a');
assert.equal(applyChatImageCommercePolicy(role,{...context,siteId:'other_site'}).hasIntent,false,'cross-site product cannot reference');
assert.equal(applyChatImageCommercePolicy(role,{...context,recentMessages:[{contentType:'product',product:{...actual,matchStatus:'candidate'}}]}).hasIntent,false,'unconfirmed candidate cannot reference');
const persisted = { version:1,status:'active',siteId:'site_a',characterId:'mascot_test',owner:'single',
  targetEvidence:'Real Madrid shirt',requirements:{requestedTeam:'Real Madrid',requestedProductType:'shirt'},
  proposal:{status:'confirmed',candidateId:'product_a',name:actual.name,reply:'Is this the shirt?',confirmationEvidence:'Yes, this shirt.'} };
const candidateCard={senderType:'character',characterId:'mascot_test',contentType:'product',product:{...actual,matchStatus:'candidate'}};
const provisionalIntent={...commerceIntent,confirmedCandidateId:'product_a',productCandidateState:persisted};
const ordinaryOwned={...persisted,proposal:null};
assert.equal(applyChatImageCommercePolicy(role,{...context,characterId:'mascot_test',commerceIntent:{...commerceIntent,productCandidateState:ordinaryOwned},
  recentMessages:[{...candidateCard,product:{...actual,matchStatus:'matched'}},{senderType:'character',productCandidateState:ordinaryOwned}]}).hasIntent,true,
  'Ordinary exact matched products do not require a candidate proposal to be confirmed');

for(const status of ['displayed','rejected']) {
  const notReviewed={...persisted,proposal:{...persisted.proposal,status}};
  assert.equal(applyChatImageCommercePolicy(role,{...context,characterId:'mascot_test',commerceIntent:provisionalIntent,
    recentMessages:[candidateCard,{senderType:'character',productCandidateState:notReviewed}]}).hasIntent,false,
    'Current provisional confirmation cannot authorize image generation before whole review');
}
for(const prior of [null,{...persisted,status:'cleared'}, {...persisted,siteId:'other_site'}, {...persisted,characterId:'other_character'}]) {
  const history=prior?[candidateCard,{senderType:'character',productCandidateState:prior}]:[candidateCard];
  assert.equal(applyChatImageCommercePolicy(role,{...context,characterId:'mascot_test',commerceIntent:provisionalIntent,recentMessages:history}).hasIntent,false,
    'Missing, cleared and foreign confirmed states cannot authorize candidate image');
}
for(const current of [{...persisted,status:'cleared'}, {...persisted,proposal:null}, {...persisted,proposal:{...persisted.proposal,status:'rejected'}}]) {
  assert.equal(applyChatImageCommercePolicy(role,{...context,characterId:'mascot_test',commerceIntent:{...provisionalIntent,productCandidateState:current},
    recentMessages:[candidateCard,{senderType:'character',productCandidateState:persisted}]}).hasIntent,false,'Current revocation cannot reuse historical confirmation');
}

assert.equal(applyChatImageCommercePolicy(role,{...context,characterId:'mascot_test',commerceIntent:provisionalIntent,
  recentMessages:[candidateCard,{senderType:'character',productCandidateState:persisted}]}).hasIntent,true,'Historically persisted reviewed confirmation can reference');

assert.equal(applyChatImageCommercePolicy({...role,clothingTarget:'generic'},{...context,commerceIntent:{commerceRoute:'chat'}}).hasIntent,true,'independent general outfit preserved');
assert.equal(applyChatImageCommercePolicy({...role,clothingTarget:'generic',actorEvidence:'Alba',actionEvidence:'wear a casual outfit'},{...context,userText:'Alba, wear a casual outfit and find a Madrid shirt',characterName:'Alba'}).hasIntent,true,'named independent general outfit preserved');
assert.equal(applyChatImageCommercePolicy({...role,clothingTarget:'user_upload'},context).hasIntent,true,'supplied garment upload preserved');
assert.equal(applyChatImageCommercePolicy({...role,intentType:'library_photo',conditions:{wants_clothing:false,wants_no_clothing:false}},context).hasIntent,true,'mixed selfie preserved');
const {createChatIntentTurn}=await import('../server/chat-intent-turn-service.js');
const turn=createChatIntentTurn();let calls=0;
const options={userText:'one shirt',classifyCommerce:async()=>{calls++;return {confident:true,confidence:1,route:'chat'};}};
await Promise.all([turn.resolveCommerce(options),turn.resolveCommerce(options)]);
assert.equal(calls,1,'same request must classify commerce only once');
console.log('image commerce admission self-check passed: no image jobs, DB writes or external calls');
const {maybeCreateGuestChatImagePlaceholder}=await import('../server/chat-image-generation-service.js');
globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({hasIntent:true,allowed:true,confidence:.99,intentType:'try_on',communicativeAction:'request_visual_output',requestKind:'character_image',imageSubject:'character',requestEvidence:'Muéstrame la candidata',actorEvidence:'Muéstrame',actionEvidence:'Muéstrame la candidata',clothingTarget:'catalogue_product',explicitGeneration:true,wants_clothing:true,wants_no_clothing:false})}}]})});
const denied=await maybeCreateGuestChatImagePlaceholder({execute:()=>{throw new Error('must defer before DB/quota');}},{character:{id:'mascot_test',category_id:'mascot'},userText:text,jevDecision:{ok:false,confident:false},commerceIntent,commerceSiteId:'site_a',recentMessages:[]});
assert.equal(denied.taskCreated,false);assert.equal(denied.trigger.deferredToProduct,true,'even a confident semantic mistake with distinct actor text cannot use avatar-only reference');
assert.equal(applyChatImageCommercePolicy(role,{...context,commerceIntent:{...commerceIntent,commerceRoute:'unclear'}}).hasIntent,false,'uncertain current target cannot reuse old product');
console.log('image quota admission entry guarded against false-positive classification');
const candidateView={...role,actionEvidence:'Muéstrame la candidata',actorEvidence:'Muéstrame',clothingTarget:'generic'};
assert.equal(applyChatImageCommercePolicy(candidateView,{...context,userText:text}).hasIntent,false,'false generic cannot bypass reference admission');
assert.equal(applyChatImageCommercePolicy({...candidateView,clothingTarget:'catalogue_product'},{...context,commerceIntent:{...commerceIntent,confirmedCandidateId:'product_a'}}).hasIntent,false,'confirmed catalogue product viewing still is not a try-on');
assert.equal(applyChatImageCommercePolicy({...candidateView,actorEvidence:'Alba'},{...context,userText:'Alba, Muéstrame la candidata',characterName:'Alba'}).hasIntent,false,'named candidate viewing is not a role depiction action');
assert.equal(applyChatImageCommercePolicy(role,{...context,commerceIntent:null}).hasIntent,false,'typed real product request cannot bypass coordinator');
const unknownSource=applyChatImageCommercePolicy(role,{...context,commerceIntent:null,recentMessages:[]});
assert.equal(unknownSource.hasIntent,true,'no catalogue context retains the character-photo question');
assert.equal(unknownSource.allowed,false,'missing coordinator never grants photo permission');
assert.equal(unknownSource.reason,'appearance_uncertain');
assert.equal(unknownSource.referenceProduct,undefined,'uncertainty cannot invent a catalogue reference');
assert.equal(applyChatImageCommercePolicy(role,{...context,commerceIntent:{...commerceIntent,requestedTeam:'Arsenal'}}).hasIntent,false,'new team cannot use older Madrid reference');
const generic={...role,clothingTarget:'generic',actorEvidence:'Alba',actionEvidence:'wear a casual outfit'};
assert.equal(applyChatImageCommercePolicy(generic,{...context,characterName:'Alba',userText:'Alba, wear a casual outfit',commerceIntent:{...commerceIntent,imageProductEvidence:['wear a casual outfit']}}).hasIntent,false,'same product and role action span cannot establish independent outfit');
console.log('adversarial generic, confirmed viewing, wrong entity and null-coordinator probes passed');
assert.equal(applyChatImageCommercePolicy({...candidateView,intentType:'library_photo',conditions:{wants_clothing:false,wants_no_clothing:false}},{...context,userText:text}).hasIntent,false,'false non-clothing library photo cannot bypass candidate-view gate');
for(const actionEvidence of ['Vedd fel ezt a mezt','Bu formayı giyer misin?']) {
 assert.equal(applyChatImageCommercePolicy({...role,actionEvidence},{...context,userText:actionEvidence}).hasIntent,true,'existing semantic wear fastpath preserved: '+actionEvidence);
}
console.log('non-clothing false photo and existing Hungarian/Turkish wear probes passed');
const {prepareChatIntentTurn}=await import('../server/chat-intent-turn-service.js');
const db={execute:async()=>[[]]};let commerceCalls=0,imageCalls=0;
const prepOptions={session:{id:'fixture'},character:{id:'mascot_fixture',category_id:'mascot'},userText:'ordinary message',siteId:'site_a',siteSlug:'store',commerceForImageOnly:true,classify:async()=>({ok:true,confident:true,imageIntent:'none'}),classifyCommerce:async()=>{commerceCalls++;return {confident:true,confidence:1,route:'chat'};},classifyImage:async()=>{imageCalls++;return {hasIntent:false,allowed:false};}};
const noImage=await prepareChatIntentTurn(db,prepOptions);
assert.equal(commerceCalls,0,'initial non-image persist cannot add a second HTTP commerce call');
await noImage.resolveCommerce({classifyCommerce:prepOptions.classifyCommerce});
assert.equal(commerceCalls,1,'reply phase resolves only its required commerce decision');
const admitted=await prepareChatIntentTurn(db,{...prepOptions,classifyImage:async()=>{imageCalls++;return {...role,hasIntent:true,allowed:true};}});
assert.equal(commerceCalls,2,'actual initial image positive coordinates exactly once before admission');
await admitted.resolveCommerce({classifyCommerce:prepOptions.classifyCommerce});
assert.equal(commerceCalls,2,'guest same-turn image and reply phases reuse one commerce decision');
assert.equal(imageCalls,2,'initial independent image verification is not repeated');
console.log('initial persist and reply coordination reuse probes passed');
