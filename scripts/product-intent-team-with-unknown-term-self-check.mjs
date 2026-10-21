import assert from 'node:assert/strict';
import { buildProductSearchIntent } from '../server/product-intent-service.js';
import { executeProductSearch } from '../server/product-search-execution-service.js';
for (const team of ['Inter Miami', 'Boca Juniors', 'Seattle Sounders', 'Kawasaki Frontale']) {
  const intent = buildProductSearchIntent(`I am looking for ${team} xyzplayer`);
  assert.equal(intent.shouldLoadProductContext, true);
  const calls = [];
  const rows = await executeProductSearch({ query: intent.query, searchIntent: intent, productApiUrl: 'ttmall://example.invalid?websiteId=6', includePublicSearchFallback: false,
    fetchProducts: async (_, request) => {
      calls.push(request.query);
      return request.query.toLowerCase() === team.toLowerCase() ? [{id:'1', name:`${team} Home Soccer Jersey 2026`, url:'https://example.invalid/1', imageUrl:'https://example.invalid/1.png'}] : [];
    } });
  assert.equal(rows.length, 1, `${team}: ${calls.join(',')}`);
  assert.deepEqual(rows[0].unmatchedSearchTerms, ['xyzplayer']);
}
console.log('global unknown-team product search: PASS');
for (const team of ['Arsenal','Real Madrid']) {
 const intent = buildProductSearchIntent(`I am looking for ${team} xyzplayer`);
 const rows = await executeProductSearch({query:intent.query, searchIntent:intent, includePublicSearchFallback:false,
 fetchProducts:async()=>[{id:'2',name:`${team} Home Soccer Jersey 2026`}]});
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0].unmatchedSearchTerms,['xyzplayer']);
}
const constrained = buildProductSearchIntent('I am looking for Boca Juniors black away jersey xyzplayer');
const wrong = await executeProductSearch({query:constrained.query,searchIntent:constrained,includePublicSearchFallback:false,
 fetchProducts:async()=>[{id:'3',name:'Boca Juniors Red Home Soccer Jersey 2026'},{id:'4',name:'Arsenal Black Away Soccer Jersey 2026'}]});
assert.equal(wrong.length,0,'must preserve color/variant and unknown catalogue anchor');
for (const text of ['Who won the Boca Juniors match?', 'Shipping time for Boca Juniors jerseys?', 'I am looking for order tracking']) {
 assert.equal(buildProductSearchIntent(text).shouldLoadProductContext,false,text);
}
const exactIntent=buildProductSearchIntent('I am looking for Boca Juniors messi');
let requests=0;
const exactRows=await executeProductSearch({query:exactIntent.query,searchIntent:exactIntent,limit:1,includePublicSearchFallback:false,
fetchProducts:async()=>{requests++;return [{id:'5',name:'Boca Juniors Messi Soccer Jersey'}];}});
assert.equal(requests,1);
assert.equal(exactRows[0].unmatchedSearchTerms,undefined);
console.log('constraints, exact priority, non-shopping: PASS');
