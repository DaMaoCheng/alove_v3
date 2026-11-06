import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('No external calls');};
const {resolveTrustedCurrentProductSizing}=await import('../server/product-sizing-context-service.js');
const {normalizeLanguageAssessment,assessIndependentLanguageQuality}=await import('../server/chat-language-quality-service.js');
const site={id:'shop',slug:'shop'},character={id:'guide',category_id:'mascot',site_id:'shop'};
const card={id:'p',productId:'p',name:'Kids shirt',siteId:'shop',siteSlug:'shop'};
const product=await resolveTrustedCurrentProductSizing({site,product:card,resolveProduct:async()=>({resolvedFromSource:true,site,sourceItem:{...card,sizeChartResolved:true,sizeChart:{columns:['Size','Length','Chest'],rows:[['28','62-6','89-94']],unit:''}}})});
const sizingReviewContext={character,trustedSite:site,sizingRequired:true,searchIntent:{commerceRoute:'product_question',commerceTopic:'sizing'},productContext:{sourceType:'product_api',sourceRef:'current-product-sizing-context',siteId:'shop',siteSlug:'shop',searchOutcome:'matched',products:[],sizingProduct:product}};
const text='La tabla da largo 62-6; no indica unidades.';
const result={languageQualitySupported:false,retainedLanguageQualitySupported:false,languageQualityConfidence:.9,languageIssues:[{type:'spelling',severity:'major',field:'both',span:'62-6'}]};
const input={text,speechText:text,sizingReviewContext};
assert.equal(normalizeLanguageAssessment(result,input).languageQualitySupported,true,'An exact factory-proven numeric source quotation is not a spelling failure');
for(const options of [
 {...input,sizingReviewContext:null},
 {...input,sizingReviewContext:{...sizingReviewContext,productContext:JSON.parse(JSON.stringify(sizingReviewContext.productContext))}},
 {...input,sizingReviewContext:{...sizingReviewContext,trustedSite:{...site,id:'foreign'}}},
 {...input,sizingReviewContext:{...sizingReviewContext,sizingRequired:false}},
]) assert.equal(normalizeLanguageAssessment(result,options).languageQualitySupported,false,'No global numeric exception or client-shaped chart authority');
for(const type of ['grammar','coherence','wrong_language','unverifiable']) assert.equal(normalizeLanguageAssessment({...result,languageIssues:[{...result.languageIssues[0],type}]},input).languageQualitySupported,false,'Literal provenance cannot bypass other language failures');
assert.equal(normalizeLanguageAssessment({...result,languageIssues:[]},input).languageQualitySupported,false,'An unexplained refusal stays rejected');
assert.equal(normalizeLanguageAssessment({...result,languageIssues:[{...result.languageIssues[0],span:'La tabla'}]},input).languageQualitySupported,false,'Surrounding language is not protected');
assert.equal(normalizeLanguageAssessment({...result,languageIssues:[{...result.languageIssues[0],span:'62'}]},input).languageQualitySupported,false,'A substring is not the exact quoted source value');
let calls=0,body;
const assessed=await assessIndependentLanguageQuality({...input,userText:'What does the chart say?',language:'es',config:{id:'fixture',apiKey:'fixture',model:'fixture-review',apiMode:'chat_completions',baseUrl:'https://fixture.invalid'},recordLog:async()=>{},fetchImpl:async(_url,request)=>{calls++;body=JSON.parse(request.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));}});
assert.equal(calls,1,'Literal handling uses the same one language review');
assert.equal(assessed.languageQualitySupported,true);
const packet=JSON.parse(body.messages.at(-1).content);
assert.deepEqual(packet.literalSourceSpans,['62-6'],'Only a bounded actual source value present in this reply is sent');
assert(!packet.literalSourceSpans.includes('89-94'),'An unused source value is not included');
console.log('Trusted sizing literals: same-review raw numeric quote, fake-source/foreign isolation and ordinary language failures passed');
