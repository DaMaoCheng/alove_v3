import assert from "node:assert/strict";
import { upsertPersonaLanguageSetting } from "../server/chat-language-preference-service.js";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const personaPrompt = upsertPersonaLanguageSetting("Warm football fan.", "English");
assert.match(personaPrompt, /configured default when unclear/i, "unclear input retains the configured language fallback");
assert.match(personaPrompt, /English/, "persona language guidance should still include the selected language");
assert.match(
  personaPrompt,
  /Follow the validated current user language when available/i,
  "persona language guidance should follow validated current-turn input language"
);
assert.match(
  personaPrompt,
  /Explicit user language requests take priority/i,
  "persona language guidance should prioritize explicit language requests"
);

const prompt = buildChatReplyPrompt({
  character: {
    id: "copy_check_character",
    name: "Copy Check",
    profile_json: JSON.stringify({ language: "English" }),
    persona_prompt: "Warm football fan.",
  },
  recentMessages: [],
  userText: "你好，你好，你好。",
});

assert.match(
  prompt.systemPrompt,
  /configured default when unclear/i,
  "runtime chat prompt keeps fallback for unclear input"
);
assert.match(
  prompt.systemPrompt,
  /English/,
  "runtime chat prompt should still include the selected character language"
);
assert.match(
  prompt.systemPrompt,
  /Follow the validated current user language when available/i,
  "runtime chat prompt should follow validated current-turn input language"
);
assert.match(
  prompt.systemPrompt,
  /Explicit user language requests take priority/i,
  "runtime chat prompt should prioritize explicit language requests"
);
assert.equal(
  prompt.messages.at(-1)?.content,
  "你好，你好，你好。",
  "runtime chat prompt should keep the current user input in the standard message list"
);

assert.doesNotMatch(prompt.systemPrompt, /Do not change output language just because/i, 'old language lock must not coexist with current-turn selection');
assert.match(prompt.systemPrompt, /Keep speech in the same active language selected for this turn's text/i, 'voice follows the same resolved text language');
console.log("chat language copy self-check passed");
