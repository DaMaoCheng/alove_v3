export const SUPPORTED_CHARACTER_LANGUAGES = Object.freeze([
  lang("en", "English", ["英语", "英文", "美式英语", "英式英语", "american english", "british english", "en"], true, true),
  lang("zh", "Chinese (Mandarin)", ["中文", "汉语", "普通话", "国语", "中国话", "华语", "简体中文", "繁体中文", "chinese", "mandarin", "mandarin chinese", "zh", "cn", "zh-cn", "zh_cn", "zh-hans", "zh-hant", "zh-tw", "cmn", "cmn-cn"], true, true),
  lang("es", "Spanish", ["西语", "西班牙语", "spanish", "español", "es"], true, true),
  lang("fr", "French", ["法语", "french", "français", "fr"], true, true),
  lang("de", "German", ["德语", "german", "deutsch", "de"], true, true),
  lang("pt", "Portuguese", ["葡语", "葡萄牙语", "巴葡", "巴西葡语", "portuguese", "português", "brazilian portuguese", "portuguese brazil", "portuguese brazilian", "pt", "pt-br", "pt_br", "ptbr", "br"], true, true),
  lang("it", "Italian", ["意大利语", "italian", "italiano", "it"], true, true),
  lang("ja", "Japanese", ["日语", "日本语", "日文", "japanese", "nihongo", "ja"], true, true),
  lang("ko", "Korean", ["韩语", "韩国语", "korean", "한국어", "ko"], true, true),
  lang("ar", "Arabic", ["阿拉伯语", "arabic", "عربي", "ar"], true, true),
  lang("hi", "Hindi", ["印地语", "印度语", "hindi", "हिन्दी", "hi"], true, true),
  lang("id", "Indonesian", ["印尼语", "印度尼西亚语", "indonesian", "bahasa indonesia", "id"], true, true),
  lang("tr", "Turkish", ["土耳其语", "turkish", "türkçe", "tr"], true, true),
  lang("nl", "Dutch", ["荷兰语", "dutch", "nederlands", "nl"], true, true),
  lang("pl", "Polish", ["波兰语", "polish", "polski", "pl"], true, true),
  lang("sv", "Swedish", ["瑞典语", "swedish", "svenska", "sv"], true, true),
  lang("no", "Norwegian", ["挪威语", "norwegian", "norsk", "no", "nb", "nn", "nor", "norwegian bokmal", "norwegian bokmål", "bokmal", "bokmål"], true, true),
  lang("da", "Danish", ["丹麦语", "danish", "dansk", "da"], true, true),
  lang("fi", "Finnish", ["芬兰语", "finnish", "suomi", "fi"], true, true),
  lang("ru", "Russian", ["俄语", "russian", "русский", "ru"], true, true),
  lang("uk", "Ukrainian", ["乌克兰语", "ukrainian", "українська", "uk"], true, true),
  lang("cs", "Czech", ["捷克语", "czech", "čeština", "cs"], true, true),
  lang("sk", "Slovak", ["斯洛伐克语", "slovak", "slovenčina", "sk"], true, true),
  lang("hu", "Hungarian", ["匈牙利语", "hungarian", "magyar", "hu"], true, true),
  lang("ro", "Romanian", ["罗马尼亚语", "romanian", "română", "ro"], true, true),
  lang("bg", "Bulgarian", ["保加利亚语", "bulgarian", "български", "bg"], true, true),
  lang("el", "Greek", ["希腊语", "greek", "ελληνικά", "el"], true, true),
  lang("he", "Hebrew", ["希伯来语", "hebrew", "עברית", "he"], false, true),
  lang("th", "Thai", ["泰语", "thai", "ภาษาไทย", "th"], false, true),
  lang("vi", "Vietnamese", ["越南语", "vietnamese", "tiếng việt", "vi"], true, true),
  lang("ms", "Malay", ["马来语", "malay", "bahasa melayu", "ms"], true, true),
  lang("ta", "Tamil", ["泰米尔语", "tamil", "தமிழ்", "ta"], true, true),
  lang("bn", "Bengali", ["孟加拉语", "bengali", "বাংলা", "bn"], false, true),
  lang("ur", "Urdu", ["乌尔都语", "urdu", "اردو", "ur"], false, true),
  lang("fa", "Persian", ["波斯语", "farsi", "persian", "فارسی", "fa"], false, true),
  lang("sw", "Swahili", ["斯瓦希里语", "swahili", "kiswahili", "sw"], false, true),
  lang("tl", "Filipino", ["菲律宾语", "塔加洛语", "filipino", "tagalog", "fil", "tl"], true, true),
  lang("ca", "Catalan", ["加泰罗尼亚语", "catalan", "català", "ca"], false, true),
  lang("hr", "Croatian", ["克罗地亚语", "croatian", "hrvatski", "hr"], true, true),
  lang("sr", "Serbian", ["塞尔维亚语", "serbian", "српски", "sr"], false, true),
  lang("lt", "Lithuanian", ["立陶宛语", "lithuanian", "lietuvių", "lt"], false, true),
  lang("lv", "Latvian", ["拉脱维亚语", "latvian", "latviešu", "lv"], false, true),
  lang("et", "Estonian", ["爱沙尼亚语", "estonian", "eesti", "et"], false, true),
]);

export function searchCharacterLanguages(query = "", { limit = 12 } = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const scored = SUPPORTED_CHARACTER_LANGUAGES.map((language, index) => ({
    language,
    index,
    score: scoreLanguage(language, normalizedQuery),
  })).filter((item) => item.score > 0 || !normalizedQuery);

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Number(limit || 12)))
    .map((item) => item.language);
}

export function findCharacterLanguage(value = "") {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return null;
  return SUPPORTED_CHARACTER_LANGUAGES.find((language) => language.tokens.some((token) => token === normalizedValue)) || null;
}

export function normalizeCharacterLanguage(value = "") {
  const language = findCharacterLanguage(value);
  if (!language) return null;
  return {
    code: language.code,
    label: language.label,
    flashSupported: language.flashSupported,
    v3Supported: language.v3Supported,
  };
}

function lang(code, label, aliases, flashSupported, v3Supported) {
  const tokens = Array.from(new Set([code, label, ...aliases].map(normalizeSearchText).filter(Boolean)));
  return Object.freeze({
    code,
    label,
    aliases: Object.freeze(aliases),
    flashSupported: Boolean(flashSupported),
    v3Supported: Boolean(v3Supported),
    tokens: Object.freeze(tokens),
  });
}

function scoreLanguage(language, normalizedQuery) {
  if (!normalizedQuery) return language.flashSupported ? 2 : 1;
  let best = 0;
  for (const token of language.tokens) {
    if (token === normalizedQuery) best = Math.max(best, 100);
    else if (token.startsWith(normalizedQuery)) best = Math.max(best, 80);
    else if (token.includes(normalizedQuery)) best = Math.max(best, 60);
    else if (normalizedQuery.includes(token) && token.length > 1) best = Math.max(best, 40);
  }
  return best;
}

function normalizeSearchText(value = "") {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[\s_().,，。/\\-]+/g, "");
}
