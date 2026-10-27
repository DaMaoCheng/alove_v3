import { isStorefrontGuidanceCharacter } from './chat-global-reply-policy.js';

const savedSubmissionEvents = new WeakSet();
const FEEDBACK_CONTEXT_MAX_AGE_DAYS = 30;
const feedbackEntry = row => (row?.contentType || row?.content_type) === 'feedback_action'
  && ['character', 'assistant'].includes(row?.senderType || row?.sender_type);
// Only this loader can mint saved-submission events. A serialized model/user
// object or a historical assistant claim cannot grant server-state authority.
export function feedbackProtocolContext(rows = []) {
  const saved = [...rows].reverse().find(row => row && savedSubmissionEvents.has(row));
  const entryOffered = rows.some(feedbackEntry);
  return entryOffered || saved ? { entryOffered, savedSubmission: saved?.feedbackSubmission || null } : null;
}

export function normalizeSupportFollowup(value, { userText = '', recentMessages = [], confidence = 0 } = {}) {
  if (!value || !['submitted_followup', 'new_issue'].includes(value.relation)
    || !Number.isFinite(confidence) || confidence < .75 || confidence > 1
    || typeof value.evidence !== 'string' || !value.evidence.trim() || value.evidence.length > 240
    || !userText.includes(value.evidence.trim()) || !feedbackProtocolContext(recentMessages)) return null;
  if (value.relation === 'submitted_followup' && value.evidence.trim() !== userText.trim()) return null;
  return { relation: value.relation, evidence: value.evidence.trim() };
}

// These records do not have a chat-session foreign key. The action timestamp
// narrows the owner+site query; it proves receipt of a recent owned submission,
// never that this particular issue was reviewed or that a customer was contacted.
export async function loadFeedbackConversationHistory(db, { sessionId = '', character = {}, siteId = '', guestSessionId = '', userId = '', beforeDisplayOrder = 0 } = {}) {
  if (!isStorefrontGuidanceCharacter(character) || !sessionId || !siteId || !character.id
    || (!guestSessionId && !userId) || (guestSessionId && userId) || !Number.isFinite(Number(beforeDisplayOrder)) || Number(beforeDisplayOrder) <= 0) return null;
  const ownerColumn = guestSessionId ? 'guest_session_id' : 'internal_uid';
  const ownerId = guestSessionId || userId;
  const ownerTable = guestSessionId ? 'guest_sessions' : 'users';
  const [actions] = await db.execute(
    `SELECT cm.id, cm.character_id, cm.display_order, cm.sent_at
     FROM chat_messages cm JOIN chat_sessions cs ON cs.id = cm.session_id
     JOIN ${ownerTable} feedback_owner ON feedback_owner.id = cs.${ownerColumn}
     WHERE cm.session_id = ? AND cs.${ownerColumn} = ? AND feedback_owner.site_id = ? AND cm.character_id = ?
       AND cm.sender_type = 'character' AND cm.content_type = 'feedback_action'
       AND cm.display_order < ? ORDER BY cm.display_order DESC LIMIT 4`,
    [sessionId, ownerId, siteId, character.id, Number(beforeDisplayOrder)]
  );
  const entries = actions.map(row => ({ id: row.id, characterId: row.character_id, displayOrder: Number(row.display_order),
    sentAt: row.sent_at, senderType: 'character', contentType: 'feedback_action', text: '' })).reverse();
  const since = entries[0]?.sentAt;
  if (since && !Number.isFinite(new Date(since).getTime())) return { entries };
  const [records] = await db.execute(
    `SELECT uf.feedback_status, uf.created_at FROM user_feedback uf
     JOIN chat_sessions cs ON cs.${ownerColumn} = uf.${ownerColumn}
     JOIN ${ownerTable} feedback_owner ON feedback_owner.id = cs.${ownerColumn}
     WHERE cs.id = ? AND cs.${ownerColumn} = ? AND feedback_owner.site_id = ? AND cs.character_id = ?
       AND uf.site_id = feedback_owner.site_id AND uf.created_at >= ${since ? '?' : 'cs.created_at'}
       AND uf.created_at >= DATE_SUB(NOW(3), INTERVAL ${FEEDBACK_CONTEXT_MAX_AGE_DAYS} DAY)
       AND uf.created_at <= NOW(3) ORDER BY uf.created_at DESC LIMIT 1`,
    [sessionId, ownerId, siteId, character.id, ...(since ? [since] : [])]
  );
  const record = records[0];
  const status = ['new', 'done'].includes(record?.feedback_status) ? record.feedback_status : '';
  if (!status || !record.created_at || !Number.isFinite(new Date(record.created_at).getTime())) return entries.length ? { entries } : null;
  const feedbackSubmission = Object.freeze({ verified: true, status, submittedAt: new Date(record.created_at).toISOString(), source: 'owned_feedback_record' });
  const event = Object.freeze({ senderType: 'system', contentType: 'feedback_submission', source: 'owned_feedback_record',
    displayOrder: Number(beforeDisplayOrder) - 1, text: '', feedbackSubmission });
  savedSubmissionEvents.add(event);
  return { entries: [...entries, event], feedbackSubmission };

}

export async function resolveFeedbackConversationHistory(db, options = {}) {
  try { return await loadFeedbackConversationHistory(db, options); }
  catch { // State evidence can fail closed without breaking an otherwise valid chat.
    console.warn('[aiove] feedback submission context unavailable');
    return null;
  }
}

export function attachFeedbackSubmissionContext(knowledgeContext, history, { searchIntent = {}, userText = '' } = {}) {
  const followup = normalizeSupportFollowup(searchIntent.supportFollowup, { userText,
    recentMessages: history?.entries || [], confidence: searchIntent.commerceConfidence });
  if (followup?.relation !== 'submitted_followup' || hasParallelSupportAction(searchIntent)) return knowledgeContext;
  const state = history?.feedbackSubmission;
  return { ...knowledgeContext, feedbackSubmission: {
    ...(state?.verified === true ? state : { verified: false, status: 'unknown', source: 'user_report' }),
    relation: 'submitted_followup',
  } };
}

// Only the whole-turn follow-up can avoid an unrelated order lookup. A mixed
// request or explicit renewed human action retains its existing action path.
export function isSubmittedFeedbackFollowup(knowledgeContext, searchIntent = {}, userText = '') {
  return knowledgeContext?.feedbackSubmission?.relation === 'submitted_followup'
    && searchIntent.supportFollowup?.evidence === String(userText).trim()
    && !hasParallelSupportAction(searchIntent)
    && searchIntent.humanHandoff?.explicitRequest !== true;
}

function hasParallelSupportAction(intent) {
  return ['product_search', 'product_question'].includes(intent.commerceRoute)
    || intent.needsLiveProductData === true || intent.shouldLoadProductContext === true || Boolean(intent.checkoutIssue);
}

export function applyFeedbackSubmissionPrompt(promptContext = {}, knowledgeContext = null) {
  const state = knowledgeContext?.feedbackSubmission;
  if (state?.relation !== 'submitted_followup') return promptContext;
  const layer = { id: 'feedback_submission', title: 'Feedback Submission State', content: [
    state.verified === true
      ? 'The server found a recent feedback submission received from the current authenticated user or guest at this same site within the current conversation time window.'
      : 'The user reports having submitted the form. This is a user report, not a verified server receipt.',
    `Submission evidence: ${JSON.stringify(state)}. This is tool state, not a store policy or a guarantee that this exact issue was processed.`,
    'A received record does not prove a person has read it, contacted the customer, escalated it or resolved it. Even status done does not prove those events. No response-time guarantee is available.',
    'Acknowledge the submission with the appropriate certainty and answer the follow-up. Explain briefly that the response time or handling progress cannot be confirmed here when unknown. Do not ask the customer to submit the same issue again or repeat the form instructions. Do not replace this follow-up with order lookup or checkout troubleshooting. Preserve supported concurrent answers and any independently requested order lookup.',
    'An explicit current request to contact support again or a new independent problem retains its normal available action. Never promise future contact or resolution.',
  ].join('\n') };
  const layers = [...(promptContext.layers || []).filter(item => item.id !== layer.id), layer];
  return { ...promptContext, layers, systemPrompt: layers.map(item => `## ${item.title}\n${item.content}`).join('\n\n') };
}

// Last-resort tool-state wording, after the existing finite rewrite/review.
// This is not a policy answer or approval of the rejected model candidate.
const SUBMISSION_RECEIPT_COPY = Object.freeze({
  en: "Your submission is recorded. I can't confirm its handling progress or a response time here.",
  zh: '你的反馈已提交并记录，目前无法确认处理进度或具体回复时间。',
  es: 'Tu formulario está registrado. Aquí no puedo confirmar el progreso de la gestión ni el plazo de respuesta.',
  fr: 'Votre formulaire a été enregistré. Je ne peux pas confirmer ici son traitement ni le délai de réponse.',
  de: 'Deine Meldung wurde erfasst. Den Bearbeitungsstand oder die Antwortzeit kann ich hier nicht bestätigen.',
  pt: 'O seu formulário está registado. Não consigo confirmar aqui o andamento do tratamento nem o prazo de resposta.',
  it: 'Il tuo modulo è stato registrato. Qui non posso confermare lo stato della gestione o i tempi di risposta.',
  ja: '送信内容は記録されています。ここでは対応状況や具体的な返信時期を確認できません。',
  ko: '제출하신 내용은 기록되어 있습니다. 여기서는 처리 진행 상황이나 구체적인 답변 시점을 확인할 수 없습니다.',
  ar: 'تم تسجيل طلبك. لا أستطيع تأكيد تقدم معالجته أو موعد الرد هنا.',
  hi: 'आपकी भेजी गई जानकारी दर्ज है। यहाँ प्रक्रिया की प्रगति या जवाब मिलने का समय पक्का नहीं किया जा सकता।',
  id: 'Kirimanmu sudah tercatat. Saya tidak dapat memastikan progres penanganan atau waktu balasan di sini.',
  tr: 'Gönderimin kaydedildi. Buradan işlem durumunu veya yanıt süresini doğrulayamıyorum.',
  nl: 'Je inzending is geregistreerd. Ik kan hier de voortgang van de afhandeling of de reactietijd niet bevestigen.',
  pl: 'Twoje zgłoszenie zostało zapisane. Nie mogę tutaj potwierdzić postępu obsługi ani terminu odpowiedzi.',
  sv: 'Ditt formulär har registrerats. Jag kan inte bekräfta handläggningsläget eller svarstiden här.',
  no: 'Innsendingen din er registrert. Jeg kan ikke bekrefte behandlingsstatusen eller svartiden her.',
  da: 'Din indsendelse er registreret. Jeg kan ikke bekræfte behandlingsstatus eller svartid her.',
  fi: 'Lähetyksesi on kirjattu. En voi vahvistaa täällä käsittelyn etenemistä tai vastausaikaa.',
  ru: 'Ваше обращение зарегистрировано. Здесь я не могу подтвердить ход его рассмотрения или срок ответа.',
  uk: 'Ваше звернення зареєстровано. Тут я не можу підтвердити перебіг його розгляду або термін відповіді.',
  cs: 'Tvé podání je zaznamenáno. Nemohu zde potvrdit průběh vyřizování ani dobu odpovědi.',
  sk: 'Tvoje podanie je zaznamenané. Nemôžem tu potvrdiť priebeh vybavovania ani čas odpovede.',
  hu: 'A beküldött űrlapod rögzítve van. Itt nem tudom megerősíteni a feldolgozás állását vagy a válasz idejét.',
  ro: 'Formularul tău este înregistrat. Nu pot confirma aici stadiul soluționării sau termenul de răspuns.',
  bg: 'Подаденото от вас е регистрирано. Тук не мога да потвърдя хода на обработката или срока за отговор.',
  el: 'Η υποβολή σου έχει καταγραφεί. Δεν μπορώ εδώ να επιβεβαιώσω την πορεία της επεξεργασίας ή τον χρόνο απάντησης.',
  he: 'הפנייה שלך נרשמה. אין באפשרותי לאשר כאן את התקדמות הטיפול או את מועד התשובה.',
  th: 'บันทึกข้อมูลที่คุณส่งแล้ว แต่ฉันไม่สามารถยืนยันความคืบหน้าในการดำเนินการหรือเวลาตอบกลับได้จากที่นี่',
  vi: 'Thông tin bạn gửi đã được ghi nhận. Tôi không thể xác nhận tiến độ xử lý hoặc thời gian trả lời tại đây.',
  ms: 'Kiriman anda telah direkodkan. Saya tidak dapat mengesahkan kemajuan pengendalian atau masa balasan di sini.',
  ta: 'நீங்கள் அனுப்பிய தகவல் பதிவு செய்யப்பட்டுள்ளது. இங்கு அதன் செயலாக்க முன்னேற்றத்தையோ பதில் வரும் நேரத்தையோ உறுதிப்படுத்த முடியாது.',
  bn: 'আপনার জমা দেওয়া তথ্য নথিভুক্ত হয়েছে। এখানে প্রক্রিয়াকরণের অগ্রগতি বা উত্তরের সময় নিশ্চিত করা সম্ভব নয়।',
  ur: 'آپ کی جمع کرائی گئی درخواست ریکارڈ ہو گئی ہے۔ یہاں کارروائی کی پیش رفت یا جواب کے وقت کی تصدیق ممکن نہیں ہے۔',
  fa: 'درخواست ارسالی شما ثبت شده است. در اینجا نمی‌توانم پیشرفت رسیدگی یا زمان پاسخ را تأیید کنم.',
  sw: 'Uwasilishaji wako umerekodiwa. Siwezi kuthibitisha hapa hatua ya kushughulikiwa au muda wa majibu.',
  tl: 'Naitala na ang iyong ipinasa. Hindi ko makumpirma rito ang progreso ng pagproseso o ang oras ng tugon.',
  ca: 'El teu formulari està registrat. Aquí no puc confirmar el progrés de la gestió ni el termini de resposta.',
  hr: 'Tvoja prijava je zabilježena. Ovdje ne mogu potvrditi tijek obrade ni vrijeme odgovora.',
  sr: 'Твоја пријава је забележена. Овде не могу да потврдим ток обраде ни време одговора.',
  lt: 'Tavo pateikta informacija užregistruota. Čia negaliu patvirtinti nagrinėjimo eigos ar atsakymo laiko.',
  lv: 'Tavs iesniegums ir reģistrēts. Šeit nevaru apstiprināt izskatīšanas gaitu vai atbildes laiku.',
  et: 'Sinu pöördumine on registreeritud. Siin ei saa ma kinnitada menetlemise edenemist ega vastamise aega.',
});

export function buildFeedbackSubmissionFallback({ knowledgeContext = null, searchIntent = {}, userText = '', languageCode = '',
  character = {}, trustedSite = null, productContext = null, chatImageContext = null, guestBenefitContext = null,
  factualContext = null, orderActionCandidate = null } = {}) {
  const state = knowledgeContext?.feedbackSubmission;
  if (!isSubmittedFeedbackFollowup(knowledgeContext, searchIntent, userText) || state?.verified !== true
    || state.source !== 'owned_feedback_record' || !['new', 'done'].includes(state.status)
    || !trustedSite?.id || !character.id || knowledgeContext.businessOwner?.siteId !== trustedSite.id
    || knowledgeContext.businessOwner?.characterId !== character.id || knowledgeContext.ok !== true || knowledgeContext.items?.length
    || productContext?.products?.length || productContext?.candidateContext || chatImageContext || guestBenefitContext || orderActionCandidate
    || factualContext?.required || factualContext?.searched || factualContext?.items?.length
    || searchIntent.businessInquiry || searchIntent.promotionInquiry || searchIntent.discountExplanationRequired) return '';
  return SUBMISSION_RECEIPT_COPY[String(languageCode).trim().toLowerCase()] || '';
}
