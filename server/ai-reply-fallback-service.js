import { normalizeReplyVoiceMeta } from "./ai-reply-contract-service.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";

const SERVER_TIMEOUT_REPLY_BY_LANGUAGE = Object.freeze({
  ar: "انتهت مهلة استجابة الخادم. يُرجى المحاولة مرة أخرى لاحقًا.",
  bg: "Сървърът отговори твърде бавно. Моля, опитайте отново по-късно.",
  bn: "সার্ভারের সাড়া দেওয়ার সময় শেষ হয়ে গেছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।",
  ca: "El servidor ha trigat massa a respondre. Torna-ho a provar més tard.",
  cs: "Server odpovídal příliš dlouho. Zkuste to prosím znovu později.",
  da: "Serveren brugte for lang tid på at svare. Prøv venligst igen senere.",
  de: "Der Server hat zu lange für eine Antwort gebraucht. Bitte versuche es später noch einmal.",
  el: "Ο διακομιστής άργησε πολύ να απαντήσει. Δοκιμάστε ξανά αργότερα.",
  en: "The server took too long to respond. Please try again later.",
  es: "El servidor tardó demasiado en responder. Inténtalo de nuevo más tarde.",
  et: "Serveril kulus vastamiseks liiga kaua. Proovige hiljem uuesti.",
  fa: "پاسخ سرور بیش از حد طول کشید. لطفاً بعداً دوباره تلاش کنید.",
  fi: "Palvelimen vastaus kesti liian kauan. Yritä myöhemmin uudelleen.",
  fr: "Le serveur a mis trop de temps à répondre. Veuillez réessayer plus tard.",
  he: "זמן התגובה של השרת הסתיים. נסו שוב מאוחר יותר.",
  hi: "सर्वर को जवाब देने में बहुत समय लगा। कृपया बाद में फिर से कोशिश करें।",
  hr: "Poslužitelju je trebalo predugo da odgovori. Pokušajte ponovno kasnije.",
  hu: "A szerver túl sokáig válaszolt. Kérjük, próbálja meg később újra.",
  id: "Server terlalu lama merespons. Silakan coba lagi nanti.",
  it: "Il server ha impiegato troppo tempo a rispondere. Riprova più tardi.",
  ja: "サーバーの応答がタイムアウトしました。しばらくしてからもう一度お試しください。",
  ko: "서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
  lt: "Serveris atsakė per ilgai. Bandykite dar kartą vėliau.",
  lv: "Serveris atbildēja pārāk ilgi. Lūdzu, mēģiniet vēlreiz vēlāk.",
  ms: "Pelayan mengambil masa terlalu lama untuk memberi respons. Sila cuba lagi kemudian.",
  nl: "De server deed er te lang over om te reageren. Probeer het later opnieuw.",
  no: "Serveren brukte for lang tid på å svare. Prøv igjen senere.",
  pl: "Serwer zbyt długo odpowiadał. Spróbuj ponownie później.",
  pt: "O servidor demorou demasiado para responder. Tente novamente mais tarde.",
  ro: "Serverul a răspuns prea lent. Încercați din nou mai târziu.",
  ru: "Сервер слишком долго отвечал. Пожалуйста, попробуйте позже.",
  sk: "Server odpovedal príliš dlho. Skúste to prosím znova neskôr.",
  sr: "Сервер је предуго одговарао. Покушајте поново касније.",
  sv: "Servern tog för lång tid på sig att svara. Försök igen senare.",
  sw: "Seva imechukua muda mrefu kujibu. Tafadhali jaribu tena baadaye.",
  ta: "சேவையகம் பதிலளிக்க அதிக நேரம் எடுத்துக் கொண்டது. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.",
  th: "เซิร์ฟเวอร์ใช้เวลาตอบสนองนานเกินไป โปรดลองอีกครั้งภายหลัง",
  tl: "Masyadong matagal tumugon ang server. Pakisubukang muli mamaya.",
  tr: "Sunucunun yanıt vermesi çok uzun sürdü. Lütfen daha sonra tekrar deneyin.",
  uk: "Сервер відповідав надто довго. Будь ласка, спробуйте пізніше.",
  ur: "سرور کو جواب دینے میں بہت زیادہ وقت لگا۔ براہِ کرم بعد میں دوبارہ کوشش کریں۔",
  vi: "Máy chủ mất quá lâu để phản hồi. Vui lòng thử lại sau.",
  zh: "服务器响应超时，请稍后重试。",
});
const AI_TRANSPORT_FALLBACK_SOURCES = new Set([
  "ai-request-fallback",
  "empty-ai-reply-fallback",
  "commerce-classification-unavailable",
]);

export function buildErrorReplyMeta(reason) {
  return {
    text: "",
    displayText: "",
    speechText: "",
    voiceMeta: buildVoiceFallbackMeta({}),
    structured: false,
    sourceType: "system",
    sourceRef: "ai-error",
    degraded: true,
    degradationReason: reason,
  };
}

export function buildFallbackReplyResult(userText = "", voiceFallbackMeta = {}, reason = "ai_reply_fallback", { sourceRef = "empty-ai-reply-fallback" } = {}) {
  const text = buildFallbackChatReply(userText, voiceFallbackMeta);
  return {
    text,
    displayText: text,
    speechText: text,
    voiceMeta: normalizeReplyVoiceMeta({}, voiceFallbackMeta),
    structured: false,
    sourceType: "system",
    sourceRef,
    degraded: true,
    degradationReason: reason,
  };
}

export function buildFallbackChatReply(userText = "", voiceFallbackMeta = {}) {
  const language = resolveFallbackLanguage(userText, voiceFallbackMeta);
  return SERVER_TIMEOUT_REPLY_BY_LANGUAGE[language] || SERVER_TIMEOUT_REPLY_BY_LANGUAGE.en;
}

export function buildVoiceFallbackMeta(logContext = {}) {
  return {
    fallbackLanguageCode: logContext.languageCode || "",
    fallbackLanguageLabel: logContext.languagePreference || logContext.languageLabel || "",
    fallbackProvider: logContext.voiceProvider || "",
    fallbackModel: logContext.voiceModel || "",
    fallbackVoiceId: logContext.voiceId || "",
  };
}

export function isAiTransportFallback(replyResult = {}) {
  return AI_TRANSPORT_FALLBACK_SOURCES.has(String(replyResult?.sourceRef || "").trim())
    || ["ai_request_failed_fallback", "empty_ai_reply_after_retry"].includes(String(replyResult?.degradationReason || "").trim());
}

function resolveFallbackLanguage(userText = "", voiceFallbackMeta = {}) {
  const configuredLanguage = [
    voiceFallbackMeta.fallbackLanguageCode,
    voiceFallbackMeta.languageCode,
    voiceFallbackMeta.fallbackLanguageLabel,
    voiceFallbackMeta.languageLabel,
  ].map((value) => normalizeConfiguredLanguage(value)).find(Boolean);
  if (configuredLanguage?.code) return configuredLanguage.code;
  return /[\u3400-\u9fff]/.test(String(userText || "")) ? "zh" : "en";
}

function normalizeConfiguredLanguage(value = "") {
  const rawValue = String(value || "").trim();
  return normalizeCharacterLanguage(rawValue)
    || normalizeCharacterLanguage(rawValue.split(/[-_]/, 1)[0]);
}
