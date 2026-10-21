import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateCharacterTextWithRequest } from "../server/character-text-generation-service.js";

let captured = null;
const result = await generateCharacterTextWithRequest({
  systemPrompt: "Polish this character backstory.",
  userContent: "A warm football fan.",
  requestText: async () => "unused",
  requestWithFallback: async (requestText, promptContext, { validateReply }) => {
    captured = { requestText, promptContext, validation: validateReply("A warm football fan.") };
    return {
      text: "A warm football fan.",
      providerId: "venice",
      model: "gemma-4-uncensored",
      baseUrl: "https://api.venice.ai/api/v1",
    };
  },
});

assert.equal(captured.requestText instanceof Function, true);
assert.equal(captured.promptContext.systemPrompt, "Polish this character backstory.");
assert.deepEqual(captured.promptContext.messages, [{ role: "user", content: "A warm football fan." }]);
assert.deepEqual(captured.validation, { valid: true, reason: "empty_character_text" });
assert.equal(result.providerId, "venice");
assert.equal(result.model, "gemma-4-uncensored");

const polishSource = readFileSync(new URL("../server/character-polish-service.js", import.meta.url), "utf8");
const shortBioSource = readFileSync(new URL("../server/character-short-bio-service.js", import.meta.url), "utf8");
assert.match(polishSource, /generateCharacterText\(/);
assert.match(shortBioSource, /generateCharacterText\(/);
assert.doesNotMatch(shortBioSource, /aiReply\.openai/);

console.log("Character text generation self-check passed");
