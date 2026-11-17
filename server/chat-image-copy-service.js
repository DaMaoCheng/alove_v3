import { createSiteCopy } from "../src/i18n/site-copy.js";
import { normalizeCharacterLanguage } from "../shared/language-library.js";

const STATUS_KEYS = Object.freeze({
  queued: "chat.imageQueued",
  generating: "chat.imageGenerating",
  ready: "chat.imageReady",
  failed: "chat.imageFailed",
  cancelled: "chat.imageCancelled",
});

// The chat supports more character languages than the site UI. Keep the two
// successful-delivery acknowledgements here without expanding the UI bundles.
const ADDITIONAL_CHARACTER_STATUS_COPY = {
  de: ["Das Foto wird erstellt...", "Das Foto ist fertig."],
  pt: ["Preparando a foto...", "A foto está pronta."],
  it: ["Preparazione della foto...", "La foto è pronta."],
  ja: ["写真を準備しています…", "写真ができました。"],
  ko: ["사진을 준비하고 있어요...", "사진이 준비됐어요."],
  hi: ["तस्वीर तैयार हो रही है...", "तस्वीर तैयार है।"],
  id: ["Menyiapkan foto...", "Foto sudah siap."],
  nl: ["De foto wordt gemaakt...", "De foto is klaar."],
  pl: ["Przygotowuję zdjęcie...", "Zdjęcie jest gotowe."],
  sv: ["Förbereder fotot...", "Fotot är klart."],
  no: ["Forbereder bildet...", "Bildet er klart."],
  da: ["Forbereder billedet...", "Billedet er klar."],
  fi: ["Valmistelen kuvaa...", "Kuva on valmis."],
  ru: ["Готовлю фото...", "Фото готово."],
  uk: ["Готую фото...", "Фото готове."],
  cs: ["Připravuji fotku...", "Fotka je připravená."],
  sk: ["Pripravujem fotku...", "Fotka je pripravená."],
  ro: ["Pregătesc fotografia...", "Fotografia este gata."],
  bg: ["Подготвям снимката...", "Снимката е готова."],
  el: ["Ετοιμάζω τη φωτογραφία...", "Η φωτογραφία είναι έτοιμη."],
  he: ["התמונה בהכנה...", "התמונה מוכנה."],
  th: ["กำลังเตรียมรูปภาพ...", "รูปภาพพร้อมแล้ว"],
  vi: ["Đang chuẩn bị ảnh...", "Ảnh đã sẵn sàng."],
  ms: ["Sedang menyediakan foto...", "Foto sudah siap."],
  ta: ["படம் தயாராகிறது...", "படம் தயாராக உள்ளது."],
  bn: ["ছবি তৈরি হচ্ছে...", "ছবি প্রস্তুত।"],
  ur: ["تصویر تیار ہو رہی ہے...", "تصویر تیار ہے۔"],
  fa: ["در حال آماده‌سازی عکس...", "عکس آماده است."],
  sw: ["Ninaandaa picha...", "Picha iko tayari."],
  tl: ["Inihahanda ang larawan...", "Handa na ang larawan."],
  ca: ["Preparant la foto...", "La foto està a punt."],
  hr: ["Pripremam fotografiju...", "Fotografija je spremna."],
  sr: ["Припремам фотографију...", "Фотографија је спремна."],
  lt: ["Ruošiu nuotrauką...", "Nuotrauka paruošta."],
  lv: ["Gatavoju fotoattēlu...", "Fotoattēls ir gatavs."],
  et: ["Valmistan fotot...", "Foto on valmis."],
};
const existingLanguageEntries = ["en", "zh", "es", "fr", "hu", "tr", "ar"].map((code) => {
  const copy = createSiteCopy(code);
  return [code, Object.freeze({ queued: copy.t(STATUS_KEYS.queued), ready: copy.t(STATUS_KEYS.ready) })];
});
export const CHAT_IMAGE_CHARACTER_STATUS_COPY = Object.freeze(Object.fromEntries([
  ...existingLanguageEntries,
  ...Object.entries(ADDITIONAL_CHARACTER_STATUS_COPY).map(([code, [queued, ready]]) => [code, Object.freeze({ queued, ready })]),
]));

export function getChatImageStatusCopy({ language = "", status = "" } = {}) {
  const normalizedStatus = String(status || "queued").trim().toLowerCase();
  if (["queued", "ready"].includes(normalizedStatus)) {
    const source = language && typeof language === "object"
      ? language.code || language.label || language.defaultLanguage || language.default_language
      : language;
    const characterLanguage = normalizeCharacterLanguage(source)
      || normalizeCharacterLanguage(String(source || "").trim().toLowerCase().split(/[-_]/)[0]);
    const characterCopy = CHAT_IMAGE_CHARACTER_STATUS_COPY[characterLanguage?.code];
    if (characterCopy) return characterCopy[normalizedStatus];
  }
  return createSiteCopy(language).t(STATUS_KEYS[normalizedStatus] || STATUS_KEYS.queued);
}

// Safe reply fallbacks; unlike the UI helper, unknown must never become queued.
const UNVERIFIED_IMAGE_COPY = {
  en: ["I can't confirm the image status right now.", "The image could not be generated."],
  zh: ["我现在无法确认图片状态。", "这次图片没能生成成功。"],
  es: ["Ahora no puedo confirmar el estado de la imagen.", "No se pudo generar la imagen."],
  fr: ["Je ne peux pas confirmer l’état de l’image pour le moment.", "L’image n’a pas pu être générée."],
  hu: ["Most nem tudom megerősíteni a kép állapotát.", "A képet nem sikerült létrehozni."],
  tr: ["Şu anda görselin durumunu doğrulayamıyorum.", "Görsel oluşturulamadı."],
  ar: ["لا أستطيع تأكيد حالة الصورة الآن.", "تعذر إنشاء الصورة."],
  de: ["Ich kann den Bildstatus gerade nicht bestätigen.", "Das Bild konnte nicht erstellt werden."],
  pt: ["Não consigo confirmar o estado da imagem agora.", "Não foi possível gerar a imagem."],
  it: ["Al momento non posso confermare lo stato dell’immagine.", "Non è stato possibile generare l’immagine."],
  ja: ["今は画像の状態を確認できません。", "画像を生成できませんでした。"],
  ko: ["지금은 이미지 상태를 확인할 수 없어요.", "이미지를 생성하지 못했어요."],
  hi: ["अभी मैं तस्वीर की स्थिति की पुष्टि नहीं कर सकता।", "तस्वीर नहीं बन सकी।"],
  id: ["Saat ini saya tidak bisa memastikan status gambar.", "Gambar tidak berhasil dibuat."],
  nl: ["Ik kan de status van de afbeelding nu niet bevestigen.", "De afbeelding kon niet worden gemaakt."],
  pl: ["Nie mogę teraz potwierdzić stanu obrazu.", "Nie udało się wygenerować obrazu."],
  sv: ["Jag kan inte bekräfta bildens status just nu.", "Bilden kunde inte skapas."],
  no: ["Jeg kan ikke bekrefte bildestatusen nå.", "Bildet kunne ikke genereres."],
  da: ["Jeg kan ikke bekræfte billedets status lige nu.", "Billedet kunne ikke genereres."],
  fi: ["En voi nyt vahvistaa kuvan tilaa.", "Kuvan luominen ei onnistunut."],
  ru: ["Сейчас я не могу подтвердить статус изображения.", "Не удалось создать изображение."],
  uk: ["Зараз я не можу підтвердити стан зображення.", "Не вдалося створити зображення."],
  cs: ["Teď nemohu potvrdit stav obrázku.", "Obrázek se nepodařilo vytvořit."],
  sk: ["Teraz nemôžem potvrdiť stav obrázka.", "Obrázok sa nepodarilo vytvoriť."],
  ro: ["Nu pot confirma acum starea imaginii.", "Imaginea nu a putut fi generată."],
  bg: ["В момента не мога да потвърдя състоянието на изображението.", "Изображението не можа да бъде създадено."],
  el: ["Δεν μπορώ να επιβεβαιώσω την κατάσταση της εικόνας τώρα.", "Δεν ήταν δυνατή η δημιουργία της εικόνας."],
  he: ["אין לי אפשרות לאשר כרגע את מצב התמונה.", "לא ניתן היה ליצור את התמונה."],
  th: ["ตอนนี้ยังยืนยันสถานะรูปภาพไม่ได้", "ไม่สามารถสร้างรูปภาพได้"],
  vi: ["Hiện tôi không thể xác nhận trạng thái ảnh.", "Không thể tạo ảnh."],
  ms: ["Saya tidak dapat mengesahkan status gambar sekarang.", "Gambar tidak dapat dijana."],
  ta: ["இப்போது படத்தின் நிலையை உறுதிப்படுத்த முடியவில்லை.", "படத்தை உருவாக்க முடியவில்லை."],
  bn: ["এখন ছবির অবস্থা নিশ্চিত করতে পারছি না।", "ছবিটি তৈরি করা যায়নি।"],
  ur: ["ابھی تصویر کی حالت کی تصدیق نہیں کر سکتا۔", "تصویر نہیں بن سکی۔"],
  fa: ["اکنون نمی‌توانم وضعیت تصویر را تأیید کنم.", "تصویر ساخته نشد."],
  sw: ["Siwezi kuthibitisha hali ya picha sasa.", "Picha haikuweza kutengenezwa."],
  tl: ["Hindi ko makumpirma ang status ng larawan ngayon.", "Hindi nagawa ang larawan."],
  ca: ["Ara no puc confirmar l’estat de la imatge.", "No s’ha pogut generar la imatge."],
  hr: ["Trenutačno ne mogu potvrditi status slike.", "Slika nije mogla biti izrađena."],
  sr: ["Тренутно не могу да потврдим статус слике.", "Слика није могла бити направљена."],
  lt: ["Šiuo metu negaliu patvirtinti vaizdo būsenos.", "Vaizdo sukurti nepavyko."],
  lv: ["Pašlaik nevaru apstiprināt attēla statusu.", "Attēlu neizdevās izveidot."],
  et: ["Ma ei saa praegu pildi olekut kinnitada.", "Pilti ei õnnestunud luua."],
};
export function getChatImageUnverifiedStatusCopy(language = "en", failed = false) {
  const code = normalizeCharacterLanguage(language)?.code || String(language || "en").toLowerCase().split(/[-_]/)[0];
  return (UNVERIFIED_IMAGE_COPY[code] || UNVERIFIED_IMAGE_COPY.en)[failed ? 1 : 0];
}

// Known blocked requests never become an unknown task state. These are bounded
// failure copies, not permission to create an image or a promise of new quota.
const BLOCKED_IMAGE_REQUEST_COPY = {
  en: ['The image allowance is used up, so no new photo was started.', 'You may register or sign in, but another image is not guaranteed.', 'This image request is not supported here, so no new photo was started.'],
  zh: ['图片额度已用完，这次没有开始生成新照片。', '你可以注册或登录，但这不保证能再生成一张。', '这里不支持这类图片请求，这次没有开始生成新照片。'],
  es: ['El cupo de imágenes se ha agotado; no se inició otra foto.', 'Puedes registrarte o iniciar sesión, pero eso no garantiza otra imagen.', 'Esta solicitud de imagen no se admite aquí; no se inició otra foto.'],
  fr: ['Le quota d’images est épuisé ; aucune nouvelle photo n’a été lancée.', 'Tu peux t’inscrire ou te connecter, sans garantie de pouvoir créer une autre image.', 'Cette demande d’image n’est pas prise en charge ici ; aucune nouvelle photo n’a été lancée.'],
  hu: ['A képkeret elfogyott, ezért nem indult új fénykép készítése.', 'Regisztrálhatsz vagy bejelentkezhetsz, de ez nem garantál újabb képet.', 'Ez a képkérés itt nem támogatott, ezért nem indult új fénykép készítése.'],
  tr: ['Görsel hakkı tükendiği için yeni bir fotoğraf başlatılmadı.', 'Kayıt olabilir veya giriş yapabilirsin; bu, başka bir görseli garanti etmez.', 'Bu görsel isteği burada desteklenmediği için yeni bir fotoğraf başlatılmadı.'],
  ar: ['نفد رصيد الصور، لذا لم يبدأ إنشاء صورة جديدة.', 'يمكنك التسجيل أو تسجيل الدخول، لكن ذلك لا يضمن صورة أخرى.', 'طلب الصورة هذا غير مدعوم هنا، لذا لم يبدأ إنشاء صورة جديدة.'],
  de: ['Das Bildkontingent ist aufgebraucht; es wurde kein neues Foto gestartet.', 'Du kannst dich registrieren oder anmelden, aber das garantiert kein weiteres Bild.', 'Diese Bildanfrage wird hier nicht unterstützt; es wurde kein neues Foto gestartet.'],
  pt: ['O limite de imagens foi atingido; nenhuma nova foto foi iniciada.', 'Você pode se cadastrar ou entrar, mas isso não garante outra imagem.', 'Este pedido de imagem não é suportado aqui; nenhuma nova foto foi iniciada.'],
  it: ['La quota di immagini è esaurita; non è stata avviata una nuova foto.', 'Puoi registrarti o accedere, ma questo non garantisce un’altra immagine.', 'Questa richiesta di immagine non è supportata qui; non è stata avviata una nuova foto.'],
  ja: ['画像の利用枠を使い切ったため、新しい写真の生成は開始していません。', '登録やログインはできますが、追加の画像を生成できる保証はありません。', 'この画像リクエストには対応していないため、新しい写真の生成は開始していません。'],
  ko: ['이미지 한도를 모두 사용해 새 사진 생성을 시작하지 않았어요.', '가입하거나 로그인할 수 있지만 추가 이미지가 보장되지는 않아요.', '여기서는 이 이미지 요청을 지원하지 않아 새 사진 생성을 시작하지 않았어요.'],
  hi: ['तस्वीरों की सीमा पूरी हो गई है, इसलिए नई तस्वीर बनाना शुरू नहीं हुआ।', 'आप पंजीकरण या लॉग इन कर सकते हैं, लेकिन इससे अगली तस्वीर की गारंटी नहीं मिलती।', 'यह तस्वीर अनुरोध यहाँ समर्थित नहीं है, इसलिए नई तस्वीर बनाना शुरू नहीं हुआ।'],
  id: ['Kuota gambar sudah habis, jadi foto baru belum mulai dibuat.', 'Kamu bisa mendaftar atau masuk, tetapi itu tidak menjamin gambar tambahan.', 'Permintaan gambar ini tidak didukung di sini, jadi foto baru belum mulai dibuat.'],
  nl: ['Het beeldtegoed is op; er is geen nieuwe foto gestart.', 'Je kunt je registreren of inloggen, maar dat garandeert geen extra afbeelding.', 'Dit afbeeldingsverzoek wordt hier niet ondersteund; er is geen nieuwe foto gestart.'],
  pl: ['Limit obrazów został wykorzystany, więc nie rozpoczęto tworzenia nowego zdjęcia.', 'Możesz się zarejestrować lub zalogować, ale nie gwarantuje to kolejnego obrazu.', 'To żądanie obrazu nie jest tutaj obsługiwane, więc nie rozpoczęto tworzenia nowego zdjęcia.'],
  sv: ['Bildkvoten är slut, så inget nytt foto har påbörjats.', 'Du kan registrera dig eller logga in, men det garanterar inte en till bild.', 'Den här bildförfrågan stöds inte här, så inget nytt foto har påbörjats.'],
  no: ['Bildekvoten er brukt opp, så et nytt bilde er ikke startet.', 'Du kan registrere deg eller logge inn, men det garanterer ikke et nytt bilde.', 'Denne bildeforespørselen støttes ikke her, så et nytt bilde er ikke startet.'],
  da: ['Billedkvoten er brugt op, så et nyt foto er ikke startet.', 'Du kan oprette en konto eller logge ind, men det garanterer ikke et ekstra billede.', 'Denne billedanmodning understøttes ikke her, så et nyt foto er ikke startet.'],
  fi: ['Kuvakiintiö on käytetty, joten uuden kuvan luontia ei aloitettu.', 'Voit rekisteröityä tai kirjautua sisään, mutta se ei takaa uutta kuvaa.', 'Tätä kuvapyyntöä ei tueta täällä, joten uuden kuvan luontia ei aloitettu.'],
  ru: ['Лимит изображений исчерпан, поэтому создание нового фото не началось.', 'Можно зарегистрироваться или войти, но это не гарантирует новое изображение.', 'Такой запрос изображения здесь не поддерживается, поэтому создание нового фото не началось.'],
  uk: ['Ліміт зображень вичерпано, тому створення нового фото не почалося.', 'Можна зареєструватися або увійти, але це не гарантує нового зображення.', 'Такий запит зображення тут не підтримується, тому створення нового фото не почалося.'],
  cs: ['Limit obrázků je vyčerpaný, takže se nová fotka nezačala vytvářet.', 'Můžeš se zaregistrovat nebo přihlásit, ale další obrázek to nezaručuje.', 'Tento požadavek na obrázek zde není podporován, takže se nová fotka nezačala vytvářet.'],
  sk: ['Limit obrázkov je vyčerpaný, takže sa nová fotka nezačala vytvárať.', 'Môžeš sa zaregistrovať alebo prihlásiť, ale ďalší obrázok to nezaručuje.', 'Táto požiadavka na obrázok tu nie je podporovaná, takže sa nová fotka nezačala vytvárať.'],
  ro: ['Cota de imagini este epuizată, așa că nu a început crearea unei fotografii noi.', 'Te poți înregistra sau autentifica, dar asta nu garantează încă o imagine.', 'Această cerere de imagine nu este acceptată aici, așa că nu a început crearea unei fotografii noi.'],
  bg: ['Лимитът за изображения е изчерпан и не е започнато ново изображение.', 'Можеш да се регистрираш или да влезеш, но това не гарантира друго изображение.', 'Тази заявка за изображение не се поддържа тук и не е започнато ново изображение.'],
  el: ['Το όριο εικόνων εξαντλήθηκε, οπότε δεν ξεκίνησε νέα φωτογραφία.', 'Μπορείς να εγγραφείς ή να συνδεθείς, αλλά αυτό δεν εγγυάται άλλη εικόνα.', 'Αυτό το αίτημα εικόνας δεν υποστηρίζεται εδώ, οπότε δεν ξεκίνησε νέα φωτογραφία.'],
  he: ['מכסת התמונות נוצלה, ולכן לא התחילה יצירת תמונה חדשה.', 'אפשר להירשם או להתחבר, אך זה לא מבטיח תמונה נוספת.', 'בקשת התמונה הזאת אינה נתמכת כאן, ולכן לא התחילה יצירת תמונה חדשה.'],
  th: ['โควตารูปภาพหมดแล้ว จึงยังไม่ได้เริ่มสร้างรูปใหม่', 'คุณสมัครหรือลงชื่อเข้าใช้ได้ แต่ไม่ได้รับประกันว่าจะสร้างรูปเพิ่มได้', 'ที่นี่ไม่รองรับคำขอรูปภาพนี้ จึงยังไม่ได้เริ่มสร้างรูปใหม่'],
  vi: ['Hạn mức ảnh đã hết nên chưa bắt đầu tạo ảnh mới.', 'Bạn có thể đăng ký hoặc đăng nhập, nhưng điều đó không đảm bảo có thêm ảnh.', 'Yêu cầu ảnh này không được hỗ trợ ở đây nên chưa bắt đầu tạo ảnh mới.'],
  ms: ['Kuota imej sudah habis, jadi foto baharu belum dimulakan.', 'Anda boleh mendaftar atau log masuk, tetapi itu tidak menjamin imej tambahan.', 'Permintaan imej ini tidak disokong di sini, jadi foto baharu belum dimulakan.'],
  ta: ['பட வரம்பு முடிந்துவிட்டதால் புதிய படம் உருவாக்கத் தொடங்கப்படவில்லை.', 'நீங்கள் பதிவு செய்யலாம் அல்லது உள்நுழையலாம்; ஆனால் இன்னொரு படம் உறுதியில்லை.', 'இந்தப் படக் கோரிக்கை இங்கு ஆதரிக்கப்படாததால் புதிய படம் உருவாக்கத் தொடங்கப்படவில்லை.'],
  bn: ['ছবির সীমা শেষ হয়েছে, তাই নতুন ছবি তৈরি শুরু হয়নি।', 'আপনি নিবন্ধন বা লগ ইন করতে পারেন, তবে তাতে আরেকটি ছবি নিশ্চিত নয়।', 'এখানে এই ছবির অনুরোধ সমর্থিত নয়, তাই নতুন ছবি তৈরি শুরু হয়নি।'],
  ur: ['تصویروں کی حد پوری ہو گئی ہے، اس لیے نئی تصویر بنانا شروع نہیں ہوا۔', 'آپ رجسٹر یا سائن ان کر سکتے ہیں، لیکن اس سے مزید تصویر کی ضمانت نہیں ملتی۔', 'یہ تصویر کی درخواست یہاں معاونت یافتہ نہیں، اس لیے نئی تصویر بنانا شروع نہیں ہوا۔'],
  fa: ['سهمیهٔ تصویر تمام شده، پس ساخت عکس جدیدی شروع نشده است.', 'می‌توانی ثبت‌نام کنی یا وارد شوی، اما این تضمینی برای تصویر دیگری نیست.', 'این درخواست تصویر اینجا پشتیبانی نمی‌شود، پس ساخت عکس جدیدی شروع نشده است.'],
  sw: ['Kiwango cha picha kimekwisha, hivyo picha mpya haijaanza kutengenezwa.', 'Unaweza kujisajili au kuingia, lakini hilo halihakikishi picha nyingine.', 'Ombi hili la picha halitumiki hapa, hivyo picha mpya haijaanza kutengenezwa.'],
  tl: ['Naubos na ang limit sa larawan, kaya walang bagong larawang sinimulan.', 'Maaari kang magparehistro o mag-sign in, pero hindi nito ginagarantiya ang isa pang larawan.', 'Hindi suportado rito ang kahilingang ito, kaya walang bagong larawang sinimulan.'],
  ca: ['S’ha esgotat el límit d’imatges; no s’ha iniciat cap foto nova.', 'Pots registrar-te o iniciar sessió, però això no garanteix una altra imatge.', 'Aquesta petició d’imatge no s’admet aquí; no s’ha iniciat cap foto nova.'],
  hr: ['Kvota slika je potrošena pa nije započeta nova fotografija.', 'Možeš se registrirati ili prijaviti, ali to ne jamči novu sliku.', 'Ovaj zahtjev za sliku ovdje nije podržan pa nije započeta nova fotografija.'],
  sr: ['Квота слика је потрошена па није започета нова фотографија.', 'Можеш да се региструјеш или пријавиш, али то не гарантује нову слику.', 'Овај захтев за слику овде није подржан па није започета нова фотографија.'],
  lt: ['Vaizdų limitas išnaudotas, todėl nauja nuotrauka nepradėta kurti.', 'Gali registruotis ar prisijungti, bet tai negarantuoja dar vieno vaizdo.', 'Ši vaizdo užklausa čia nepalaikoma, todėl nauja nuotrauka nepradėta kurti.'],
  lv: ['Attēlu limits ir izlietots, tāpēc jauna fotoattēla veidošana nav sākta.', 'Vari reģistrēties vai pierakstīties, taču tas negarantē vēl vienu attēlu.', 'Šāds attēla pieprasījums šeit netiek atbalstīts, tāpēc jauna fotoattēla veidošana nav sākta.'],
  et: ['Pildilimiit on kasutatud, seega uut fotot ei alustatud.', 'Võid registreeruda või sisse logida, kuid see ei taga uut pilti.', 'Seda pildipäringut siin ei toetata, seega uut fotot ei alustatud.'],
};
export function getChatImageBlockedRequestCopy(language = 'en', reason = '', guest = false) {
  const code = normalizeCharacterLanguage(language)?.code || String(language || 'en').toLowerCase().split(/[-_]/)[0];
  const copy = BLOCKED_IMAGE_REQUEST_COPY[code] || BLOCKED_IMAGE_REQUEST_COPY.en;
  return reason === 'quota_exhausted' ? [copy[0], guest ? copy[1] : ''].filter(Boolean).join(' ')
    : reason === 'disallowed_request' ? copy[2] : '';
}

// Recovery describes an existing image, never a new delivery this turn.
const HISTORICAL_READY_COPY = {
  "en": "The previous photo is ready. I haven't sent a new photo this turn.",
  "zh": "上一张照片已经准备好了。这一轮没有发送新照片。",
  "es": "La foto anterior está lista. No he enviado una nueva en este turno.",
  "fr": "La photo précédente est prête. Je n’ai pas envoyé de nouvelle photo cette fois-ci.",
  "hu": "Az előző kép elkészült. Ebben a körben nem küldtem új képet.",
  "tr": "Önceki fotoğraf hazır. Bu turda yeni bir fotoğraf göndermedim.",
  "ar": "الصورة السابقة جاهزة. لم أرسل صورة جديدة في هذه الجولة.",
  "de": "Das vorherige Foto ist fertig. In dieser Runde habe ich kein neues Foto gesendet.",
  "pt": "A foto anterior está pronta. Não enviei uma nova nesta rodada.",
  "ru": "Предыдущее фото готово. В этот раз новое фото не отправлено.",
  "uk": "Попереднє фото готове. Цього разу нове фото не надіслано.",
  "ja": "前の写真は準備できています。今回は新しい写真を送っていません。",
  "ko": "이전 사진은 준비되어 있어요. 이번에는 새 사진을 보내지 않았어요.",
  "it": "La foto precedente è pronta. Questa volta non ho inviato una nuova foto.",
  "nl": "De vorige foto is klaar. Ik heb deze keer geen nieuwe foto verstuurd.",
  "pl": "Poprzednie zdjęcie jest gotowe. Tym razem nie wysłano nowego zdjęcia.",
  "sv": "Den förra bilden är klar. Jag har inte skickat någon ny bild den här gången.",
  "no": "Det forrige bildet er klart. Jeg har ikke sendt et nytt bilde denne gangen.",
  "da": "Det forrige billede er klar. Jeg har ikke sendt et nyt billede denne gang.",
  "fi": "Edellinen kuva on valmis. En ole lähettänyt uutta kuvaa tällä kertaa.",
  "cs": "Předchozí fotka je hotová. Tentokrát nebyla odeslána nová fotka.",
  "sk": "Predchádzajúca fotka je hotová. Tentoraz nebola odoslaná nová fotka.",
  "ro": "Fotografia anterioară este gata. De data aceasta nu am trimis o fotografie nouă.",
  "bg": "Предишната снимка е готова. Този път не е изпратена нова снимка.",
  "el": "Η προηγούμενη φωτογραφία είναι έτοιμη. Δεν έστειλα νέα φωτογραφία αυτή τη φορά.",
  "he": "התמונה הקודמת מוכנה. לא שלחתי תמונה חדשה הפעם.",
  "th": "รูปก่อนหน้าพร้อมแล้ว ครั้งนี้ยังไม่ได้ส่งรูปใหม่",
  "vi": "Ảnh trước đã sẵn sàng. Lần này tôi chưa gửi ảnh mới.",
  "id": "Foto sebelumnya sudah siap. Kali ini saya belum mengirim foto baru.",
  "ms": "Foto sebelumnya sudah siap. Kali ini saya belum menghantar foto baharu.",
  "hi": "पिछली तस्वीर तैयार है। इस बार मैंने कोई नई तस्वीर नहीं भेजी है।",
  "bn": "আগের ছবিটি প্রস্তুত। এবার আমি নতুন কোনো ছবি পাঠাইনি।",
  "ta": "முந்தைய படம் தயாராக உள்ளது. இந்த முறை நான் புதிய படம் அனுப்பவில்லை.",
  "ur": "پچھلی تصویر تیار ہے۔ اس بار میں نے کوئی نئی تصویر نہیں بھیجی۔",
  "fa": "عکس قبلی آماده است. این بار عکس جدیدی نفرستاده‌ام.",
  "sw": "Picha ya awali iko tayari. Sijatuma picha mpya wakati huu.",
  "tl": "Handa na ang naunang larawan. Wala akong ipinadalang bagong larawan ngayon.",
  "ca": "La foto anterior està a punt. Aquesta vegada no he enviat cap foto nova.",
  "hr": "Prethodna fotografija je spremna. Ovaj put nije poslana nova fotografija.",
  "sr": "Претходна фотографија је спремна. Овог пута није послата нова фотографија.",
  "lt": "Ankstesnė nuotrauka paruošta. Šį kartą naujos nuotraukos neišsiunčiau.",
  "lv": "Iepriekšējais fotoattēls ir gatavs. Šoreiz jaunu fotoattēlu nenosūtīju.",
  "et": "Eelmine foto on valmis. Seekord ei ole ma uut fotot saatnud."
};
export function getChatImageHistoricalReadyCopy(language = "en") {
  const code = normalizeCharacterLanguage(language)?.code || String(language || "en").toLowerCase().split(/[-_]/)[0];
  return HISTORICAL_READY_COPY[code] || HISTORICAL_READY_COPY.en;
}
