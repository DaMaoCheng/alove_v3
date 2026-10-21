import assert from 'node:assert/strict';
const root = new URL('../',import.meta.url);
const {parseStructuredChatReply}=await import(new URL('server/chat-reply-structure-service.js',root));
const {applyContextualEmotionTags}=await import(new URL('server/tts-emotion-routing-service.js',root));
const {sanitizeTtsSpeechText}=await import(new URL('server/tts-speech-text-sanitizer.js',root));
const {generateChatReplyWithRequest}=await import(new URL('server/ai-reply-service.js',root));
const {renderChatMessages}=await import(new URL('src/features/chat/chat-message-renderer.js',root));
globalThis.fetch=async()=>{throw Error('Unexpected paid/network operation in batch4 draft check');};
const findings=[];let checks=0;
function check(name,actual,expected){checks++;try{assert.deepEqual(actual,expected,name);}catch{findings.push({name,actual,expected});}}
for(const text of [
 'print("Hello, world!")','items[0]','A (short) note with [a reference].',
 'if ready:\n    print("ok")\n    values[0] = "x"',
 'A quote: "take  two"; x < y; x > z.',
]){
 for(const raw of [text,JSON.stringify({displayText:text,speechText:text})]){
  const result=parseStructuredChatReply(raw);
  check('parse preserves '+text,result.displayText,text);
  check('emotion preserves '+text,applyContextualEmotionTags({...result,sourceType:'ai'}).displayText,text);
 }
}
for(const text of ['print("Hello, world!")','items[0]','Price is 20 (tax included).','Use the left [A] port.']) {
 check('speech retains literal meaning ignoring TTS spacing '+text,parseStructuredChatReply(JSON.stringify({displayText:text,speechText:text})).speechText.replace(/\s+/g,''),text.replace(/\s+/g,''));
}
const speechOnlyStage=parseStructuredChatReply(JSON.stringify({displayText:'Hello.',speechText:'[happy] Hello [smiles at you] (waves).'}));
check('independent display proves speech-only stage aside',speechOnlyStage.speechText,'[happy] Hello.');
const tags=parseStructuredChatReply(JSON.stringify({displayText:'Clean pick. Go with it.',speechText:'[excited] Clean pick. [short pause] Go with it.'}));
check('display has no delivery tags',tags.displayText,'Clean pick. Go with it.');
check('speech retains approved tags',tags.speechText,'[excited] Clean pick. [short pause] Go with it.');
const taggedPlain=parseStructuredChatReply('[happy] Hello. [short pause] See you.');
check('plain control tags hidden',taggedPlain.displayText,'Hello. See you.');
check('visual stage directions still removed from speech',sanitizeTtsSpeechText('Hello [smiles at you] (waves).'),'Hello.');
check('script not spoken',sanitizeTtsSpeechText('Look <script>alert(1)</script> here.'),'Look here.');
const escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const malicious='<img src=x onerror="alert(1)">';
const rendered=renderChatMessages({character:{name:'Test'},messages:[{senderType:'user',contentType:'text',text:malicious}],pageLanguage:'English',escapeHtml,escapeAttribute:escapeHtml});
check('renderer escapes markup',rendered.includes('&lt;img'),true);
check('renderer does not execute markup',rendered.includes('<img src=x'),false);
for(const raw of [
 '```python\nprint("Hello, world!")\n```',
 JSON.stringify({displayText:'print("Hello, world!")',speechText:'print("Hello, world!")'}),
 '```python\nif ready:\n    print("ok")\n```',
]){
 const reply=await generateChatReplyWithRequest({promptContext:{systemPrompt:'Short direct reply.',messages:[{role:'user',content:'Write Python code.'}]},userText:'Write Python code.',logContext:{languageCode:'en'},requestReplyText:async()=>raw,recordReplyLogFn:async()=>{}});
 const expected=raw.startsWith('```')?raw.replace(/^```python\n/,'').replace(/\n```$/,''):JSON.parse(raw).displayText;
 check('generation preserves code '+raw,reply.displayText,expected);
}
const {enforceReplyBoundary}=await import(new URL('server/chat-reply-boundary-service.js',root));
const {assessIndependentLanguageQuality}=await import(new URL('server/chat-language-quality-service.js',root));
const divergent=parseStructuredChatReply(JSON.stringify({displayText:'The answer is blue.',speechText:'The answer is red.'}));
let primaryChecks=0, independentChecks=0;
const rejected=await enforceReplyBoundary({replyResult:{...divergent,sourceType:'ai'},requireIdentityReview:true,
 independentLanguageQualityRequired:true,languageQualityRequired:true,language:'en',userText:'What colour?',recordReview:async()=>{},
 assess:async input=>{
  primaryChecks++;assert.equal(input.text,'The answer is blue.');assert.equal(input.speechText,'The answer is red.');
  return {reviewStatus:'valid',allowed:true,confidence:.99,boundarySupported:true,evidenceSupported:true,guidanceSupported:true};
 },
 assessLanguageQuality:input=>assessIndependentLanguageQuality({...input,config:{apiKey:'isolated',model:'independent-fixture',baseUrl:'https://fixture.invalid/v1',apiMode:'chat_completions'},recordLog:async()=>{},
  fetchImpl:async(_url,options)=>{
   independentChecks++;const body=JSON.parse(options.body);const packet=JSON.parse(body.messages.at(-1).content);
   assert.equal(packet.proposedResponse,'The answer is blue.');assert.equal(packet.proposedSpeech,'The answer is red.');
   return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({languageQualitySupported:false,retainedLanguageQualitySupported:false,languageQualityConfidence:.99,
    languageIssues:[{type:'coherence',field:'speech',severity:'major',span:'red'}]})}}]}),{headers:{'content-type':'application/json'}});
  }}),
 });
check('both independent channels receive original meaning',primaryChecks===1&&independentChecks===1,true);
check('meaning mismatch cannot survive complete review',rejected.text===divergent.displayText,false);
check('review fallback has aligned speech',rejected.speechText,rejected.text);
const {sanitizeGuestReplyText,normalizeGuestReplyText}=await import(new URL('server/guest-chat-output-policy.js',root));
const multiline='Here is the example:\n\nitems = ["home", "away"]\nfor item in items:\n    print(items[0], item)';
check('guest sanitizer preserves code line breaks and indentation',sanitizeGuestReplyText(multiline,{userText:'Show Python code'}),multiline);
check('actual guest normalizer preserves visible literal format',normalizeGuestReplyText({text:multiline,userText:'Show Python code'}),multiline);
check('conditional discount explanation preserves unrelated paragraph format',sanitizeGuestReplyText(multiline,{userText:'What is a discount?',productSearchIntent:{commerceRoute:'chat',knowledgeScope:'general',commerceTopic:'price'}}),multiline);
check('format preservation does not disable unauthorized coupon guard',sanitizeGuestReplyText('Use SAVE20 for 20% off\n\n'+multiline,{userText:'Show Python code'}),'Discounts are available after you create an account.');
const renderText=(text,senderType='user')=>renderChatMessages({character:{name:'Test'},messages:[{id:'literal',senderType,contentType:'text',text}],pageLanguage:'English',escapeHtml,escapeAttribute:escapeHtml});
check('ordinary user bubble HTML unchanged',renderText('Hello. A (short) note.'),'<div class="msg me"><div class="bubble">Hello. A (short) note.</div></div>');
check('unindented paragraphs retain existing bubble markup',renderText('Hello.\n\nHow are you?').includes('white-space:'),false);
check('indented literal user display preserves whitespace',renderText(multiline).includes('<span style="white-space:pre-wrap">'+escapeHtml(multiline)+'</span>'),true);
const indentedCharacter=renderText(multiline,'character');
check('indented literal character display preserves whitespace',indentedCharacter.includes('<span style="white-space:pre-wrap">'+escapeHtml(multiline)+'</span>'),true);
check('voice control stays outside formatting span',indentedCharacter.indexOf('</span>')<indentedCharacter.indexOf('<button class="voice-btn'),true);
check('indented literal markup remains escaped',renderText('example:\n    '+malicious).includes('<img src=x'),false);
console.log(JSON.stringify({checks,failures:findings,scope:'isolated parser/generator/complete-review wiring; no database or external calls'},null,2));
if(findings.length)process.exitCode=1;
