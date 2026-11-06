import assert from 'node:assert/strict';
import {knowledgeSentenceSpans, selectedKnowledgeEvidence, projectKnowledgeEvidence, selectedSourceRelations, knowledgeEvidenceModelContent} from '../server/knowledge-evidence-projection.js';
import {selectBusinessKnowledgeReferences} from '../server/business-knowledge-selection-service.js';
import {buildKnowledgeContextLayer} from '../server/chat-prompt-layers.js';
const content = 'Processing usually takes three days. Customized items may take longer. Report missing parcels within forty-five days. Unworn returns are accepted within fourteen days.';
const spans=knowledgeSentenceSpans(content);
const match={id:'policy',quote:spans[0].text,answersQuestion:true,confidence:.99,answerSentenceIds:['s0'],qualificationSentenceIds:['s1']};
const result=await selectBusinessKnowledgeReferences({query:'When will my paid order ship?',sections:[{id:'policy',content}],select:async input=>input.stage==='directory'?{ids:['policy']}:{matches:[match]}});
const item=result.items[0], projection=projectKnowledgeEvidence(item);
assert(projection.scoped);assert.equal(item.sourceContent,content);
assert(projection.content.includes(spans[1].text),'Adjacent exception retained');
assert(!projection.content.includes('forty-five'),'Unasked reporting deadline excluded');
const layer=buildKnowledgeContextLayer({customerServiceIntent:true,items:[item]});
assert(!layer.content.includes('forty-five'));assert(layer.content.includes(spans[1].text));
const explicit=selectedKnowledgeEvidence(content,{answerSentenceIds:['s2'],qualificationSentenceIds:[]});
assert(projectKnowledgeEvidence({sourceContent:content,answerEvidence:explicit}).content.includes('forty-five'));
const mixed=selectedKnowledgeEvidence(content,{answerSentenceIds:['s0','s3'],qualificationSentenceIds:['s1']});
assert.equal(mixed.length,3);assert(!mixed.some(x=>x.id==='s2'));
for(const bad of [[{id:'s99',text:'Made up',role:'answer'}],[{id:'s0',text:'Guaranteed tomorrow',role:'answer'}],[]])assert.equal(projectKnowledgeEvidence({sourceContent:content,answerEvidence:bad}).content,'');
assert.equal(projectKnowledgeEvidence({content}).content,content,'Legacy/general retained');
assert.equal(selectedKnowledgeEvidence(content,{answerSentenceIds:['s0'],qualificationSentenceIds:['s0']}),null);
console.log('Knowledge projection checks passed: selected answer, adjacent condition, explicit deadline, mixed question, invalid span and legacy boundary');


const relationContent = 'Packing takes two days. After packing, transit takes three days. Contact support within thirty days.';
const relationMatch = {answerSentenceIds:['s0','s1'],qualificationSentenceIds:[],sourceRelations:[{type:'sequence',fromSentenceId:'s0',toSentenceId:'s1',quote:'Packing takes two days. After packing, transit takes three days.'}]};
const relationEvidence=selectedKnowledgeEvidence(relationContent,relationMatch);
const relationProjection=projectKnowledgeEvidence({sourceContent:relationContent,answerEvidence:relationEvidence,sourceRelations:relationMatch.sourceRelations});
assert.equal(relationProjection.sourceRelations.length,1);
assert.equal(JSON.parse(knowledgeEvidenceModelContent({sourceContent:relationContent,answerEvidence:relationEvidence,sourceRelations:relationMatch.sourceRelations})).sourceRelations[0].type,'sequence');
assert.equal(selectedSourceRelations(relationContent,{...relationMatch,sourceRelations:undefined}).length,0,'Unknown relation is not inferred');
for(const relation of [
 {...relationMatch.sourceRelations[0],quote:'Packing is guaranteed.'},
 {...relationMatch.sourceRelations[0],toSentenceId:'s99'},
 {...relationMatch.sourceRelations[0],toSentenceId:'s0'},
 {...relationMatch.sourceRelations[0],type:'guarantee'},
 {...relationMatch.sourceRelations[0],quote:relationContent},
 {...relationMatch.sourceRelations[0],quote:'After packing, transit takes three days.'},
]) assert.equal(selectedSourceRelations(relationContent,{...relationMatch,sourceRelations:[relation]}).length,0);
const separate = {sourceContent:relationContent,answerEvidence:relationEvidence};
const separatePayload=JSON.parse(knowledgeEvidenceModelContent(separate));
assert.deepEqual(separatePayload.sourceRelations,[]);
assert.equal(separatePayload.facts[1].text,'After packing, transit takes three days.','Single-fact original condition remains intact');
assert(!knowledgeEvidenceModelContent(separate).includes('thirty days'),'Unselected policy cannot leak through relationship context');
assert.equal(knowledgeEvidenceModelContent({content:relationContent}),relationContent,'Legacy/general model content unchanged');
const relationSelected=await selectBusinessKnowledgeReferences({query:'How do packing and transit relate?',sections:[{id:'relation-policy',content:relationContent}],select:async input=>input.stage==='directory'?{ids:['relation-policy']}:{matches:[{id:'relation-policy',answersQuestion:true,confidence:.99,...relationMatch}]}});
assert.equal(projectKnowledgeEvidence(relationSelected.items[0]).sourceRelations.length,1,'Selector result retains source relations');
const relationLayer=buildKnowledgeContextLayer({customerServiceIntent:true,items:relationSelected.items});
assert(relationLayer.content.includes('sourceRelations'));
assert(!relationLayer.content.includes('thirty days'));
console.log('Source relation checks passed: explicit quoted sequence, unknown/invalid/foreign/partial relation rejection, intact individual conditions, shared model payload and legacy isolation');
