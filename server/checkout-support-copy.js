import { normalizeCharacterLanguage } from "../shared/language-library.js";

// No navigation, contact invitation or claim of a repair. The server can append
// its independently authorized feedback action when more investigation is needed.
const COPY = Object.freeze({
  en: ["At which step does checkout stop?", "What error appears, or what happens when you try to continue? Please omit personal details.", "I can’t confirm the cause here."],
  zh: ["结账卡在哪一步？", "点击继续时出现什么错误提示，或发生了什么？请不要提供个人信息。", "这里还无法确认原因。"],
  es: ["¿En qué paso se detiene el proceso de compra?", "¿Qué error aparece o qué ocurre al intentar continuar? Omite los datos personales.", "No puedo confirmar la causa aquí."],
  fr: ["À quelle étape la commande se bloque-t-elle ?", "Quel message d’erreur apparaît, ou que se passe-t-il quand vous essayez de continuer ? Ne partagez pas de données personnelles.", "Je ne peux pas confirmer la cause ici."],
  de: ["Bei welchem Schritt bleibt der Bestellvorgang hängen?", "Welche Fehlermeldung erscheint oder was passiert beim Fortfahren? Bitte ohne persönliche Daten.", "Ich kann die Ursache hier nicht bestätigen."],
  pt: ["Em que etapa a finalização da compra para?", "Que erro aparece ou o que acontece ao tentar continuar? Não inclua dados pessoais.", "Não consigo confirmar a causa aqui."],
  it: ["In quale passaggio si blocca il completamento dell’ordine?", "Quale errore appare o cosa succede quando provi a continuare? Non includere dati personali.", "Non posso confermare la causa qui."],
  hu: ["A rendelés melyik lépésénél akadsz el?", "Milyen hiba jelenik meg, vagy mi történik, amikor megpróbálsz továbblépni? Személyes adatokat ne adj meg.", "Itt nem tudom megerősíteni az okot."],
  tr: ["Siparişi tamamlarken hangi adımda takılıyorsun?", "Devam etmeye çalışınca hangi hata çıkıyor veya ne oluyor? Kişisel bilgilerini paylaşma.", "Buradan nedeni doğrulayamıyorum."],
  ar: ["في أي خطوة تتوقف عملية إتمام الطلب؟", "ما رسالة الخطأ التي تظهر، أو ماذا يحدث عند محاولة المتابعة؟ لا تشارك بيانات شخصية.", "لا أستطيع تأكيد السبب هنا."],
  ja: ["注文手続きのどの段階で止まりますか？", "続けようとすると、どんなエラーが出るか、何が起こりますか？個人情報は含めないでください。", "ここでは原因を確認できません。"],
  ko: ["주문 과정의 어느 단계에서 멈추나요?", "계속 진행하려고 하면 어떤 오류가 나오거나 무슨 일이 생기나요? 개인정보는 제외해 주세요.", "여기서는 원인을 확인할 수 없어요."],
  hi: ["ऑर्डर पूरा करने की प्रक्रिया किस चरण पर रुकती है?", "आगे बढ़ने पर कौन-सी त्रुटि दिखती है या क्या होता है? निजी जानकारी न दें।", "मैं यहाँ कारण की पुष्टि नहीं कर सकता।"],
  id: ["Pada tahap mana proses pemesanan berhenti?", "Pesan kesalahan apa yang muncul, atau apa yang terjadi saat mencoba melanjutkan? Jangan sertakan data pribadi.", "Saya belum bisa memastikan penyebabnya di sini."],
  nl: ["Bij welke stap loopt het afrekenen vast?", "Welke fout verschijnt, of wat gebeurt er als je probeert verder te gaan? Deel geen persoonsgegevens.", "Ik kan de oorzaak hier niet bevestigen."],
  pl: ["Na którym etapie składanie zamówienia się zatrzymuje?", "Jaki błąd się pojawia lub co się dzieje przy próbie kontynuowania? Nie podawaj danych osobowych.", "Nie mogę tutaj potwierdzić przyczyny."],
  sv: ["I vilket steg stannar beställningen?", "Vilket fel visas, eller vad händer när du försöker fortsätta? Utelämna personuppgifter.", "Jag kan inte bekräfta orsaken här."],
  no: ["På hvilket trinn stopper bestillingen?", "Hvilken feil vises, eller hva skjer når du prøver å fortsette? Utelat personopplysninger.", "Jeg kan ikke bekrefte årsaken her."],
  da: ["På hvilket trin stopper bestillingen?", "Hvilken fejl vises, eller hvad sker der, når du prøver at fortsætte? Undlad personoplysninger.", "Jeg kan ikke bekræfte årsagen her."],
  fi: ["Missä vaiheessa tilauksen tekeminen pysähtyy?", "Mikä virhe näkyy tai mitä tapahtuu, kun yrität jatkaa? Älä jaa henkilötietoja.", "En voi vahvistaa syytä täällä."],
  ru: ["На каком шаге останавливается оформление заказа?", "Какая ошибка появляется или что происходит при попытке продолжить? Не указывайте личные данные.", "Здесь я не могу подтвердить причину."],
  uk: ["На якому кроці зупиняється оформлення замовлення?", "Яка помилка з’являється або що відбувається при спробі продовжити? Не вказуйте особисті дані.", "Тут я не можу підтвердити причину."],
  cs: ["V jakém kroku se dokončení objednávky zastaví?", "Jaká chyba se zobrazí nebo co se stane při pokusu pokračovat? Neuvádějte osobní údaje.", "Příčinu zde nemohu potvrdit."],
  sk: ["V ktorom kroku sa dokončenie objednávky zastaví?", "Aká chyba sa zobrazí alebo čo sa stane pri pokuse pokračovať? Neuvádzajte osobné údaje.", "Príčinu tu nemôžem potvrdiť."],
  ro: ["La ce pas se oprește finalizarea comenzii?", "Ce eroare apare sau ce se întâmplă când încerci să continui? Nu include date personale.", "Nu pot confirma cauza aici."],
  bg: ["На коя стъпка спира завършването на поръчката?", "Каква грешка се появява или какво става при опит да продължите? Не включвайте лични данни.", "Тук не мога да потвърдя причината."],
  el: ["Σε ποιο βήμα σταματά η ολοκλήρωση της παραγγελίας;", "Ποιο σφάλμα εμφανίζεται ή τι συμβαίνει όταν προσπαθείς να συνεχίσεις; Μην αναφέρεις προσωπικά στοιχεία.", "Δεν μπορώ να επιβεβαιώσω την αιτία εδώ."],
  he: ["באיזה שלב נעצר תהליך ההזמנה?", "איזו שגיאה מופיעה, או מה קורה בניסיון להמשיך? אין לצרף פרטים אישיים.", "אין לי אפשרות לאשר כאן את הסיבה."],
  th: ["ขั้นตอนการสั่งซื้อหยุดอยู่ตรงไหน?", "มีข้อความผิดพลาดอะไร หรือเกิดอะไรขึ้นเมื่อพยายามดำเนินการต่อ? กรุณาไม่ใส่ข้อมูลส่วนตัว", "ฉันยังยืนยันสาเหตุไม่ได้"],
  vi: ["Quá trình đặt hàng dừng ở bước nào?", "Lỗi nào xuất hiện hoặc điều gì xảy ra khi bạn thử tiếp tục? Vui lòng không gửi thông tin cá nhân.", "Tôi chưa thể xác nhận nguyên nhân ở đây."],
  ms: ["Pada langkah manakah proses pesanan terhenti?", "Ralat apa yang muncul atau apa yang berlaku apabila cuba meneruskan? Jangan sertakan maklumat peribadi.", "Saya belum dapat mengesahkan puncanya di sini."],
  ta: ["ஆர்டரை முடிக்கும் செயல்முறை எந்தப் படியில் நிற்கிறது?", "தொடர முயலும்போது என்ன பிழை காட்டுகிறது அல்லது என்ன நடக்கிறது? தனிப்பட்ட தகவல்களைத் தர வேண்டாம்.", "இங்கே காரணத்தை என்னால் உறுதிப்படுத்த முடியவில்லை."],
  bn: ["অর্ডার সম্পন্ন করার প্রক্রিয়া কোন ধাপে থেমে যায়?", "এগোনোর চেষ্টা করলে কী ত্রুটি দেখায় বা কী ঘটে? ব্যক্তিগত তথ্য দেবেন না।", "এখানে আমি কারণ নিশ্চিত করতে পারছি না।"],
  ur: ["آرڈر مکمل کرنے کا عمل کس مرحلے پر رک جاتا ہے؟", "آگے بڑھنے پر کون سی خرابی دکھائی دیتی ہے یا کیا ہوتا ہے؟ ذاتی معلومات شامل نہ کریں۔", "میں یہاں وجہ کی تصدیق نہیں کر سکتا۔"],
  fa: ["فرایند تکمیل سفارش در کدام مرحله متوقف می‌شود؟", "هنگام تلاش برای ادامه چه خطایی نمایش داده می‌شود یا چه اتفاقی می‌افتد؟ اطلاعات شخصی را نفرستید.", "اینجا نمی‌توانم علت را تأیید کنم."],
  sw: ["Mchakato wa kukamilisha agizo unasimama katika hatua gani?", "Ni hitilafu gani inaonekana, au nini hutokea unapojaribu kuendelea? Usitume taarifa binafsi.", "Siwezi kuthibitisha sababu hapa."],
  tl: ["Saang hakbang humihinto ang pag-checkout?", "Anong error ang lumalabas, o ano ang nangyayari kapag sinusubukang magpatuloy? Huwag isama ang personal na impormasyon.", "Hindi ko makumpirma ang sanhi rito."],
  ca: ["En quin pas s’atura la finalització de la compra?", "Quin error apareix o què passa quan intentes continuar? No incloguis dades personals.", "No puc confirmar la causa aquí."],
  hr: ["Na kojem koraku zastaje dovršetak narudžbe?", "Koja se pogreška pojavljuje ili što se događa pri pokušaju nastavka? Nemojte navoditi osobne podatke.", "Ovdje ne mogu potvrditi uzrok."],
  sr: ["На ком кораку се зауставља завршетак поруџбине?", "Која се грешка појављује или шта се дешава при покушају наставка? Немојте наводити личне податке.", "Овде не могу да потврдим узрок."],
  lt: ["Kuriame žingsnyje sustoja užsakymo užbaigimas?", "Kokia klaida rodoma arba kas nutinka bandant tęsti? Nesiųskite asmens duomenų.", "Čia negaliu patvirtinti priežasties."],
  lv: ["Kurā solī apstājas pasūtījuma pabeigšana?", "Kāda kļūda parādās vai kas notiek, mēģinot turpināt? Neiekļaujiet personas datus.", "Šeit nevaru apstiprināt iemeslu."],
  et: ["Millises etapis tellimuse vormistamine peatub?", "Milline veateade ilmub või mis juhtub, kui proovid jätkata? Ära jaga isikuandmeid.", "Ma ei saa siin põhjust kinnitada."],
});

export function buildCheckoutNextStepCopy(issue = {}, language = "en") {
  const code = normalizeCharacterLanguage(language)?.code || normalizeCharacterLanguage(String(language).split(/[-_]/)[0])?.code || "en";
  const step = issue.stage === "unknown" || !issue.stage ? 0 : issue.errorEvidence ? 2 : 1;
  return (COPY[code] || COPY.en)[step];
}
