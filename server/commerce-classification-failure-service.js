import { buildFallbackReplyResult } from "./ai-reply-fallback-service.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";

// Classification happens before catalogue/knowledge retrieval. This status must
// not claim that either search ran, nor mislabel a provider/protocol failure as a timeout.
const PROCESSING_UNAVAILABLE_COPY = Object.freeze({
  en: "I couldn't process your request right now. Please try again later.",
  zh: "暂时未能处理你的请求，请稍后重试。",
  es: "No he podido procesar tu solicitud ahora. Inténtalo de nuevo más tarde.",
  fr: "Je n’ai pas pu traiter ta demande pour le moment. Réessaie plus tard.",
  de: "Ich konnte deine Anfrage gerade nicht bearbeiten. Bitte versuche es später erneut.",
  pt: "Não consegui processar seu pedido agora. Tente novamente mais tarde.",
  it: "Non sono riuscito a elaborare la tua richiesta ora. Riprova più tardi.",
  ja: "現在リクエストを処理できませんでした。しばらくしてからもう一度お試しください。",
  ko: "지금 요청을 처리하지 못했습니다. 나중에 다시 시도해 주세요.",
  ar: "لم أتمكن من معالجة طلبك الآن. يُرجى المحاولة مرة أخرى لاحقًا.",
  hi: "अभी आपका अनुरोध संसाधित नहीं हो सका। कृपया बाद में फिर से कोशिश करें।",
  id: "Saya belum bisa memproses permintaanmu sekarang. Silakan coba lagi nanti.",
  tr: "Şu anda isteğini işleyemedim. Lütfen daha sonra tekrar dene.",
  nl: "Ik kon je verzoek nu niet verwerken. Probeer het later opnieuw.",
  pl: "Nie udało mi się teraz przetworzyć Twojej prośby. Spróbuj ponownie później.",
  sv: "Jag kunde inte behandla din förfrågan just nu. Försök igen senare.",
  no: "Jeg kunne ikke behandle forespørselen din akkurat nå. Prøv igjen senere.",
  da: "Jeg kunne ikke behandle din anmodning lige nu. Prøv igen senere.",
  fi: "En pystynyt käsittelemään pyyntöäsi juuri nyt. Yritä myöhemmin uudelleen.",
  ru: "Сейчас не удалось обработать ваш запрос. Пожалуйста, попробуйте позже.",
  uk: "Зараз не вдалося обробити ваш запит. Будь ласка, спробуйте пізніше.",
  cs: "Teď se mi nepodařilo zpracovat tvůj požadavek. Zkus to prosím později.",
  sk: "Teraz sa mi nepodarilo spracovať tvoju požiadavku. Skús to prosím neskôr.",
  hu: "Most nem sikerült feldolgoznom a kérésedet. Kérlek, próbáld újra később.",
  ro: "Nu am reușit să procesez cererea ta acum. Încearcă din nou mai târziu.",
  bg: "Не успях да обработя заявката ти в момента. Моля, опитай отново по-късно.",
  el: "Δεν μπόρεσα να επεξεργαστώ το αίτημά σου τώρα. Δοκίμασε ξανά αργότερα.",
  he: "לא הצלחתי לעבד את הבקשה שלך כרגע. אפשר לנסות שוב מאוחר יותר.",
  th: "ตอนนี้ยังไม่สามารถประมวลผลคำขอของคุณได้ โปรดลองอีกครั้งภายหลัง",
  vi: "Hiện tôi chưa xử lý được yêu cầu của bạn. Vui lòng thử lại sau.",
  ms: "Saya tidak dapat memproses permintaan anda sekarang. Sila cuba lagi nanti.",
  ta: "இப்போது உங்கள் கோரிக்கையைச் செயல்படுத்த முடியவில்லை. பின்னர் மீண்டும் முயற்சிக்கவும்.",
  bn: "এখন আপনার অনুরোধটি প্রক্রিয়া করা যায়নি। অনুগ্রহ করে পরে আবার চেষ্টা করুন।",
  ur: "ابھی آپ کی درخواست پر کارروائی نہیں ہو سکی۔ براہ کرم بعد میں دوبارہ کوشش کریں۔",
  fa: "فعلاً نتوانستم درخواستت را پردازش کنم. لطفاً بعداً دوباره تلاش کن.",
  sw: "Sikuweza kushughulikia ombi lako sasa. Tafadhali jaribu tena baadaye.",
  tl: "Hindi ko maproseso ang hiling mo ngayon. Pakisubukang muli mamaya.",
  ca: "Ara no he pogut processar la teva petició. Torna-ho a provar més tard.",
  hr: "Trenutačno nisam uspio obraditi tvoj zahtjev. Pokušaj ponovno kasnije.",
  sr: "Тренутно нисам успео да обрадим твој захтев. Покушај поново касније.",
  lt: "Dabar nepavyko apdoroti tavo užklausos. Bandyk dar kartą vėliau.",
  lv: "Pašlaik neizdevās apstrādāt tavu pieprasījumu. Lūdzu, mēģini vēlāk vēlreiz.",
  et: "Mul ei õnnestunud praegu su päringut töödelda. Palun proovi hiljem uuesti.",
});

// A processing failure is neither a catalogue no-match nor missing user details.
// Only server-validated classification failures can produce this fixed status.
export function buildCommerceClassificationFailureReply(searchIntent = {}, {
  userText = "", language = "en", voiceMeta = {},
} = {}) {
  const failure = searchIntent.commerceClassificationFailure;
  if (searchIntent.commerceClassificationUnavailable !== true
    || !["timeout", "provider", "parse", "missing_fields"].includes(failure)) return null;
  const reply = buildFallbackReplyResult(userText, { ...voiceMeta, fallbackLanguageCode: language },
    `commerce_classification_${failure}`, { sourceRef: "commerce-classification-unavailable" });
  // Timeout uses the existing translated server-timeout copy: a catalogue query
  // has not necessarily happened. Other failures use a neutral processing status.
  if (failure !== "timeout") {
    const rawLanguage = String(language || "").trim();
    const code = (normalizeCharacterLanguage(rawLanguage)
      || normalizeCharacterLanguage(rawLanguage.split(/[-_]/, 1)[0]))?.code || "en";
    const text = PROCESSING_UNAVAILABLE_COPY[code] || PROCESSING_UNAVAILABLE_COPY.en;
    reply.text = reply.displayText = reply.speechText = text;
  }
  return { ...reply, productScopeVerified: false, candidateEvidenceVerified: false,
    replyRecoveryState: { version: 1, kind: "classification", guardApplied: true, failedContracts: [],
      reviewStatus: failure === "timeout" ? "timeout" : failure === "parse" ? "invalid_json" : failure === "missing_fields" ? "missing_fields" : "unavailable" },
    candidateConfirmationVerified: false, replyBoundary: { salesAllowed: false, contactAllowed: false } };
}
