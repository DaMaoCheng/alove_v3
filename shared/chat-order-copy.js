import { normalizeCharacterLanguage } from "./language-library.js";

const COPY = {
  en: ["Sign in and link your store account to view your orders.", "Link your store account to view your orders.", "View my orders"],
  es: ["Inicia sesión y vincula tu cuenta de la tienda para consultar tus pedidos.", "Vincula tu cuenta de la tienda para consultar tus pedidos.", "Ver mis pedidos"],
  zh: ["请先登录并绑定店铺账号，即可查看你的订单。", "请绑定店铺账号，即可查看你的订单。", "查看我的订单"],
  fr: ["Connectez-vous et liez votre compte boutique pour consulter vos commandes.", "Liez votre compte boutique pour consulter vos commandes.", "Voir mes commandes"],
  hu: ["Jelentkezz be, és kapcsold össze áruházi fiókodat a rendeléseid megtekintéséhez.", "Kapcsold össze áruházi fiókodat a rendeléseid megtekintéséhez.", "Rendeléseim"],
  tr: ["Siparişlerinizi görmek için giriş yapın ve mağaza hesabınızı bağlayın.", "Siparişlerinizi görmek için mağaza hesabınızı bağlayın.", "Siparişlerimi görüntüle"],
  ar: ["سجّل الدخول واربط حساب المتجر لعرض طلباتك.", "اربط حساب المتجر لعرض طلباتك.", "عرض طلباتي"],
};

export function getChatOrderCopy(language = "English", guest = false) {
  const code = String(normalizeCharacterLanguage(language)?.code || language).toLowerCase().split("-")[0];
  const values = COPY[code] || COPY.en;
  return { text: values[guest ? 0 : 1], label: values[2] };
}

// Only used when the server already supplies a real order entry. A member's
// authentication does not prove whether their store account is linked.
const ENTRY_COPY = Object.freeze({
  en: ["Please sign in first.", "Use the order entry to view your orders. Link your store account only if prompted."],
  zh: ["请先登录。", "可通过订单入口查看你的订单；如提示绑定，再绑定店铺账号。"],
  es: ["Primero inicia sesión.", "Usa el acceso a pedidos para consultar tus pedidos. Vincula tu cuenta de la tienda solo si se te solicita."],
  fr: ["Connectez-vous d’abord.", "Utilisez l’accès aux commandes pour consulter vos commandes. Liez votre compte boutique uniquement si cela vous est demandé."],
  de: ["Bitte melde dich zuerst an.", "Über den Bestellzugang kannst du deine Bestellungen ansehen. Verknüpfe dein Shop-Konto nur, wenn du dazu aufgefordert wirst."],
  pt: ["Primeiro, entre na sua conta.", "Use o acesso aos pedidos para consultar seus pedidos. Vincule sua conta da loja somente se for solicitado."],
  it: ["Prima accedi al tuo account.", "Usa l’accesso agli ordini per consultare i tuoi ordini. Collega il tuo account del negozio solo se richiesto."],
  ja: ["まずログインしてください。", "注文への入口からご自身の注文を確認できます。案内が表示された場合にのみ、ショップのアカウントを連携してください。"],
  ko: ["먼저 로그인해 주세요.", "주문 조회 기능으로 내 주문을 확인할 수 있어요. 안내가 표시되는 경우에만 쇼핑몰 계정을 연결해 주세요."],
  ar: ["يرجى تسجيل الدخول أولاً.", "استخدم مدخل الطلبات للاطلاع على طلباتك. اربط حساب المتجر فقط إذا طُلب منك ذلك."],
  hi: ["पहले साइन इन करें।", "अपने ऑर्डर देखने के लिए ऑर्डर वाले विकल्प का उपयोग करें। स्टोर खाते को तभी जोड़ें जब ऐसा करने का संकेत मिले।"],
  id: ["Silakan masuk terlebih dahulu.", "Gunakan akses pesanan untuk melihat pesananmu. Hubungkan akun toko hanya jika diminta."],
  tr: ["Önce giriş yapın.", "Siparişlerinizi görmek için sipariş erişimini kullanın. Mağaza hesabınızı yalnızca istenirse bağlayın."],
  nl: ["Log eerst in.", "Gebruik de toegang tot bestellingen om je bestellingen te bekijken. Koppel je winkelaccount alleen als daarom wordt gevraagd."],
  pl: ["Najpierw się zaloguj.", "Skorzystaj z dostępu do zamówień, aby zobaczyć swoje zamówienia. Połącz konto sklepu tylko wtedy, gdy pojawi się taka prośba."],
  sv: ["Logga in först.", "Använd åtkomsten till beställningar för att se dina beställningar. Länka ditt butikskonto endast om du blir ombedd."],
  no: ["Logg inn først.", "Bruk tilgangen til bestillinger for å se bestillingene dine. Koble til butikkontoen bare hvis du blir bedt om det."],
  da: ["Log ind først.", "Brug adgangen til bestillinger for at se dine bestillinger. Tilknyt kun din butikskonto, hvis du bliver bedt om det."],
  fi: ["Kirjaudu ensin sisään.", "Katso tilauksesi tilaustoiminnon kautta. Yhdistä kauppatilisi vain, jos sitä pyydetään."],
  ru: ["Сначала войдите в аккаунт.", "Используйте вход в раздел заказов, чтобы посмотреть свои заказы. Привяжите аккаунт магазина, только если появится такой запрос."],
  uk: ["Спочатку увійдіть до облікового запису.", "Скористайтеся доступом до замовлень, щоб переглянути свої замовлення. Прив’яжіть обліковий запис магазину, лише якщо з’явиться такий запит."],
  cs: ["Nejprve se přihlaste.", "K zobrazení svých objednávek použijte přístup k objednávkám. Účet obchodu propojte pouze na vyžádání."],
  sk: ["Najprv sa prihláste.", "Na zobrazenie svojich objednávok použite prístup k objednávkam. Účet obchodu prepojte iba na vyžiadanie."],
  hu: ["Először jelentkezz be.", "A rendeléseket az erre szolgáló lehetőséggel nézheted meg. Az áruházi fiókodat csak akkor kapcsold össze, ha ezt kéri a rendszer."],
  ro: ["Mai întâi autentifică-te.", "Folosește accesul la comenzi pentru a-ți vedea comenzile. Conectează contul magazinului numai dacă ți se solicită."],
  bg: ["Първо влезте в профила си.", "Използвайте достъпа до поръчки, за да видите поръчките си. Свържете профила си в магазина само ако бъдете подканени."],
  el: ["Συνδεθείτε πρώτα.", "Χρησιμοποιήστε την πρόσβαση στις παραγγελίες για να δείτε τις παραγγελίες σας. Συνδέστε τον λογαριασμό του καταστήματος μόνο αν σας ζητηθεί."],
  he: ["יש להתחבר תחילה.", "אפשר לצפות בהזמנות דרך הגישה להזמנות. יש לקשר את חשבון החנות רק אם מופיעה בקשה לכך."],
  th: ["กรุณาเข้าสู่ระบบก่อน", "ใช้ช่องทางดูคำสั่งซื้อเพื่อตรวจสอบคำสั่งซื้อของคุณ เชื่อมโยงบัญชีร้านค้าเฉพาะเมื่อระบบแจ้งให้ทำเท่านั้น"],
  vi: ["Vui lòng đăng nhập trước.", "Dùng lối truy cập đơn hàng để xem đơn hàng của bạn. Chỉ liên kết tài khoản cửa hàng khi được yêu cầu."],
  ms: ["Sila log masuk dahulu.", "Gunakan akses pesanan untuk melihat pesanan anda. Pautkan akaun kedai hanya jika diminta."],
  ta: ["முதலில் உள்நுழையவும்.", "உங்கள் ஆர்டர்களைக் காண ஆர்டர்களுக்கான அணுகலைப் பயன்படுத்தவும். கேட்கப்பட்டால் மட்டும் கடைக் கணக்கை இணைக்கவும்."],
  bn: ["প্রথমে সাইন ইন করুন।", "আপনার অর্ডার দেখতে অর্ডারের প্রবেশপথ ব্যবহার করুন। নির্দেশ দেওয়া হলেই কেবল দোকানের অ্যাকাউন্ট যুক্ত করুন।"],
  ur: ["پہلے سائن ان کریں۔", "اپنے آرڈر دیکھنے کے لیے آرڈرز کے راستے کا استعمال کریں۔ اسٹور اکاؤنٹ صرف اسی صورت میں جوڑیں جب ایسا کرنے کو کہا جائے۔"],
  fa: ["ابتدا وارد حساب شوید.", "برای دیدن سفارش‌هایتان از مسیر سفارش‌ها استفاده کنید. حساب فروشگاه را فقط در صورت درخواست متصل کنید."],
  sw: ["Tafadhali ingia kwanza.", "Tumia sehemu ya kufikia maagizo kuona maagizo yako. Unganisha akaunti yako ya duka tu ukiombwa kufanya hivyo."],
  tl: ["Mag-sign in muna.", "Gamitin ang access sa mga order para makita ang iyong mga order. I-link lamang ang account sa tindahan kung hihilingin."],
  ca: ["Primer inicia la sessió.", "Fes servir l’accés a les comandes per consultar les teves comandes. Vincula el compte de la botiga només si se’t demana."],
  hr: ["Najprije se prijavite.", "Za pregled svojih narudžbi upotrijebite pristup narudžbama. Povežite račun trgovine samo ako se to zatraži."],
  sr: ["Најпре се пријавите.", "За преглед својих поруџбина користите приступ поруџбинама. Повежите налог продавнице само ако се то затражи."],
  lt: ["Pirmiausia prisijunkite.", "Per užsakymų prieigą galite peržiūrėti savo užsakymus. Parduotuvės paskyrą susiekite tik tada, kai to paprašoma."],
  lv: ["Vispirms pierakstieties.", "Izmantojiet piekļuvi pasūtījumiem, lai apskatītu savus pasūtījumus. Saistiet veikala kontu tikai tad, ja tas tiek prasīts."],
  et: ["Logi esmalt sisse.", "Kasuta tellimuste vaatamise võimalust oma tellimuste nägemiseks. Seo poekonto ainult siis, kui seda palutakse."],
});

export function getChatOrderEntryCopy(language = "English", state = "") {
  if (!["login_required", "binding_required"].includes(state)) return "";
  const code = normalizeCharacterLanguage(language)?.code
    || normalizeCharacterLanguage(String(language).split(/[-_]/)[0])?.code || "en";
  const values = ENTRY_COPY[code] || ENTRY_COPY.en;
  return state === "login_required" ? values.join(" ") : values[1];
}
