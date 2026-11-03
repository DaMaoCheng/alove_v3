import assert from 'node:assert/strict';
import { hasUserSuppliedInternalNotation, inspectReplyTechnicalGuard } from '../server/chat-reply-technical-guard.js';
const ok = text => ({ text, speechText: text });
for (const text of ['Claro, estoy aquí.', '我在听，你接着说。', 'AI 是你说的那个话题吗？', 'La camiseta cuesta 20 €.', 'En HTML se usa <p> para párrafos.'])
  assert.equal(inspectReplyTechnicalGuard(ok(text)).ok,true,text);
for (const text of ['', ' <context>Short, in character.</context> Hola.', '<CONTEXT role="system">foo', '<analysis>internal</analysis> Hola', '<think\n', '```js\nfoo\n```', '{"displayText":"Hi","speechText":"Hi"}', 'Mi clave es sk-abcdefghijklmnop'])
  assert.equal(inspectReplyTechnicalGuard(ok(text)).ok,false,JSON.stringify(text));
assert.equal(inspectReplyTechnicalGuard({text:'Hola',speechText:'<context>hidden</context> Hola'}).ok,false,'speech is also visible output');
assert.equal(inspectReplyTechnicalGuard({text:'Hola',displayText:'<context>hidden</context>'}).ok,false,'display is also checked');
assert.equal(inspectReplyTechnicalGuard({text:'Hola',speechText:'[happy] Hola'}).ok,true,'valid voice tags remain allowed');
assert(hasUserSuppliedInternalNotation('请解释 <CONTEXT> 标签'));
assert(hasUserSuppliedInternalNotation('请解释 ```js 示例'));
assert(!hasUserSuppliedInternalNotation('请解释 context 标签'));
console.log('technical guard: scoped internal tags, structured fields, code, secrets and both output channels passed');
