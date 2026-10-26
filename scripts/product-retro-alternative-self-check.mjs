import assert from 'node:assert/strict';
import {executeProductSearchDetailed} from '../server/product-search-execution-service.js';
import {bindProductAlternativeContext,toAlternativeReviewContext,validateProductAlternativeAudit} from '../server/product-alternative-service.js';
const intent={commerceRoute:'product_search',shouldLoadProductContext:true,cardAllowed:true,candidateSearchAllowed:true,requestedProductType:'shirt',requestedAudience:'kids',requestedVariant:'retro',requestedVariants:['retro'],requestedKeywords:['ronaldo'],query:'Ronaldo retro kids jersey'};
const p=(id,name)=>({productId:id,name,url:'https://shop.example/'+id,available:true});
const kids=p('kids','Kids RONALDO #7 Portugal Home Soccer Jersey World Cup 2026');
let calls=[];
const result=await executeProductSearchDetailed({query:intent.query,searchIntent:intent,fetchProducts:async(_url,i)=>{calls.push(i.query);return[kids,p('adult','RONALDO #7 Portugal Home Jersey 2026'),p('wrong','Kids MESSI #10 Argentina Jersey 2026')];}});
assert.equal(result.alternatives?.[0]?.productId,'kids','a true zero-match retro child request can recommend one verified same-player child alternative');
assert.ok(calls.length<=4);
const context=bindProductAlternativeContext({siteId:'test',searchIntent:intent,searchOutcome:'alternative',products:result.alternatives},result);
const evidence=toAlternativeReviewContext(context);assert.equal(evidence.kind,'retro_alternative');assert.ok(evidence.relaxedFields.includes('requestedVariants'));assert.equal(evidence.alternativeSeason,'2026');
for(const patch of [{requestedTeam:'Real Madrid'},{requestedVariant:'away',requestedVariants:['away','retro']},{requestedAudience:'women'},{requestedPrinting:'none'},{requestedSizes:['XL']},{requestedFeatures:['long_sleeve']}]){
 const r=await executeProductSearchDetailed({query:intent.query,searchIntent:{...intent,...patch},fetchProducts:async()=>[kids]});
 assert.equal(r.alternatives?.length||0,0,JSON.stringify(patch));
}
const homeRetro = await executeProductSearchDetailed({query:intent.query,searchIntent:{...intent,requestedVariant:'home',requestedVariants:['home','retro']},fetchProducts:async()=>[kids]});
assert.equal(homeRetro.alternatives?.[0]?.productId,'kids','home+retro needs retro for exact matches and preserves home for an explicit nonretro alternative');
const wrongRetroAway=await executeProductSearchDetailed({query:intent.query,searchIntent:{...intent,requestedVariant:'home',requestedVariants:['home','retro']},fetchProducts:async()=>[p('retro-away','Kids RONALDO #7 Portugal Retro Away Jersey 2010/11')]});
assert.equal(wrongRetroAway.matches.length,0);assert.equal(wrongRetroAway.candidates.length,0);assert.equal(wrongRetroAway.alternatives?.length||0,0);
const kit= p('kit','Kids RONALDO #7 Portugal Home Soccer Jersey Kit World Cup 2026');
const withKit=await executeProductSearchDetailed({query:intent.query,searchIntent:intent,fetchProducts:async()=>[kit]});
const kitContext=bindProductAlternativeContext({siteId:'test',searchIntent:intent,searchOutcome:'alternative',products:withKit.alternatives},withKit);
assert.equal(toAlternativeReviewContext(kitContext).alternativeGarment,'jersey_kit');
let failures=0;await assert.rejects(executeProductSearchDetailed({query:intent.query,searchIntent:intent,fetchProducts:async()=>{failures++;throw Error('source unavailable')}}),/source unavailable/);assert.equal(failures,1);
const text='Sorry, this search did not find the retro shirt. This alternative is the 2026 catalogue shirt rather than a listed retro model.';
const quote={apologyQuote:'Sorry',originalSearchQuote:'this search did not find the retro shirt.',differenceQuote:'This alternative is the 2026 catalogue shirt rather than a listed retro model.'};
assert.equal(validateProductAlternativeAudit({display:quote,speech:quote,boundedSearchOnly:true},{text,context:evidence}).accepted,true);
console.log('Retro child alternatives preserve player/team/audience/style/attributes, bounded source failures and complete difference audit.');
const {sanitizeProductAlternative}=await import('../shared/product-candidate-fields.js');
assert.deepEqual(sanitizeProductAlternative({kind:'retro_alternative',requestedSeason:'',alternativeSeason:'2026',alternativeGarment:'jersey_kit',secret:'not-public'}),{kind:'retro_alternative',requestedSeason:'',alternativeSeason:'2026',alternativeGarment:'jersey_kit'});
assert.equal(sanitizeProductAlternative({kind:'retro_alternative',requestedSeason:'',alternativeSeason:'invented',alternativeGarment:''}),null);
assert.equal(sanitizeProductAlternative({kind:'retro_alternative',requestedSeason:'',alternativeSeason:'2026',alternativeGarment:'adult'}),null);
for(const patch of [{requestedKeywords:[]},{candidateSearchAllowed:false},{cardAllowed:false},{replyBoundary:{salesAllowed:false}},{productRequestState:{status:'pending',items:[]}}]){
 const r=await executeProductSearchDetailed({query:intent.query,searchIntent:{...intent,...patch},fetchProducts:async()=>[kids]});assert.equal(r.alternatives?.length||0,0);
}
let partial=0;await assert.rejects(executeProductSearchDetailed({query:intent.query,searchIntent:intent,fetchProducts:async()=>{partial++;if(partial===2)throw Error('second recall failed');return[kids];}}),/second recall failed/);assert.equal(partial,2);
console.log('Retro metadata is finite, closed actions and incomplete recalls never authorize an alternative.');
const multiRoles=await executeProductSearchDetailed({query:'Ronaldo child home away retro jerseys',searchIntent:{...intent,requestedTeam:'Portugal',requestedVariants:['home','away','retro']},limit:5,fetchProducts:async()=>[kids,p('away','Kids RONALDO #7 Portugal Away Jersey 2026'),p('retro','Kids RONALDO #7 Portugal Retro Jersey 2010/11')]});
assert.equal(multiRoles.matches.length,3,'independent home/away/retro variant groups retain original union semantics');
const {applyProductCandidateState}=await import('../server/product-candidate-state-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const originalUser='Ronaldo retro kids jersey';
const ungranted={...buildProductSearchIntent(originalUser),commerceRoute:'product_search',cardAllowed:true,shouldLoadProductContext:true,replyBoundary:{salesAllowed:true}};
const semantic={confident:true,productRequirement:{action:'new',evidence:originalUser,updates:[{field:'requestedProductType',value:'shirt',evidence:'jersey'},{field:'requestedAudience',value:'kids',evidence:'kids'},{field:'requestedVariants',value:['retro'],evidence:'retro'}],suspectedTerm:null}};
const route=applyProductCandidateState(ungranted,semantic,{siteId:'test',characterId:'role',userText:originalUser});
assert.equal(route.requestedTeam,'');assert.equal(route.candidateSearchAllowed,true,'authorized named retro query reaches detailed search without inventing a team');
const routedResult=await executeProductSearchDetailed({query:route.query,searchIntent:route,fetchProducts:async()=>[kids]});
assert.equal(routedResult.alternatives?.[0]?.productId,'kids','real candidate-state route reaches the bounded alternate engine');
for(const patch of [{shouldLoadProductContext:false},{replyBoundary:{salesAllowed:false}},{commerceRoute:'store_policy'}]){
 const denied=applyProductCandidateState({...ungranted,...patch},semantic,{siteId:'test',characterId:'role',userText:originalUser});assert.notEqual(denied.candidateSearchAllowed,true);
}
