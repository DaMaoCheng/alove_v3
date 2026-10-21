import assert from "node:assert/strict";
import {
  SUPPORTED_CHARACTER_LANGUAGES,
  findCharacterLanguage,
  searchCharacterLanguages,
} from "../shared/language-library.js";

assert.ok(SUPPORTED_CHARACTER_LANGUAGES.length >= 32, "language library should cover at least the Flash v2.5 language set");

const chinese = findCharacterLanguage("中文");
assert.equal(chinese?.code, "zh", "中文 should resolve to Chinese (Mandarin)");
assert.equal(findCharacterLanguage("普通话")?.code, "zh", "普通话 should resolve to Chinese (Mandarin)");
assert.equal(findCharacterLanguage("Chinese")?.code, "zh", "Chinese should resolve to Chinese (Mandarin)");
assert.equal(findCharacterLanguage("Mandarin")?.label, "Chinese (Mandarin)", "Mandarin should resolve to the standard label");
assert.equal(findCharacterLanguage("zh-cn")?.code, "zh", "zh-cn should resolve to Chinese (Mandarin)");
assert.equal(findCharacterLanguage("cmn")?.code, "zh", "cmn should resolve to Chinese (Mandarin)");

assert.equal(findCharacterLanguage("english")?.code, "en", "english should resolve to English");
assert.equal(findCharacterLanguage("英语")?.code, "en", "英语 should resolve to English");
assert.equal(findCharacterLanguage("日语")?.code, "ja", "日语 should resolve to Japanese");
assert.equal(findCharacterLanguage("巴葡")?.code, "pt", "巴葡 should resolve to Portuguese");
assert.equal(findCharacterLanguage("pt-BR")?.code, "pt", "pt-BR should resolve to Portuguese");
assert.equal(findCharacterLanguage("fil")?.code, "tl", "fil should resolve to Filipino");
assert.equal(findCharacterLanguage("nb")?.code, "no", "nb should resolve to Norwegian");
assert.equal(findCharacterLanguage("hr")?.flashSupported, true, "Croatian should support Flash");
assert.equal(findCharacterLanguage("tl")?.flashSupported, true, "Filipino should support Flash");
assert.equal(findCharacterLanguage("he")?.flashSupported, false, "Hebrew should fall back from Flash");
assert.equal(findCharacterLanguage("th")?.flashSupported, false, "Thai should fall back from Flash");

const noMatch = findCharacterLanguage("可爱一点");
assert.equal(noMatch, null, "non-language text should not resolve to a language");

const results = searchCharacterLanguages("中文");
assert.equal(results[0]?.code, "zh", "search should rank exact alias matches first");

for (const language of SUPPORTED_CHARACTER_LANGUAGES) {
  assert.match(language.code, /^[a-z]{2,3}(-[a-z0-9]+)?$/i, `${language.label} should have a stable language code`);
  assert.ok(language.label, `${language.code} should have a label`);
  assert.ok(Array.isArray(language.aliases), `${language.code} should have aliases`);
  assert.equal(typeof language.flashSupported, "boolean", `${language.code} should mark Flash support`);
  assert.equal(typeof language.v3Supported, "boolean", `${language.code} should mark v3 support`);
}

console.log("language library self-check passed");
