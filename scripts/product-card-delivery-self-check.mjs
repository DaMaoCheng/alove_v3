import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const moduleAt = name => import(pathToFileURL(resolve('server', name)));
const { buildProductContextLayer } = await moduleAt('chat-prompt-layers.js');
const { buildReplyReviewMessages } = await moduleAt('chat-reply-review-contracts.js');
const selector = await moduleAt('chat-product-reply-service.js');
const products = [
  { id:'home',name:'Barcelona Home Shirt',siteId:'shop',url:'https://example.test/home',price:'30',available:true },
  { id:'away',name:'Barcelona Away Shirt',siteId:'shop',url:'https://example.test/away',price:'32',available:true },
];
const context = {siteId:'shop',siteSlug:'fixture',sourceType:'product_api',sourceRef:'site-product-context',products,
  cardAllowed:true,searchOutcome:'matched',searchIntent:{query:'Barcelona shirt',requestedTeam:'Barcelona',requestedProductType:'shirt'}};
const before = JSON.stringify(context);
const character = {id:'mascot_fixture',categoryId:'mascot'};
// The baseline incorrectly promises one card for every listed catalogue result.
const layer = buildProductContextLayer(character,context,'Show a Barcelona shirt');
assert(!layer.content.includes('one product card for each confirmed product'), 'raw catalogue results must not be promised as displayed cards');
assert.equal(typeof selector.buildProductCardDeliveryContext,'function');
assert.equal(typeof selector.selectProductsForReply,'function');
const {buildProductCardDeliveryContext:delivery,selectProductsForReply:finalSelection,suppressRepeatedProductCards:dedup} = selector;
let checks=0;
const check=(value,why)=>{assert(value,why);checks++;};
check(delivery(context).count===1 && delivery(context).cards[0].id==='home','ordinary pool of two has one prospective card');
check(layer.content.includes('"count":1') && layer.content.includes('"id":"home"'),'generation receives exact selected one');
check(layer.content.includes('Barcelona Away Shirt'),'other catalogue facts are preserved as facts, not cards');
const pair={...context,searchIntent:{...context.searchIntent,requestedVariants:['home','away']}};
check(delivery(pair).count===2 && delivery(pair).cards[1].id==='away','explicit home/away pair remains two in original order');
const suppressed=dedup(context,{recentMessages:products.map(product=>({product})),userText:'What is the price?'});
check(delivery(suppressed).count===0,'all previously shown cards remain suppressed');
const suppressedPrompt=buildProductContextLayer(character,suppressed,'What is the price?');
check(suppressedPrompt.content.includes('No new product card will be sent') && suppressedPrompt.content.includes('price: 30'),'suppression preserves price facts and prohibits new-card wording');
const oneSuppressed=dedup(context,{recentMessages:[{product:products[0]}],userText:'Another option?'});
check(delivery(oneSuppressed).count===1 && delivery(oneSuppressed).cards[0].id==='away','dedup keeps existing selection from remaining pool');
check(delivery(dedup(context,{recentMessages:products.map(product=>({product})),userText:'Send it again'})).count===1,'explicit resend preserves existing permission');
const noCard={...context,cardAllowed:false};
check(delivery(noCard).count===0 && buildProductContextLayer(character,noCard,'What is the price?').content.includes('price: 30'),'no-card question retains original factual answer');
check(delivery({...context,products:products.map(p=>({...p,canonicalEdition:'fan'})),searchIntent:{...context.searchIntent,requestedEdition:'player'}}).count===0,'edition hard filter is still owned by original selector');
const candidate={...context,searchOutcome:'candidate',candidateContext:{requiresConfirmation:true},products:[products[0]]};
check(delivery(candidate).cards[0].matchStatus==='candidate','delivery facts never upgrade a candidate to matched');
check(finalSelection(candidate,{candidateEvidenceVerified:false}).length===0 && finalSelection(candidate,{candidateEvidenceVerified:true}).length===1,'final candidate evidence gate preserved');
for(const reply of [{productScopeVerified:false},{replyBoundary:{salesAllowed:false}},{degradationReason:'ai_request_failed_fallback'}]) {
  check(finalSelection(context,reply).length===0,'failed scope, sales and transport cannot acquire a card');
}
check(finalSelection(context,{}).length===1,'ordinary reviewed reply retains existing selection');
const packet=JSON.parse(buildReplyReviewMessages({text:'Here is one card.',userText:'Show a Barcelona shirt',productContext:context,boundaryReviewRequired:true,businessFactsRequired:true}).at(-1).content);
check(packet.productCardDelivery.count===1 && packet.evidence.catalogueProducts.length===2,'review sees exact card delivery separately from full catalogue evidence');
const reviewText=buildReplyReviewMessages({productContext:context,boundaryReviewRequired:true}).filter(m=>m.role==='system').map(m=>m.content).join('\n');
check(reviewText.includes('boundarySupported=false') && reviewText.includes('retained text'),'delivery mismatch uses existing boundary vote including retained text');
check(buildReplyReviewMessages({text:'Hello',boundaryReviewRequired:true}).at(-1).content.includes('"productCardDelivery":null'),'ordinary unrelated dialogue does not gain a delivery contract');
check(delivery({...context,campaign:{id:'campaign_fixture'},products:[{...products[0],campaignId:'campaign_fixture'}]}).count===1,'existing campaign product selection remains unchanged');
check(JSON.stringify(context)===before,'pool, intent, references and input values are not mutated');
const {repairGroundedCommerceReply}=await moduleAt('chat-grounded-reply-repair-service.js');
const matchedIntent={...context.searchIntent,commerceRoute:'product_search',commerceTopic:'other',knowledgeScope:'business',knowledgeQuery:'',
  primarySearchVerified:true,shouldLoadProductContext:true,needsLiveProductData:true,cardAllowed:true,requestedKeywords:[],searchState:'ready_to_search',replyBoundary:{salesAllowed:true,contactAllowed:false}};
let repairPacket=null, repairSystemPrompt="";
const repaired=await repairGroundedCommerceReply({replyResult:{text:'Here are both cards.',speechText:'Here are both cards.',sourceRef:'venice-chat-completions'},
  character:{id:'mascot_fixture',category_id:'mascot',site_id:'shop'},searchIntent:matchedIntent,
  productContext:{...context,searchIntent:matchedIntent},knowledgeContext:{items:[]},reviewStatus:'valid',
  reviewResult:{allowed:false,confidence:.95,boundarySupported:true,businessFactsSupported:false},failedContracts:['business_facts'],language:'en',userText:'Show a Barcelona shirt',
  config:{apiKey:'isolated-fixture',model:'fixture',baseUrl:'https://example.invalid/v1',apiMode:'chat_completions'},recordLog:async()=>{},
  requestText:async prompt=>{repairSystemPrompt=prompt.systemPrompt;repairPacket=JSON.parse(prompt.messages[0].content);return JSON.stringify({displayText:'I like the home look for matchday.'});}});
check(Boolean(repaired) && repairPacket.matchedCatalogue.products.length===2 && repairPacket.matchedCatalogue.productCardDelivery.count===1,'corrective generation receives full verified pool and exact one-card delivery');
check(repairSystemPrompt.includes('Missing attributes that the user did not ask about do not require a disclaimer')
  && repairSystemPrompt.includes('Do not introduce an objective-ranking disclaimer unless the user actually requests an objective ranking'),
  'matched subjective guidance is not converted to unrequested specification or ranking limitations');
check(!repairPacket.requirements.requestedEdition && !repairPacket.requirements.requestedFeatures?.length && !repairPacket.requirements.requestedPrinting,
  'matched preference fixture does not manufacture absent user constraints');
check(!repairSystemPrompt.includes('explicitly identify every relevant unknown requested attribute'),
  'proved matched captions do not inherit unconfirmed-candidate instructions');
let candidateRepairPrompt = '';
const unconfirmed = { ...products[0], matchStatus: 'candidate', candidateUnknownFields: ['sleeve'] };
await repairGroundedCommerceReply({ replyResult: { text: 'The sleeve is confirmed.', sourceType: 'ai' },
  character: { id: 'mascot_fixture', category_id: 'mascot' }, searchIntent: matchedIntent,
  productContext: { ...context, searchIntent: matchedIntent, searchOutcome: 'candidate', products: [unconfirmed],
    candidateContext: { requiresConfirmation: true, products: [{ ...unconfirmed, unknownFields: ['sleeve'] }] } },
  reviewStatus: 'valid', reviewResult: { allowed: false, confidence: .99, boundarySupported: true }, failedContracts: ['evidence'],
  language: 'en', userText: 'I want short sleeves.', config: { apiKey: 'isolated-fixture', model: 'fixture', apiMode: 'chat_completions' },
  requestText: async prompt => { candidateRepairPrompt = prompt.systemPrompt; return '{"displayText":null}'; } });
check(candidateRepairPrompt.includes('explicitly identify every relevant unknown requested attribute'),
  'an actual unconfirmed candidate retains required unknown-attribute disclosure');
check(repaired.productScopeVerified!==true && repaired.candidateEvidenceVerified!==true,'new corrective caption is not an approval or card permission');
console.log(`product card delivery self-check passed: ${checks} deterministic checks; no DB, network or model calls`);
