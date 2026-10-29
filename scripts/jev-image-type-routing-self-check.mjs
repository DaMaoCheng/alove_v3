import assert from 'node:assert/strict';
process.env.AIOVE_PROVIDER_LOG_WRITE_ENABLED = 'false';
const { classifyJevImageDetails } = await import('../server/jev-image-decision-service.js');
const { classifyChatImageIntent } = await import('../server/chat-image-intent-classifier-service.js');
const text = 'Show me you wearing a red shirt';
const primary = { ok:true, confident:true, confidence:.01, primaryIntent:'try_on', imageIntent:'try_on',
  imageConditions:{wants_clothing:true,wants_no_clothing:false} };
let calls = 0, mode = 'try_on';
const evaluate = async ({ questions, state }) => {
  calls++;
  assert.equal(state.primaryImageIntent, 'try_on');
  assert(questions.image_type && questions.clothing_target && questions.image_scope);
  for (const forbidden of ['image_intent','image_action','image_kind','image_subject','actor_is_character','current_visual_action'])
    assert(!questions[forbidden], `type step must not reclassify ${forbidden}`);
  const find = (q, text) => Object.entries(q.criteria).find(([,v]) => v === text)?.[0] || 'none';
  const answers = { image_type:{choice:mode,confidence:.01}, image_scope:{choice:'mixed',confidence:.01},
    clothing_target:{choice:'generic',confidence:.01}, actor_evidence:{choice:find(questions.actor_evidence,'you'),confidence:.01},
    action_evidence:{choice:find(questions.action_evidence,text),confidence:.01} };
  return {ok:true,answers};
};
const classifyImageJev = (t, opts) => classifyJevImageDetails(t, {...opts,evaluate});
let r=await classifyChatImageIntent(text,{character:{name:'Alba',category_id:'mascot'},jevDecision:primary,classifyImageJev});
assert.equal(calls,1);assert.equal(r.hasIntent,true);assert.equal(r.allowed,true);assert.equal(r.intentType,'try_on');
assert.equal(r.requestScope,'mixed','mixed selected option survives a low diagnostic score');
mode='library_photo';r=await classifyChatImageIntent(text,{character:{name:'Alba',category_id:'mascot'},jevDecision:primary,classifyImageJev});
assert.equal(r.intentType,'library_photo','second step uses selected type, not primary type or score');
mode='unclear';r=await classifyChatImageIntent(text,{character:{name:'Alba',category_id:'mascot'},jevDecision:primary,classifyImageJev});
assert.equal(r.allowed,false);assert.equal(r.appearanceClarificationRequired,true,'explicit unclear remains a clarification');
const before=calls;
r=await classifyChatImageIntent('Show me the product',{character:{category_id:'mascot'},jevDecision:{...primary,primaryIntent:'product_request',imageIntent:'none'},classifyImageJev});
assert.equal(r.hasIntent,false);assert.equal(calls,before,'a non-image primary decision must never run image type classification');
console.log('two-stage image type: selected choice without confidence gate, no repeated image-intent judgment');
