import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED='false';
globalThis.fetch=async()=>{throw Error('No network allowed')};
const {resolveCommerceSearchIntent}=await import('../server/commerce-routing-service.js');
const {buildProductSearchIntent}=await import('../server/product-intent-service.js');
const {filterProductsBySearchCriteria}=await import('../server/product-search-match-service.js');
const {closeDbPool}=await import('../server/db.js');
const userText='Find red Madrid shirt and blue Barcelona shirt, both size M';
const decision={route:'product_search',confident:true,confidence:.99,searchQuery:userText,replyBoundary:{salesAllowed:true,contactAllowed:true},productRequest:{relation:'multiple',action:'new',items:[{evidence:'red Madrid shirt',sharedEvidence:'both size M'},{evidence:'blue Barcelona shirt',sharedEvidence:'both size M'}],selectedIndex:null,selectionEvidence:''}};
const jev={ok:true,confident:true,primaryIntent:'product_request',productIntent:'search',productAction:.99};
const base={userText,searchIntent:buildProductSearchIntent(userText),siteId:'site',characterId:'character',jevDecision:jev,enrichAllTurns:true};
let checks=0;const check=(x,m)=>{assert.ok(x,m);checks++};
try{
const pending=await resolveCommerceSearchIntent({...base,classifyCommerce:async()=>decision});
check(pending.productScopePending&&!pending.shouldLoadProductContext&&!pending.cardAllowed,'multi-item request must block search before selection');
check(pending.productRequestState.items.length===2,'both items retained');
const recentMessages=[{senderType:'character',productRequestState:pending.productRequestState}];
const chosen=await resolveCommerceSearchIntent({...base,userText:'second',recentMessages,searchIntent:buildProductSearchIntent('second'),classifyCommerce:async()=>({...decision,searchQuery:'Barcelona shirt',productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:1,selectionEvidence:'second'}})});
check(chosen.requestedTeam==='Barcelona'&&chosen.requestedColor==='blue'&&chosen.requestedSizes.includes('M'),'selected item retains own color and shared size');
check(!chosen.query.includes('Madrid'),'selected query contains no other target');
const spanishOriginal='Busco camiseta roja del Madrid y una azul del Barcelona, ambas talla M.';
const spanishItems=[{evidence:'camiseta roja del Madrid',sharedEvidence:'talla M'},{evidence:'una azul del Barcelona',sharedEvidence:'talla M'}];
const spanishPending=await resolveCommerceSearchIntent({...base,userText:spanishOriginal,searchIntent:buildProductSearchIntent(spanishOriginal),classifyCommerce:async()=>({...decision,
 productRequest:{...decision.productRequest,items:spanishItems}})});
const spanish=await resolveCommerceSearchIntent({...base,userText:'segunda',recentMessages:[{senderType:'character',productRequestState:spanishPending.productRequestState}],searchIntent:buildProductSearchIntent('segunda'),classifyCommerce:async()=>({...decision,searchQuery:'Barcelona blue shirt size M',productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:1,selectionEvidence:'segunda'}})});
const mismatchedOriginal=await resolveCommerceSearchIntent({...base,userText:'segunda',recentMessages:[{senderType:'character',productRequestState:{...spanishPending.productRequestState,originalUserText:pending.productRequestState.originalUserText}}],searchIntent:buildProductSearchIntent('segunda'),classifyCommerce:async()=>({...decision,searchQuery:'Barcelona blue shirt size M',productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:1,selectionEvidence:'segunda'}})});
check(!mismatchedOriginal.shouldLoadProductContext&&!mismatchedOriginal.cardAllowed,'Spanish item excerpts cannot borrow an unrelated English original USER request');
check(spanish.requestedTeam==='Barcelona'&&spanish.requestedColor==='blue'&&spanish.requestedSizes.includes('M'),'existing semantic query retains selected non-English conditions absent in lexical parser');
check(filterProductsBySearchCriteria([{name:'Barcelona blue shirt',sizes:['M']}],spanish.query,spanish).length===1,'selected translated scope does not filter a valid catalogue item with raw non-English keywords');
for(const productRequest of [undefined,{...decision.productRequest,items:[{evidence:'invented'}, {evidence:'blue Barcelona shirt'}]},{...decision.productRequest,items:Array.from({length:5},()=>({evidence:'red Madrid shirt'}))}]){
const invalid=await resolveCommerceSearchIntent({...base,classifyCommerce:async()=>({...decision,productRequest})});check(!invalid.shouldLoadProductContext&&!invalid.cardAllowed,'invalid schema cannot search first item');}
for(const relation of ['single','alternative','comparison']){
const normal=await resolveCommerceSearchIntent({...base,classifyCommerce:async()=>({...decision,productRequest:{relation,action:'new',items:[],selectedIndex:null,selectionEvidence:''}})});check(normal.shouldLoadProductContext&&normal.cardAllowed,'other relations preserve prior permissions');}
const blocked=await resolveCommerceSearchIntent({...base,jevDecision:{...jev,primaryIntent:'order_lookup',productIntent:'none'},recentMessages,userText:'second',classifyCommerce:async()=>({...decision,productRequest:{relation:'multiple',action:'select',selectedIndex:1,selectionEvidence:'second'}})});
check(!blocked.shouldLoadProductContext&&!blocked.cardAllowed,'selection cannot override JEV');
const conflict=await resolveCommerceSearchIntent({...base,userText:'second red size L',recentMessages,searchIntent:buildProductSearchIntent('second red size L'),classifyCommerce:async()=>({...decision,searchQuery:'Barcelona blue shirt size M',productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:1,selectionEvidence:'second'}})});
check(conflict.productScopePending&&!conflict.shouldLoadProductContext&&!conflict.cardAllowed,'catalogue query cannot contradict explicit current selected conditions');
const selectedHistory=[{senderType:'character',productRequestState:chosen.productRequestState}];
const facts=await resolveCommerceSearchIntent({...base,userText:'What is the price?',recentMessages:selectedHistory,searchIntent:buildProductSearchIntent('What is the price?'),classifyCommerce:async()=>({...decision,route:'product_question',needsLiveProductData:true,searchQuery:'Barcelona blue shirt size M',replyBoundary:{salesAllowed:false,contactAllowed:true},productRequest:{relation:'multiple',action:'continue',items:[],selectedIndex:null,selectionEvidence:'What is the price?'}})});
check(facts.shouldLoadProductContext&&!facts.cardAllowed,'selected factual lookup remains separate from recommendation permission');
const printOriginal='Arsenal shirt number 10 and Barcelona shirt';
const printPending=await resolveCommerceSearchIntent({...base,userText:printOriginal,searchIntent:buildProductSearchIntent(printOriginal),classifyCommerce:async()=>({...decision,
 productRequest:{...decision.productRequest,items:[{evidence:'Arsenal shirt number 10',sharedEvidence:''},{evidence:'Barcelona shirt',sharedEvidence:''}]}})});
const printChosen=await resolveCommerceSearchIntent({...base,userText:'first',recentMessages:[{senderType:'character',productRequestState:printPending.productRequestState}],searchIntent:buildProductSearchIntent('first'),classifyCommerce:async()=>({...decision,searchQuery:'Arsenal shirt number 10',productRequest:{relation:'multiple',action:'select',items:[],selectedIndex:0,selectionEvidence:'first'}})});
const printHistory=[{senderType:'character',productRequestState:printChosen.productRequestState}];
const noPrint=await resolveCommerceSearchIntent({...base,userText:'No printing',recentMessages:printHistory,searchIntent:buildProductSearchIntent('No printing'),classifyCommerce:async()=>({...decision,searchQuery:'Arsenal shirt',productRequest:{relation:'multiple',action:'continue',items:[],selectedIndex:null,selectionEvidence:'No printing'}})});
check(noPrint.customizationRequest===''&&noPrint.requestedPrintNumber===''&&!noPrint.productCustomizationRequest,'current explicit removal uses existing clear-fields parser');
const resumed=await resolveCommerceSearchIntent({...base,userText:'Continue',recentMessages:[{senderType:'character',productRequestState:noPrint.productRequestState}],searchIntent:buildProductSearchIntent('Continue'),classifyCommerce:async()=>({...decision,searchQuery:'Arsenal shirt',productRequest:{relation:'multiple',action:'continue',items:[],selectedIndex:null,selectionEvidence:'Continue'}})});
check(resumed.requestedPrintNumber===''&&!resumed.productCustomizationRequest,'explicit removal survives durable state continuation');
console.log(`product scope routing: ${checks} checks passed`);
}finally{await closeDbPool();}
