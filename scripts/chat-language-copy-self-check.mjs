import assert from "node:assert/strict";
import { upsertPersonaLanguageSetting } from "../server/chat-language-preference-service.js";
import { buildChatReplyPrompt } from "../server/chat-prompt-service.js";

const personaPrompt = upsertPersonaLanguageSetting("Warm football fan.", "English");
assert.doesNotMatch(personaPrompt, /default|默认/i, "persona language guidance should not use mechanical default wording");
assert.match(personaPrompt, /English/, "persona language guidance should still include the selected language");
assert.match(
  personaPrompt,
  /Do not change output language just because the user's message is written in another language/i,
  "persona language guidance should prevent automatic output-language changes from user input language"
);
assert.match(
  personaPrompt,
  /only when the user explicitly asks you to reply, speak, or write in a specific language/i,
  "persona language guidance should allow switching only for explicit language requests"
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

assert.doesNotMatch(
  prompt.systemPrompt,
  /default|默认/i,
  "runtime chat prompt should not include mechanical default language wording"
);
assert.match(
  prompt.systemPrompt,
  /English/,
  "runtime chat prompt should still include the selected character language"
);
assert.match(
  prompt.systemPrompt,
  /Do not change output language just because the user's message is written in another language/i,
  "runtime chat prompt should prevent automatic output-language changes from user input language"
);
assert.match(
  prompt.systemPrompt,
  /only when the user explicitly asks you to reply, speak, or write in a specific language/i,
  "runtime chat prompt should allow switching only for explicit language requests"
);
assert.equal(
  prompt.messages.at(-1)?.content,
  "你好，你好，你好。",
  "runtime chat prompt should keep the current user input in the standard message list"
);

console.log("chat language copy self-check passed");
