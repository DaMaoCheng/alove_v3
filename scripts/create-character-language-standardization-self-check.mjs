import assert from "node:assert/strict";
import { normalizeCreateCharacterPayload } from "../server/character-normalizers.js";

const fields = normalizeCreateCharacterPayload({
  name: "Language Test",
  categoryId: "companion",
  vibe: "Calm mentor",
  voice: "nova",
  language: "普通话",
  openingLine: "Hello",
  backstory: "A calm football companion with enough detail for validation.",
  visibility: "private",
});

assert.equal(fields.language, "Chinese (Mandarin)", "create payload should normalize language label");
assert.equal(fields.languageCode, "zh", "create payload should normalize language code");
assert.equal(fields.languageLabel, "Chinese (Mandarin)", "create payload should expose language label");
assert.equal(fields.languageFlashSupported, true, "create payload should expose Flash support");
assert.equal(fields.languageV3Supported, true, "create payload should expose v3 support");
assert.match(fields.profileJson, /"defaultLanguageCode":"zh"/, "profile json should persist default language code");
assert.match(fields.profileJson, /"defaultLanguageLabel":"Chinese \(Mandarin\)"/, "profile json should persist default language label");

assert.throws(
  () => normalizeCreateCharacterPayload({
    name: "Bad Language Test",
    categoryId: "companion",
    vibe: "Calm mentor",
    voice: "nova",
    language: "可爱一点",
    openingLine: "Hello",
    backstory: "A calm football companion with enough detail for validation.",
  }),
  /请选择有效语言/,
  "non-language text should not be accepted as character default language"
);

console.log("create character language standardization self-check passed");
