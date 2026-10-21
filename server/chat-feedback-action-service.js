import { isGeneralCommerceExplanation } from './business-claim-audit-service.js';
import { hasCheckoutIssue } from "./checkout-support-guidance.js";
import { isAiTransportFallback } from "./ai-reply-fallback-service.js";
import { isStorefrontGuidanceCharacter, resolveOrderActionPromptState } from "./chat-global-reply-policy.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";

const NO_MATCH_SOURCES = new Set([
  "site-product-no-match",
  "guest-site-product-no-match",
]);

const HUMAN_HANDOFF_LABELS = Object.freeze({
  en: "Click here", zh: "点击这里", es: "Haz clic aquí", fr: "Cliquez ici", de: "Hier klicken",
  pt: "Clique aqui", it: "Clicca qui", ja: "こちらをクリック", ko: "여기를 클릭하세요", ar: "اضغط هنا",
  hi: "यहाँ क्लिक करें", id: "Klik di sini", tr: "Buraya tıkla", nl: "Klik hier", pl: "Kliknij tutaj",
  sv: "Klicka här", no: "Klikk her", da: "Klik her", fi: "Napsauta tästä", ru: "Нажмите здесь",
  uk: "Натисніть тут", cs: "Klikněte zde", sk: "Kliknite sem", hu: "Kattints ide", ro: "Apasă aici",
  bg: "Натиснете тук", el: "Πατήστε εδώ", he: "לחצו כאן", th: "คลิกที่นี่", vi: "Nhấp vào đây",
  ms: "Klik di sini", ta: "இங்கே கிளிக் செய்யவும்", bn: "এখানে ক্লিক করুন", ur: "یہاں کلک کریں", fa: "اینجا کلیک کنید",
  sw: "Bofya hapa", tl: "Pindutin dito", ca: "Fes clic aquí", hr: "Kliknite ovdje", sr: "Кликните овде",
  lt: "Spustelėkite čia", lv: "Noklikšķiniet šeit", et: "Klõpsake siin",
});

export function resolveChatFeedbackActionCandidate({ character = {}, productContext = null, knowledgeContext = null, orderActionCandidate = null, userText = "", searchIntent = productContext?.searchIntent || {} } = {}) {
  if (searchIntent?.replyBoundary?.contactAllowed === false) return null;
  if (!isStorefrontGuidanceCharacter(character)) return null;
  const handoff = searchIntent?.humanHandoff;
  // Evidence must belong to this turn. Existing product cards do not suppress
  // an explicit request for human help or negotiated business terms.
  const handoffEvidence = typeof handoff?.evidence === "string" ? handoff.evidence.trim() : "";
  const businessEvidence = typeof searchIntent?.businessInquiry?.evidence === "string" ? searchIntent.businessInquiry.evidence.trim() : "";
  const businessReview = handoff?.businessReviewRequired === true && ["quotation", "negotiation", "contract", "commercial_terms"].includes(handoff?.reviewReason)
    && ["quotation", "wholesale", "dropshipping", "distribution", "sponsorship", "partnership", "business_other"].includes(searchIntent?.businessInquiry?.kind)
    && businessEvidence && String(userText || "").includes(businessEvidence);
  if (searchIntent?.replyBoundary?.contactAllowed === true && Number.isFinite(Number(searchIntent?.commerceConfidence)) && Number(searchIntent.commerceConfidence) >= .75
    && handoffEvidence && String(userText || "").includes(handoffEvidence)
    && (handoff.explicitRequest === true || businessReview)) {
    const label = HUMAN_HANDOFF_LABELS[resolveCharacterLanguage(character)];
    return label ? { kind: "feedback", label, reason: handoff.explicitRequest ? "human_request" : "business_review" } : null;
  }
  if (hasCheckoutIssue(searchIntent)) {
    const failedWithoutKnowledge = searchIntent.checkoutIssue.failedAttempts.length > 0
      && Array.isArray(knowledgeContext?.items) && knowledgeContext.items.length === 0;
    const label = HUMAN_HANDOFF_LABELS[resolveCharacterLanguage(character)];
    return failedWithoutKnowledge && searchIntent.replyBoundary?.contactAllowed === true && label
      ? { kind: "feedback", label, reason: "checkout_review" } : null;
  }
  // A current-product sizing answer uses its own verified table/uncertainty,
  // not missing policy knowledge as a reason to request contact details.
  if (["current-product-sizing-context", "guest-current-product-sizing-context"].includes(productContext?.sourceRef)) return null;
  const orderActionAvailable = Boolean(resolveOrderActionPromptState(orderActionCandidate));
  const unavailableTracking = !orderActionAvailable && !isGeneralCommerceExplanation(searchIntent) && isTrackingReference(userText);
  const jerseyCustomizationInquiry = isJerseyCustomizationInquiry(productContext, userText);
  const returnsInquiry = knowledgeContext?.customerServiceTopic === "returns";
  if (Array.isArray(productContext?.products) && productContext.products.length && !jerseyCustomizationInquiry && !unavailableTracking && !returnsInquiry) return null;

  const noProductMatch = NO_MATCH_SOURCES.has(String(productContext?.sourceRef || ""))
    && String(productContext?.searchOutcome || "") === "no_match";
  const orderDeliveryHandoff = orderActionAvailable && (knowledgeContext?.customerServiceTopic === "delivery" || searchIntent?.commerceTopic === "delivery");
  const businessConfidence = Number(searchIntent?.commerceConfidence);
  const verifiedBusinessInquiry = ["quotation", "wholesale", "dropshipping", "distribution", "sponsorship", "partnership", "business_other"].includes(searchIntent?.businessInquiry?.kind)
    && Number.isFinite(businessConfidence) && businessConfidence >= .75 && businessConfidence <= 1
    && Boolean(businessEvidence) && String(userText || "").includes(businessEvidence);
  // Business retrieval includes store identity and other ordinary chat. Empty
  // knowledge alone cannot turn those introductions into a contact request.
  const productQuestionNeedsService = searchIntent?.commerceRoute === "product_question"
    && ["authenticity", "delivery", "returns", "support", "material", "sizing", "price", "stock"].includes(searchIntent?.commerceTopic);
  const hasCommerceRoute = ["chat", "product_search", "product_question", "store_policy"].includes(searchIntent?.commerceRoute);
  const legacyServiceTopic = !hasCommerceRoute
    && (["authenticity", "delivery", "returns", "support"].includes(knowledgeContext?.customerServiceTopic)
      || ["authenticity", "delivery", "returns", "support"].includes(searchIntent?.commerceTopic));
  const missingKnowledgeNeedsService = searchIntent?.commerceRoute === "store_policy"
    || productQuestionNeedsService
    || verifiedBusinessInquiry
    || legacyServiceTopic;
  // A failed selector has not established that policy is absent. Keep real
  // human requests, returns, tracking and business-review actions independent.
  const retrievalUnavailable = ["business_selection_unavailable", "business_directory_limit"].includes(knowledgeContext?.strategy);
  const noKnowledgeReference = searchIntent?.commerceTopic !== "sizing" && !retrievalUnavailable && !orderDeliveryHandoff && knowledgeContext?.customerServiceIntent === true
    && Array.isArray(knowledgeContext?.items)
    && knowledgeContext.items.length === 0 && missingKnowledgeNeedsService;
  if (!jerseyCustomizationInquiry && !noProductMatch && !noKnowledgeReference && !unavailableTracking && !returnsInquiry) return null;

  return {
    kind: jerseyCustomizationInquiry ? "jersey_customization" : "feedback",
    label: resolveFeedbackActionLabel(character),
  };
}

export function resolveChatFeedbackAction({ character = {}, productContext = null, knowledgeContext = null, orderActionCandidate = null, replyResult = {}, userText = "", feedbackActionCandidate = null, searchIntent = productContext?.searchIntent || replyResult || {} } = {}) {
  if (searchIntent?.replyBoundary?.contactAllowed === false) return null;
  if (isAiTransportFallback(replyResult)) return null;
  // A confirmed candidate is server-side business state. It remains safe to persist
  // when a controlled response replaces the model text (for example, tracking).
  if (feedbackActionCandidate) return feedbackActionCandidate;
  if (String(replyResult?.sourceType || "ai").toLowerCase() !== "ai") return null;
  return resolveChatFeedbackActionCandidate({ character, productContext, knowledgeContext, orderActionCandidate, userText, searchIntent });
}

function isJerseyCustomizationInquiry(productContext = null, userText = "") {
  const searchIntent = productContext?.searchIntent || {};
  return isJerseyCustomizationText(userText)
    || safeString(searchIntent?.customizationRequest).toLowerCase() === "jersey"
    || searchIntent?.productCustomizationRequest === true
    || ["product-customization-guidance", "guest-product-customization-guidance"].includes(
      safeString(productContext?.sourceRef)
    );
}

function isJerseyCustomizationText(value = "") {
  const text = safeString(value);
  if (!text) return false;
  const customization = /\b(?:customi[sz](?:e|ed|ing|ation)?|personali[sz](?:e|ed|ing|ation)?|nameset|print(?:ed|ing)?)\b|(?:定制|印号|印字|姓名|号码|臂章|徽章)/i.test(text);
  const jersey = /\b(?:jersey|shirt|kit|kits|strip|strips|nameset|player|name|number|back|patch(?:es)?)\b|(?:球衣|队服|印号|印字|姓名|号码|臂章|徽章)/i.test(text);
  return customization && jersey;
}

export function isTrackingReference(value = "") {
  const text = safeString(value);
  if (!text) return false;
  return /(?:tracking(?:\s+(?:code|number|status))?|track\s+(?:my\s+)?(?:parcel|package|order|delivery)|物流|快递|包裹追踪|追踪(?:号|码)?|运单号|fuvarlev[eé]l(?:sz[aá]m)?|csomagk[oö]vet[eé]s(?:i)?|k[uü]ldem[eé]nyk[oö]vet[eé]s|kargo\s*takip|takip\s*(?:numaras[ıi]|kodu)|num[eé]ro\s+de\s+suivi|suivi\s+de\s+colis|رقم\s*التتبع|تتبع\s*(?:الشحنة|الطلب))/iu.test(text)
    || /\b[A-Z]{2,8}[-_ ]?\d{6,18}(?:[-_ ]?[A-Z0-9]{2,8})?\b/i.test(text);
}

export function appendFeedbackFollowupCopy(text, { character = {}, feedbackAction = null, searchIntent = {} } = {}) {
  const reply = String(text || "").trim();
  if (!feedbackAction || searchIntent?.replyBoundary?.contactAllowed === false) return reply;
  const suffix = resolveHumanHandoffFollowupCopy(character);
  // A chat email or a vague contact invitation does not submit the real form.
  // Deduplicate only the actual localized submission copy; preserve reviewed text.
  if (!suffix || reply.endsWith(suffix)) return reply;
  return reply ? `${reply}\n\n${suffix}` : suffix;
}

function resolveHumanHandoffFollowupCopy(character = {}) {
  const language = resolveCharacterLanguage(character);
  const copy = {
    en: "Use the feedback button below to open the form, then submit your question or business request for the team to review.",
    zh: "点击下方反馈按钮打开表单，填写并提交你的问题或商务需求，供团队查看。",
    es: "Usa el botón de comentarios de abajo para abrir el formulario y envía tu consulta o solicitud comercial para que el equipo pueda revisarla.",
    fr: "Utilisez le bouton de retour ci-dessous pour ouvrir le formulaire, puis envoyez votre question ou demande commerciale afin que l’équipe puisse l’examiner.",
    de: "Öffne das Formular über die Feedback-Schaltfläche unten und sende deine Frage oder geschäftliche Anfrage zur Prüfung durch das Team ab.",
    pt: "Use o botão de feedback abaixo para abrir o formulário e envie a sua dúvida ou pedido comercial para análise pela equipa.",
    it: "Usa il pulsante di feedback qui sotto per aprire il modulo e invia la tua domanda o richiesta commerciale al team per una verifica.",
    hu: "Az alábbi visszajelzési gombbal nyisd meg az űrlapot, majd küldd be a kérdésedet vagy üzleti megkeresésedet, hogy a csapat átnézhesse.",
    tr: "Formu açmak için aşağıdaki geri bildirim düğmesini kullan, ardından ekibin incelemesi için sorunu veya ticari talebini gönder.",
    ar: "استخدم زر الملاحظات أدناه لفتح النموذج، ثم أرسل سؤالك أو طلبك التجاري ليتمكن الفريق من مراجعته.",
    ja: "下のフィードバックボタンからフォームを開き、質問やビジネスに関する依頼を入力して送信してください。チームが内容を確認できます。",
    ko: "아래 피드백 버튼으로 양식을 열고 질문이나 사업 관련 요청을 작성해 제출하면 팀에서 내용을 검토할 수 있습니다.",
    hi: "नीचे दिए गए फ़ीडबैक बटन से फ़ॉर्म खोलें, फिर अपना सवाल या व्यावसायिक अनुरोध भरकर जमा करें ताकि टीम उसकी समीक्षा कर सके।",
    id: "Gunakan tombol umpan balik di bawah untuk membuka formulir, lalu kirim pertanyaan atau permintaan bisnis Anda agar tim dapat meninjaunya.",
    nl: "Open het formulier via de feedbackknop hieronder en dien je vraag of zakelijke verzoek in zodat het team dit kan beoordelen.",
    pl: "Otwórz formularz przyciskiem opinii poniżej, a następnie wyślij pytanie lub zapytanie biznesowe, aby zespół mógł je rozpatrzyć.",
    sv: "Öppna formuläret med feedbackknappen nedan och skicka sedan din fråga eller affärsförfrågan så att teamet kan granska den.",
    no: "Åpne skjemaet med tilbakemeldingsknappen nedenfor, og send inn spørsmålet eller forretningsforespørselen din slik at teamet kan vurdere den.",
    da: "Åbn formularen med feedbackknappen nedenfor, og indsend dit spørgsmål eller din forretningsforespørgsel, så teamet kan gennemgå den.",
    fi: "Avaa lomake alla olevasta palautepainikkeesta ja lähetä kysymyksesi tai liiketoimintapyyntösi, jotta tiimi voi käsitellä sen.",
    ru: "Нажмите кнопку обратной связи ниже, чтобы открыть форму, затем отправьте свой вопрос или деловой запрос на рассмотрение команды.",
    uk: "Натисніть кнопку зворотного зв’язку нижче, щоб відкрити форму, а потім надішліть запитання або діловий запит для розгляду командою.",
    cs: "Tlačítkem zpětné vazby níže otevřete formulář a odešlete svůj dotaz nebo obchodní žádost, aby je tým mohl posoudit.",
    sk: "Tlačidlom spätnej väzby nižšie otvorte formulár a odošlite svoju otázku alebo obchodnú žiadosť, aby ju tím mohol posúdiť.",
    ro: "Folosește butonul de feedback de mai jos pentru a deschide formularul, apoi trimite întrebarea sau solicitarea comercială pentru analiza echipei.",
    bg: "Отворете формуляра чрез бутона за обратна връзка по-долу, след което изпратете въпроса или бизнес запитването си за преглед от екипа.",
    el: "Ανοίξτε τη φόρμα από το κουμπί σχολίων παρακάτω και υποβάλετε την ερώτηση ή το επιχειρηματικό σας αίτημα για να το εξετάσει η ομάδα.",
    he: "פתחו את הטופס באמצעות כפתור המשוב למטה, ואז שלחו את השאלה או הפנייה העסקית כדי שהצוות יוכל לבדוק אותה.",
    th: "ใช้ปุ่มข้อเสนอแนะด้านล่างเพื่อเปิดแบบฟอร์ม แล้วกรอกและส่งคำถามหรือคำขอทางธุรกิจของคุณให้ทีมงานพิจารณา",
    vi: "Dùng nút phản hồi bên dưới để mở biểu mẫu, rồi gửi câu hỏi hoặc yêu cầu kinh doanh của bạn để nhóm có thể xem xét.",
    ms: "Gunakan butang maklum balas di bawah untuk membuka borang, kemudian hantar soalan atau permintaan perniagaan anda untuk semakan pasukan.",
    ta: "கீழே உள்ள கருத்து பொத்தானை அழுத்தி படிவத்தைத் திறந்து, உங்கள் கேள்வி அல்லது வணிகக் கோரிக்கையை குழு பரிசீலிப்பதற்காகச் சமர்ப்பிக்கவும்.",
    bn: "নিচের মতামত বোতামটি দিয়ে ফর্ম খুলুন, তারপর দলের পর্যালোচনার জন্য আপনার প্রশ্ন বা ব্যবসায়িক অনুরোধ জমা দিন।",
    ur: "نیچے موجود فیڈبیک بٹن سے فارم کھولیں، پھر اپنا سوال یا کاروباری درخواست جمع کرائیں تاکہ ٹیم اس کا جائزہ لے سکے۔",
    fa: "با دکمه بازخورد در پایین، فرم را باز کنید و سپس سؤال یا درخواست تجاری خود را برای بررسی تیم ارسال کنید.",
    sw: "Fungua fomu kwa kutumia kitufe cha maoni hapa chini, kisha tuma swali au ombi lako la biashara ili timu iweze kulipitia.",
    tl: "Gamitin ang pindutan ng feedback sa ibaba upang buksan ang form, saka isumite ang tanong o kahilingang pangnegosyo mo para masuri ng koponan.",
    ca: "Obre el formulari amb el botó de comentaris de sota i envia la teva pregunta o sol·licitud comercial perquè l’equip la pugui revisar.",
    hr: "Otvorite obrazac gumbom za povratne informacije u nastavku, a zatim pošaljite pitanje ili poslovni upit kako bi ga tim mogao pregledati.",
    sr: "Отворите образац помоћу дугмета за повратне информације испод, затим пошаљите питање или пословни упит да би тим могао да га размотри.",
    lt: "Atidarykite formą paspaudę žemiau esantį atsiliepimų mygtuką, tada pateikite klausimą ar verslo užklausą, kad komanda galėtų ją peržiūrėti.",
    lv: "Atveriet veidlapu ar zemāk esošo atsauksmju pogu, pēc tam iesniedziet jautājumu vai biznesa pieprasījumu, lai komanda to varētu izskatīt.",
    et: "Avage vorm alloleva tagasisidenupu kaudu ja saatke oma küsimus või äripäring meeskonnale läbivaatamiseks.",
  };
  return copy[language] || "";
}

function resolveFeedbackActionLabel(character = {}) {
  const language = resolveCharacterLanguage(character);
  if (language.includes("chinese") || language.startsWith("zh")) return "点击这里";
  if (language.includes("spanish") || language.startsWith("es")) return "Haz clic aquí";
  if (language.includes("french") || language.startsWith("fr")) return "Cliquez ici";
  if (language.includes("german") || language.startsWith("de")) return "Hier klicken";
  if (language.includes("portuguese") || language.startsWith("pt")) return "Clique aqui";
  if (language.includes("italian") || language.startsWith("it")) return "Clicca qui";
  if (language.includes("hungarian") || language.startsWith("hu")) return "Kattints ide";
  if (language.includes("turkish") || language.startsWith("tr")) return "Buraya tıkla";
  if (language.includes("arabic") || language.startsWith("ar")) return "اضغط هنا";
  return "Click here";
}

function resolveCharacterLanguage(character = {}) {
  const profile = parseJsonObject(character?.profile_json || character?.profile);
  const preferred = profile?.languageCode
    || profile?.defaultLanguageCode
    || profile?.languageLabel
    || profile?.defaultLanguageLabel
    || profile?.language
    || character?.languageCode
    || character?.language;
  return String(normalizeCharacterLanguage(preferred)?.code || preferred || "").trim().toLowerCase();
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeString(value) {
  return String(value || "").trim();
}
