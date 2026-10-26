import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('External calls forbidden');};
const {normalizeProductRequirementDecision,applyProductCandidateState}=await import('../server/product-candidate-state-service.js');
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {normalizeCommerceDecision}=await import('../server/product-intent-classifier-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const requirement=(text,terms,action='new')=>({action,evidence:text,updates:[{field:'requestedKeywords',value:terms,evidence:text}],suspectedTerm:null});
assert(normalizeProductRequirementDecision(requirement('Busco una camiseta retro de Ronaldo',['Ronaldo']),{userText:'Busco una camiseta retro de Ronaldo'}));
for(const text of ['Cristiano Ronaldo','Kylian Mbappé','李小龙','C. Ronaldo']){
  const r=normalizeProductRequirementDecision(requirement(text,[text]),{userText:text});assert(r);assert.deepEqual(r.updates[0].value,[text]);assert.deepEqual(normalizeProductRequirementDecision(r,{userText:text}),r,'normalization must remain idempotent with exact case evidence');
}
for(const [user,term] of [['Ronaldo','Cristiano Ronaldo'],['姆巴佩','Mbappe'],['a shirt','Ronaldo'],['Ronaldo','aldo']]) assert.equal(normalizeProductRequirementDecision(requirement(user,[term]),{userText:user}),null,'only entire current literal words/phrases can constrain');
assert.equal(normalizeProductRequirementDecision(requirement('same one',[],'continue'),{userText:'same one'}),null,'empty identity arrays cannot silently clear names');
assert.equal(normalizeProductRequirementDecision(requirement('Ronaldo',['Ronaldo']),{userText:'same one'}),null,'past USER or assistant evidence is not CURRENT evidence');
const base={commerceRoute:'product_search',requestedProductType:'shirt',requestedAudience:'kids',requestedVariants:['retro'],requestedKeywords:['cristiano','ronaldo'],shouldLoadProductContext:true,cardAllowed:true,replyBoundary:{salesAllowed:true}};
const loc={siteId:'keyword-site',characterId:'keyword-character'};
const first=applyProductCandidateState(base,{confident:true,productRequirement:requirement('Ronaldo',['Ronaldo'])},{...loc,userText:'Ronaldo',recentMessages:[]});assert.deepEqual(first.requestedKeywords,['ronaldo']);
const next=applyProductCandidateState(base,{confident:true,productRequirement:{action:'continue',evidence:'talla 24',updates:[{field:'requestedSizes',value:['24'],evidence:'talla 24'}],suspectedTerm:null}},{...loc,userText:'talla 24',recentMessages:[{senderType:'character',productCandidateState:first.productCandidateState}]});assert.deepEqual(next.requestedKeywords,['ronaldo']);assert.deepEqual(next.requestedVariants,['retro']);
const primary={ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:.99};
async function route(text,typed,query='Cristiano Ronaldo retro kids shirt'){
 const v={route:'product_search',confidence:.99,topic:'other',needsLiveProductData:true,searchQuery:query,knowledgeScope:'business',knowledgeQuery:'',answerRequired:true,knowledgeRequest:{kind:'catalogue_only',evidence:text},replyBoundary:{salesAllowed:true,contactAllowed:true},productRequest:{relation:'single',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:typed};
 return resolveCommerceSearchIntent({userText:text,searchIntent:buildProductSearchIntent(text),enrichAllTurns:true,siteId:loc.siteId,characterId:loc.characterId,jevDecision:primary,classifyCommerce:async()=>normalizeCommerceDecision(v,{userText:text})});
}
const typed=await route('Busco una camiseta retro de Ronaldo para niña',requirement('Busco una camiseta retro de Ronaldo para niña',['Ronaldo']));assert.deepEqual(typed.requestedKeywords,['ronaldo']);assert.equal(typed.cardAllowed,true);assert(typed.query.includes('Cristiano'),'query remains retrieval hint');
const full=await route('Cristiano Ronaldo retro kids shirt',requirement('Cristiano Ronaldo retro kids shirt',['Cristiano Ronaldo']));assert.deepEqual(full.requestedKeywords,['cristiano ronaldo']);
const undercomplete=await route('Cristiano Ronaldo retro kids shirt',requirement('Cristiano Ronaldo retro kids shirt',['Ronaldo']));assert.deepEqual(new Set(undercomplete.requestedKeywords),new Set(['cristiano','ronaldo']),'partial typed names cannot weaken actual-user-backed query terms');
const legacyOmission=await route('Cristiano Ronaldo retro kids shirt',requirement('Cristiano Ronaldo retro kids shirt',['Ronaldo']),'Ronaldo retro kids shirt');assert.deepEqual(legacyOmission.requestedKeywords,['ronaldo'],'query AND typed firstname omission is a preexisting undetected-name limitation, not a full proper-name detector');
const typo=await route('Real Madrid fun shirt',{...requirement('Real Madrid fun shirt',['fun']),suspectedTerm:{value:'fun',evidence:'fun'}},'Real Madrid fan shirt');assert(typo.requestedKeywords.includes('fun'),'suspected literal spelling survives');
const legacy=await route('Ronaldo retro kids shirt',{action:'new',evidence:'Ronaldo retro kids shirt',updates:[],suspectedTerm:null});assert(legacy.requestedKeywords.includes('cristiano'),'optional missing delta keeps legacy behavior rather than claiming corrected provenance');
console.log('keyword provenance self-check passed: literal current-user names, bounded typed priority, continuations, typo state and legacy fallback; no network/model/DB');

const translatedAlias=await route('C罗儿童复古球衣',requirement('C罗儿童复古球衣',['C罗']),'Ronaldo retro kids shirt');
assert.deepEqual(translatedAlias.requestedKeywords,['ronaldo'],'non-Latin aliases retain the existing canonical query behavior rather than becoming new untranslated hard filters');
