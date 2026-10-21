import { normalizeCharacterLanguage } from "../shared/language-library.js";

// This is a capability limit, not a rejection of a particular store policy.
const COPY = Object.freeze({
  en: "I can't verify those terms or that support route here.",
  zh: "这里暂时无法核实这些条件或客服渠道。",
  es: "No puedo verificar esas condiciones o ese canal de atención aquí.",
  fr: "Je ne peux pas vérifier ces conditions ou ce canal d’assistance ici.",
  de: "Ich kann diese Bedingungen oder diesen Supportweg hier nicht überprüfen.",
  pt: "Não consigo verificar essas condições ou esse canal de atendimento aqui.",
  it: "Non posso verificare queste condizioni o questo canale di assistenza qui.",
  hu: "Itt nem tudom ellenőrizni ezeket a feltételeket vagy az ügyfélszolgálati csatornát.",
  tr: "Bu koşulları veya destek kanalını burada doğrulayamıyorum.",
  ar: "لا أستطيع التحقق من هذه الشروط أو قناة الدعم هنا.",
  ja: "ここでは、その条件やサポート窓口を確認できません。",
  ko: "여기서는 해당 조건이나 고객 지원 경로를 확인할 수 없습니다.",
  hi: "मैं यहाँ इन शर्तों या सहायता माध्यम की पुष्टि नहीं कर सकता।",
  id: "Saya tidak dapat memverifikasi ketentuan atau saluran bantuan tersebut di sini.",
  nl: "Ik kan die voorwaarden of dat ondersteuningskanaal hier niet verifiëren.",
  pl: "Nie mogę tutaj zweryfikować tych warunków ani tego kanału pomocy.",
  sv: "Jag kan inte verifiera de villkoren eller den supportkanalen här.",
  no: "Jeg kan ikke bekrefte disse vilkårene eller denne støttekanalen her.",
  da: "Jeg kan ikke bekræfte disse vilkår eller denne supportkanal her.",
  fi: "En voi vahvistaa näitä ehtoja tai tätä tukikanavaa täällä.",
  ru: "Здесь я не могу проверить эти условия или этот канал поддержки.",
  uk: "Тут я не можу перевірити ці умови або цей канал підтримки.",
  cs: "Tyto podmínky ani tento kanál podpory zde nemohu ověřit.",
  sk: "Tieto podmienky ani tento kanál podpory tu nemôžem overiť.",
  ro: "Nu pot verifica aceste condiții sau acest canal de asistență aici.",
  bg: "Тук не мога да проверя тези условия или този канал за поддръжка.",
  el: "Δεν μπορώ να επαληθεύσω αυτούς τους όρους ή αυτό το κανάλι υποστήριξης εδώ.",
  he: "איני יכול לאמת כאן את התנאים האלה או את ערוץ התמיכה הזה.",
  th: "ฉันไม่สามารถตรวจสอบเงื่อนไขหรือช่องทางช่วยเหลือนี้ได้ที่นี่",
  vi: "Tôi không thể xác minh những điều kiện hoặc kênh hỗ trợ đó tại đây.",
  ms: "Saya tidak dapat mengesahkan syarat atau saluran bantuan tersebut di sini.",
  ta: "இந்த நிபந்தனைகள் அல்லது ஆதரவு வழியை இங்கே என்னால் சரிபார்க்க முடியாது.",
  bn: "এখানে আমি এই শর্তগুলো বা সহায়তার মাধ্যম যাচাই করতে পারছি না।",
  ur: "میں یہاں ان شرائط یا مدد کے اس ذریعے کی تصدیق نہیں کر سکتا۔",
  fa: "اینجا نمی‌توانم این شرایط یا این مسیر پشتیبانی را تأیید کنم.",
  sw: "Siwezi kuthibitisha masharti hayo au njia hiyo ya usaidizi hapa.",
  tl: "Hindi ko ma-verify rito ang mga kundisyong iyon o ang paraan ng paghingi ng tulong.",
  ca: "No puc verificar aquestes condicions o aquest canal d’assistència aquí.",
  hr: "Ovdje ne mogu provjeriti te uvjete ili taj kanal podrške.",
  sr: "Овде не могу да проверим те услове или тај канал подршке.",
  lt: "Čia negaliu patikrinti šių sąlygų ar šio pagalbos kanalo.",
  lv: "Šeit nevaru pārbaudīt šos nosacījumus vai šo atbalsta kanālu.",
  et: "Ma ei saa siin neid tingimusi ega seda tugikanalit kontrollida.",
});

export function buildSupportGuidanceUnavailableCopy(language = "en") {
  const code = normalizeCharacterLanguage(language)?.code
    || normalizeCharacterLanguage(String(language).split(/[-_]/)[0])?.code;
  return COPY[code] || "";
}
