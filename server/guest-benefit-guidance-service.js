import { normalizeCharacterLanguage } from "../shared/language-library.js";

const contexts = new WeakSet();
const reviewedBodies = new WeakMap();
// Capability copy, not a claim that registration grants an entitlement.
const COPY = Object.freeze({
  en: "If you already have an account, sign in; otherwise, you can register. Available benefits depend on the actual information after sign-in.",
  zh: "已有账号请登录；没有账号可以注册。可用权益以登录后的实际信息为准。",
  es: "Si ya tienes una cuenta, inicia sesión; si no, puedes registrarte. Los beneficios disponibles dependen de la información real después de iniciar sesión.",
  fr: "Si vous avez déjà un compte, connectez-vous ; sinon, vous pouvez vous inscrire. Les avantages disponibles dépendent des informations réelles après connexion.",
  de: "Wenn du bereits ein Konto hast, melde dich an; andernfalls kannst du dich registrieren. Verfügbare Vorteile richten sich nach den tatsächlichen Informationen nach der Anmeldung.",
  pt: "Se já tiver uma conta, entre; caso contrário, pode cadastrar-se. Os benefícios disponíveis dependem das informações reais após o login.",
  it: "Se hai già un account, accedi; altrimenti puoi registrarti. I vantaggi disponibili dipendono dalle informazioni effettive dopo l’accesso.",
  ja: "アカウントをお持ちの場合はログインし、お持ちでない場合は登録できます。利用できる特典はログイン後の実際の情報によります。",
  ko: "계정이 있다면 로그인하고, 없다면 가입할 수 있어요. 이용 가능한 혜택은 로그인 후 실제 정보에 따라 달라져요.",
  ar: "إذا كان لديك حساب، فسجّل الدخول؛ وإلا يمكنك التسجيل. تعتمد المزايا المتاحة على المعلومات الفعلية بعد تسجيل الدخول.",
  hi: "अगर आपका खाता है, तो लॉग इन करें; नहीं है, तो पंजीकरण कर सकते हैं। उपलब्ध लाभ लॉग इन के बाद की वास्तविक जानकारी पर निर्भर हैं।",
  id: "Jika sudah punya akun, masuk; jika belum, kamu bisa mendaftar. Manfaat yang tersedia bergantung pada informasi sebenarnya setelah masuk.",
  tr: "Hesabın varsa giriş yap; yoksa kayıt olabilirsin. Kullanılabilir avantajlar, giriş yaptıktan sonraki gerçek bilgilere bağlıdır.",
  nl: "Heb je al een account, log dan in; anders kun je je registreren. Beschikbare voordelen hangen af van de daadwerkelijke informatie na het inloggen.",
  pl: "Jeśli masz już konto, zaloguj się; jeśli nie, możesz się zarejestrować. Dostępne korzyści zależą od rzeczywistych informacji po zalogowaniu.",
  sv: "Har du redan ett konto, logga in; annars kan du registrera dig. Tillgängliga förmåner beror på den faktiska informationen efter inloggning.",
  no: "Har du allerede en konto, logg inn; ellers kan du registrere deg. Tilgjengelige fordeler avhenger av den faktiske informasjonen etter innlogging.",
  da: "Har du allerede en konto, så log ind; ellers kan du registrere dig. Tilgængelige fordele afhænger af de faktiske oplysninger efter login.",
  fi: "Jos sinulla on jo tili, kirjaudu sisään; muuten voit rekisteröityä. Saatavilla olevat edut riippuvat kirjautumisen jälkeisistä todellisista tiedoista.",
  ru: "Если у вас уже есть аккаунт, войдите; иначе можно зарегистрироваться. Доступные преимущества зависят от фактической информации после входа.",
  uk: "Якщо у вас уже є обліковий запис, увійдіть; інакше можна зареєструватися. Доступні переваги залежать від фактичної інформації після входу.",
  cs: "Pokud už máte účet, přihlaste se; jinak se můžete zaregistrovat. Dostupné výhody závisí na skutečných informacích po přihlášení.",
  sk: "Ak už máte účet, prihláste sa; inak sa môžete zaregistrovať. Dostupné výhody závisia od skutočných informácií po prihlásení.",
  hu: "Ha már van fiókod, jelentkezz be; ha nincs, regisztrálhatsz. Az elérhető kedvezmények a bejelentkezés utáni tényleges információktól függenek.",
  ro: "Dacă ai deja un cont, autentifică-te; altfel te poți înregistra. Beneficiile disponibile depind de informațiile reale după autentificare.",
  bg: "Ако вече имате профил, влезте; иначе можете да се регистрирате. Наличните предимства зависят от действителната информация след влизане.",
  el: "Αν έχετε ήδη λογαριασμό, συνδεθείτε· διαφορετικά μπορείτε να εγγραφείτε. Τα διαθέσιμα οφέλη εξαρτώνται από τις πραγματικές πληροφορίες μετά τη σύνδεση.",
  he: "אם כבר יש לך חשבון, יש להתחבר; אחרת אפשר להירשם. ההטבות הזמינות תלויות במידע בפועל לאחר ההתחברות.",
  th: "หากมีบัญชีแล้ว ให้เข้าสู่ระบบ หากยังไม่มี สามารถสมัครได้ สิทธิประโยชน์ที่ใช้ได้ขึ้นอยู่กับข้อมูลจริงหลังเข้าสู่ระบบ",
  vi: "Nếu đã có tài khoản, hãy đăng nhập; nếu chưa, bạn có thể đăng ký. Quyền lợi có thể sử dụng phụ thuộc vào thông tin thực tế sau khi đăng nhập.",
  ms: "Jika sudah mempunyai akaun, log masuk; jika belum, anda boleh mendaftar. Manfaat yang tersedia bergantung pada maklumat sebenar selepas log masuk.",
  ta: "ஏற்கனவே கணக்கு இருந்தால் உள்நுழையுங்கள்; இல்லையெனில் பதிவு செய்யலாம். கிடைக்கும் சலுகைகள் உள்நுழைந்த பிறகு உள்ள உண்மையான தகவல்களைப் பொறுத்தவை.",
  bn: "আগে থেকেই অ্যাকাউন্ট থাকলে লগ ইন করুন; না থাকলে নিবন্ধন করতে পারেন। উপলব্ধ সুবিধা লগ ইন করার পরের প্রকৃত তথ্যের ওপর নির্ভর করে।",
  ur: "اگر آپ کا اکاؤنٹ پہلے سے ہے تو لاگ اِن کریں؛ ورنہ رجسٹر کر سکتے ہیں۔ دستیاب فوائد لاگ اِن کے بعد کی اصل معلومات پر منحصر ہیں۔",
  fa: "اگر حساب دارید، وارد شوید؛ در غیر این صورت می‌توانید ثبت‌نام کنید. مزایای موجود به اطلاعات واقعی پس از ورود بستگی دارند.",
  sw: "Ikiwa tayari una akaunti, ingia; kama huna, unaweza kujisajili. Manufaa yanayopatikana hutegemea taarifa halisi baada ya kuingia.",
  tl: "Kung may account ka na, mag-sign in; kung wala, maaari kang magparehistro. Ang mga benepisyong magagamit ay nakadepende sa aktuwal na impormasyon pagkatapos mag-sign in.",
  ca: "Si ja tens un compte, inicia sessió; si no, pots registrar-te. Els avantatges disponibles depenen de la informació real després d’iniciar sessió.",
  hr: "Ako već imate račun, prijavite se; inače se možete registrirati. Dostupne pogodnosti ovise o stvarnim informacijama nakon prijave.",
  sr: "Ако већ имате налог, пријавите се; иначе можете да се региструјете. Доступне погодности зависе од стварних информација након пријаве.",
  lt: "Jei jau turite paskyrą, prisijunkite; jei ne, galite užsiregistruoti. Galimos privilegijos priklauso nuo faktinės informacijos prisijungus.",
  lv: "Ja jums jau ir konts, piesakieties; ja nav, varat reģistrēties. Pieejamās priekšrocības ir atkarīgas no faktiskās informācijas pēc pieteikšanās.",
  et: "Kui sul on juba konto, logi sisse; kui ei ole, saad registreeruda. Saadaolevad hüved sõltuvad tegelikust teabest pärast sisselogimist.",
});

export function buildGuestBenefitContext({ searchIntent = {}, userText = "", languageCode = "en", isGuest = false } = {}) {
  const confidence = Number(searchIntent.commerceConfidence);
  const evidence = typeof searchIntent.promotionInquiry?.evidence === "string" ? searchIntent.promotionInquiry.evidence.trim() : "";
  if (isGuest !== true || searchIntent.promotionInquiry?.kind !== "benefit_request"
    || !Number.isFinite(confidence) || confidence < .75 || confidence > 1
    || !evidence || evidence.length > 500 || !String(userText).includes(evidence)) return null;
  const code = normalizeCharacterLanguage(languageCode)?.code
    || normalizeCharacterLanguage(String(languageCode).split(/[-_]/)[0])?.code || "en";
  const context = Object.freeze({ isGuest: true, issuanceAllowed: false, evidence, languageCode: code });
  contexts.add(context);
  return context;
}

export function getGuestBenefitReviewContext(context) {
  return contexts.has(context) ? { isGuest: true, issuanceAllowed: false, evidence: context.evidence } : null;
}

export function approveGuestBenefitContext(context, { text = "", allowed = false, confidence = 0, guidanceSupported = false,
  evidenceRequired = false, evidenceSupported = false, imageStatusRequired = false, imageStatusSupported = false, transportFallback = false } = {}) {
  if (!contexts.has(context)) return false;
  // Each assessment replaces any previous proof; a failed reassessment cannot
  // keep an older approval alive.
  reviewedBodies.delete(context);
  const score = Number(confidence);
  const body = String(text).trim();
  if (!body || transportFallback || allowed !== true || guidanceSupported !== true || !Number.isFinite(score) || score < .8 || score > 1
    || (evidenceRequired && evidenceSupported !== true) || (imageStatusRequired && imageStatusSupported !== true)) return false;
  reviewedBodies.set(context, body);
  return true;
}

export function isGuestBenefitReplyReviewed(context, text) {
  return contexts.has(context) && reviewedBodies.has(context) && reviewedBodies.get(context) === String(text || "").trim();
}

export function buildGuestBenefitFallback(context) {
  return contexts.has(context) ? COPY[context.languageCode] || "" : "";
}

export function isControlledGuestBenefitCopy(context, text) {
  const copy = buildGuestBenefitFallback(context);
  return Boolean(copy) && String(text || "").trim() === copy;
}

export function appendGuestBenefitGuide(text, context) {
  const body = String(text || "").trim();
  const copy = buildGuestBenefitFallback(context);
  if (!copy) return body;
  if (isControlledGuestBenefitCopy(context, body)) return copy;
  if (!isGuestBenefitReplyReviewed(context, body)) return copy;
  return body.includes(copy) ? body : `${body}\n\n${copy}`;
}
