import { normalizeCharacterLanguage } from "../shared/language-library.js";

// Generic access copy, not catalogue facts or language-specific intent rules.
// Fields: pending question, exhausted, unverified request, current-item label,
// unverified result attribution. Options come only from validated user evidence.
const COPY = Object.freeze({
  en: ["We can check the items one at a time. Which should we start with?", "Please provide the details of one specific product so it can be checked separately.", "I have not understood your question clearly yet. Please clarify what you would like to know.", "Current item", "I cannot confirm that this result corresponds to the selected item."],
  zh: ["可以逐件查看。你想先从哪一项开始？", "请明确提供某一件商品的信息，以便单独核实。", "我还没完全理解你的问题，请补充说明你想了解什么。", "当前查看的商品", "我还无法确认这个结果对应你选定的那件商品。"],
  es: ["Podemos revisar los artículos uno por uno. ¿Por cuál empezamos?", "Indica los detalles de un producto concreto para revisarlo por separado.", "Aún no he entendido bien tu pregunta. Aclara qué te gustaría saber.", "Artículo que estamos revisando", "No puedo confirmar que este resultado corresponda al artículo seleccionado."],
  fr: ["Nous pouvons examiner les articles un par un. Par lequel commençons-nous ?", "Précisez les détails d’un seul produit pour l’examiner séparément.", "Je n’ai pas encore bien compris votre question. Précisez ce que vous souhaitez savoir.", "Article examiné", "Je ne peux pas confirmer que ce résultat corresponde à l’article sélectionné."],
  de: ["Wir können die Artikel einzeln prüfen. Mit welchem sollen wir anfangen?", "Bitte nenne die Angaben zu einem bestimmten Produkt, damit es einzeln geprüft werden kann.", "Ich habe deine Frage noch nicht ganz verstanden. Bitte erläutere, was du wissen möchtest.", "Aktueller Artikel", "Ich kann nicht bestätigen, dass dieses Ergebnis zum ausgewählten Artikel gehört."],
  pt: ["Podemos verificar os artigos um de cada vez. Por qual começamos?", "Indique os detalhes de um produto específico para verificá-lo separadamente.", "Ainda não entendi bem a sua pergunta. Esclareça o que gostaria de saber.", "Artigo em análise", "Não consigo confirmar que este resultado corresponde ao artigo selecionado."],
  it: ["Possiamo controllare gli articoli uno alla volta. Da quale iniziamo?", "Indica i dettagli di un prodotto specifico per controllarlo separatamente.", "Non ho ancora capito bene la tua domanda. Chiarisci cosa vorresti sapere.", "Articolo in esame", "Non posso confermare che questo risultato corrisponda all’articolo selezionato."],
  ja: ["商品を一つずつ確認できます。どれから始めますか？", "個別に確認できるよう、一つの商品について具体的な情報を伝えてください。", "ご質問をまだ十分に理解できていません。知りたいことをもう少し詳しく教えてください。", "今回確認する商品", "この結果が選択した商品に対応するか、まだ確認できません。"],
  ko: ["상품을 하나씩 확인할 수 있어요. 어떤 상품부터 볼까요?", "따로 확인할 수 있도록 특정 상품 하나의 정보를 알려 주세요.", "아직 질문을 충분히 이해하지 못했어요. 무엇이 궁금한지 조금 더 설명해 주세요.", "현재 확인하는 상품", "이 결과가 선택한 상품에 해당하는지 아직 확인할 수 없어요."],
  ar: ["يمكننا مراجعة المنتجات واحدًا تلو الآخر. بأي منتج نبدأ؟", "يرجى تقديم تفاصيل منتج واحد محدد لمراجعته على حدة.", "لم أفهم سؤالك بوضوح بعد. يرجى توضيح ما تود معرفته.", "المنتج الجاري مراجعته", "لا أستطيع تأكيد أن هذه النتيجة تخص المنتج الذي اخترته."],
  hi: ["हम उत्पादों को एक-एक करके देख सकते हैं। किससे शुरू करें?", "अलग से जाँच करने के लिए किसी एक खास उत्पाद की जानकारी दें।", "मैं अभी आपका सवाल पूरी तरह नहीं समझ पाया हूँ। कृपया स्पष्ट करें कि आप क्या जानना चाहते हैं।", "अभी देखा जा रहा उत्पाद", "मैं पुष्टि नहीं कर सकता कि यह परिणाम चुने हुए उत्पाद से संबंधित है।"],
  id: ["Kita bisa memeriksa produk satu per satu. Mau mulai dari yang mana?", "Berikan rincian satu produk tertentu agar dapat diperiksa secara terpisah.", "Aku belum memahami pertanyaanmu dengan jelas. Jelaskan apa yang ingin kamu ketahui.", "Produk yang sedang diperiksa", "Aku belum bisa memastikan bahwa hasil ini sesuai dengan produk yang dipilih."],
  tr: ["Ürünleri tek tek inceleyebiliriz. Hangisinden başlayalım?", "Ayrı olarak inceleyebilmek için belirli bir ürünün bilgilerini paylaş.", "Sorunu henüz tam anlayamadım. Lütfen ne öğrenmek istediğini açıkla.", "İncelenen ürün", "Bu sonucun seçilen ürüne ait olduğunu doğrulayamıyorum."],
  nl: ["We kunnen de artikelen één voor één bekijken. Met welk artikel beginnen we?", "Geef de details van één specifiek product, zodat het apart kan worden bekeken.", "Ik heb je vraag nog niet helemaal begrepen. Leg uit wat je wilt weten.", "Artikel dat we bekijken", "Ik kan niet bevestigen dat dit resultaat bij het gekozen artikel hoort."],
  pl: ["Możemy sprawdzić produkty pojedynczo. Od którego zaczynamy?", "Podaj szczegóły jednego konkretnego produktu, aby sprawdzić go osobno.", "Nie rozumiem jeszcze dokładnie Twojego pytania. Wyjaśnij, czego chcesz się dowiedzieć.", "Sprawdzany produkt", "Nie mogę potwierdzić, że ten wynik dotyczy wybranego produktu."],
  sv: ["Vi kan kontrollera varorna en i taget. Vilken ska vi börja med?", "Ange uppgifterna för en viss produkt så att den kan kontrolleras separat.", "Jag har inte förstått din fråga helt än. Förtydliga vad du vill veta.", "Varan vi kontrollerar", "Jag kan inte bekräfta att detta resultat gäller den valda varan."],
  no: ["Vi kan sjekke varene én om gangen. Hvilken skal vi begynne med?", "Oppgi detaljene for ett bestemt produkt, slik at det kan sjekkes separat.", "Jeg har ikke forstått spørsmålet ditt helt ennå. Forklar hva du ønsker å vite.", "Varen vi sjekker", "Jeg kan ikke bekrefte at dette resultatet gjelder den valgte varen."],
  da: ["Vi kan undersøge varerne én ad gangen. Hvilken skal vi begynde med?", "Angiv oplysningerne om ét bestemt produkt, så det kan undersøges separat.", "Jeg har endnu ikke forstået dit spørgsmål helt. Uddyb, hvad du gerne vil vide.", "Varen vi undersøger", "Jeg kan ikke bekræfte, at dette resultat gælder den valgte vare."],
  fi: ["Voimme tarkistaa tuotteet yksi kerrallaan. Mistä aloitamme?", "Anna yhden tietyn tuotteen tiedot, jotta se voidaan tarkistaa erikseen.", "En ole vielä täysin ymmärtänyt kysymystäsi. Kerro tarkemmin, mitä haluaisit tietää.", "Tarkistettava tuote", "En voi vahvistaa, että tämä tulos koskee valittua tuotetta."],
  ru: ["Можно проверить товары по одному. С какого начнём?", "Укажите данные одного конкретного товара, чтобы проверить его отдельно.", "Я ещё не до конца понял ваш вопрос. Уточните, что вы хотите узнать.", "Проверяемый товар", "Не могу подтвердить, что этот результат относится к выбранному товару."],
  uk: ["Можемо перевірити товари по одному. З якого почнемо?", "Надайте дані одного конкретного товару, щоб перевірити його окремо.", "Я ще не до кінця зрозумів ваше запитання. Уточніть, що ви хочете дізнатися.", "Товар, який перевіряємо", "Не можу підтвердити, що цей результат стосується вибраного товару."],
  cs: ["Můžeme produkty prověřit jeden po druhém. Kterým začneme?", "Uveďte údaje o jednom konkrétním produktu, abychom jej mohli prověřit zvlášť.", "Ještě jsem vaší otázce úplně neporozuměl. Upřesněte, co byste chtěli vědět.", "Právě prověřovaný produkt", "Nemohu potvrdit, že tento výsledek odpovídá vybranému produktu."],
  sk: ["Môžeme produkty preveriť jeden po druhom. Ktorým začneme?", "Uveďte údaje o jednom konkrétnom produkte, aby sa dal preveriť osobitne.", "Vašej otázke som ešte úplne neporozumel. Spresnite, čo by ste chceli vedieť.", "Práve preverovaný produkt", "Nemôžem potvrdiť, že tento výsledok zodpovedá vybranému produktu."],
  hu: ["Egyenként ellenőrizhetjük a termékeket. Melyikkel kezdjük?", "Adj meg egy konkrét terméket és az adatait, hogy külön ellenőrizhessük.", "Még nem értettem meg pontosan a kérdésedet. Kérlek, pontosítsd, mit szeretnél tudni.", "Az éppen ellenőrzött termék", "Nem tudom megerősíteni, hogy ez az eredmény a kiválasztott termékhez tartozik."],
  ro: ["Putem verifica produsele pe rând. Cu care începem?", "Precizează detaliile unui singur produs pentru a-l verifica separat.", "Încă nu am înțeles bine întrebarea ta. Clarifică ce ai dori să afli.", "Produsul verificat acum", "Nu pot confirma că acest rezultat corespunde produsului selectat."],
  bg: ["Можем да проверим продуктите един по един. С кой да започнем?", "Посочете данните за един конкретен продукт, за да го проверим отделно.", "Все още не съм разбрал напълно въпроса ви. Уточнете какво искате да знаете.", "Продуктът, който проверяваме", "Не мога да потвърдя, че този резултат се отнася за избрания продукт."],
  el: ["Μπορούμε να ελέγξουμε τα προϊόντα ένα ένα. Με ποιο να ξεκινήσουμε;", "Δώσε τα στοιχεία ενός συγκεκριμένου προϊόντος ώστε να ελεγχθεί ξεχωριστά.", "Δεν έχω καταλάβει ακόμη καλά την ερώτησή σου. Διευκρίνισε τι θα ήθελες να μάθεις.", "Προϊόν που ελέγχουμε", "Δεν μπορώ να επιβεβαιώσω ότι αυτό το αποτέλεσμα αφορά το επιλεγμένο προϊόν."],
  he: ["אפשר לבדוק את המוצרים אחד אחד. מאיזה נתחיל?", "נא לספק את הפרטים של מוצר מסוים אחד כדי לבדוק אותו בנפרד.", "עדיין לא הבנתי היטב את השאלה שלך. נא להבהיר מה ברצונך לדעת.", "המוצר שנבדק כעת", "איני יכול לאשר שהתוצאה הזאת מתייחסת למוצר שנבחר."],
  th: ["เราสามารถตรวจสอบสินค้าทีละรายการได้ อยากเริ่มจากรายการไหน", "โปรดระบุข้อมูลของสินค้าหนึ่งรายการให้ชัดเจนเพื่อให้ตรวจสอบแยกได้", "ยังเข้าใจคำถามของคุณไม่ชัดเจน กรุณาอธิบายเพิ่มเติมว่าต้องการทราบอะไร", "สินค้าที่กำลังตรวจสอบ", "ยังยืนยันไม่ได้ว่าผลลัพธ์นี้ตรงกับสินค้าที่เลือก"],
  vi: ["Mình có thể kiểm tra từng sản phẩm. Bạn muốn bắt đầu với sản phẩm nào?", "Hãy cung cấp thông tin của một sản phẩm cụ thể để kiểm tra riêng.", "Mình vẫn chưa hiểu rõ câu hỏi của bạn. Hãy nói rõ bạn muốn biết điều gì.", "Sản phẩm đang kiểm tra", "Mình chưa thể xác nhận kết quả này thuộc về sản phẩm đã chọn."],
  ms: ["Kita boleh menyemak produk satu demi satu. Mahu mula dengan yang mana?", "Nyatakan butiran satu produk tertentu supaya dapat disemak secara berasingan.", "Saya masih belum memahami soalan anda dengan jelas. Jelaskan perkara yang ingin anda ketahui.", "Produk yang sedang disemak", "Saya tidak dapat mengesahkan bahawa hasil ini merujuk kepada produk yang dipilih."],
  ta: ["பொருட்களை ஒவ்வொன்றாகச் சரிபார்க்கலாம். எதில் தொடங்கலாம்?", "தனியாகச் சரிபார்க்க ஒரு குறிப்பிட்ட பொருளின் விவரங்களைத் தரவும்.", "உங்கள் கேள்வியை இன்னும் முழுமையாகப் புரிந்துகொள்ளவில்லை. நீங்கள் என்ன தெரிந்துகொள்ள விரும்புகிறீர்கள் என்பதை விளக்கவும்.", "இப்போது சரிபார்க்கும் பொருள்", "இந்த முடிவு தேர்ந்தெடுத்த பொருளுக்கானது என்பதை உறுதிப்படுத்த முடியவில்லை."],
  bn: ["আমরা পণ্যগুলো এক এক করে যাচাই করতে পারি। কোনটি দিয়ে শুরু করব?", "আলাদাভাবে যাচাই করার জন্য একটি নির্দিষ্ট পণ্যের তথ্য দিন।", "আমি এখনো আপনার প্রশ্নটি পুরোপুরি বুঝতে পারিনি। আপনি কী জানতে চান তা স্পষ্ট করুন।", "এখন যে পণ্য যাচাই করছি", "এই ফলটি বেছে নেওয়া পণ্যের জন্য কি না, তা নিশ্চিত করতে পারছি না।"],
  ur: ["ہم مصنوعات کو ایک ایک کرکے دیکھ سکتے ہیں۔ کس سے شروع کریں؟", "الگ سے جانچنے کے لیے کسی ایک مخصوص مصنوعات کی تفصیل دیں۔", "میں ابھی آپ کا سوال پوری طرح نہیں سمجھ سکا۔ براہ کرم واضح کریں کہ آپ کیا جاننا چاہتے ہیں۔", "ابھی زیرِ جائزہ مصنوعات", "تصدیق نہیں کر سکتا کہ یہ نتیجہ منتخب مصنوعات سے متعلق ہے۔"],
  fa: ["می‌توانیم محصولات را یکی‌یکی بررسی کنیم. از کدام شروع کنیم؟", "لطفاً اطلاعات یک محصول مشخص را بدهید تا جداگانه بررسی شود.", "هنوز پرسش شما را به‌خوبی متوجه نشده‌ام. لطفاً روشن کنید چه چیزی می‌خواهید بدانید.", "محصول در حال بررسی", "نمی‌توانم تأیید کنم که این نتیجه مربوط به محصول انتخاب‌شده است."],
  sw: ["Tunaweza kukagua bidhaa moja baada ya nyingine. Tuanze na ipi?", "Tafadhali toa maelezo ya bidhaa moja maalumu ili ikaguliwe kando.", "Bado sijaelewa swali lako vizuri. Tafadhali fafanua unachotaka kujua.", "Bidhaa tunayokagua sasa", "Siwezi kuthibitisha kwamba matokeo haya yanahusu bidhaa iliyochaguliwa."],
  tl: ["Maaari nating tingnan ang mga produkto nang paisa-isa. Alin ang uunahin?", "Ibigay ang detalye ng isang tiyak na produkto para masuri ito nang hiwalay.", "Hindi ko pa lubos na naunawaan ang tanong mo. Pakilinaw kung ano ang gusto mong malaman.", "Produktong sinusuri ngayon", "Hindi ko makumpirma na ang resultang ito ay para sa napiling produkto."],
  ca: ["Podem revisar els articles un per un. Per quin comencem?", "Indica els detalls d’un producte concret per revisar-lo per separat.", "Encara no he entès bé la teva pregunta. Aclareix què voldries saber.", "Article que estem revisant", "No puc confirmar que aquest resultat correspongui a l’article seleccionat."],
  hr: ["Proizvode možemo provjeriti jedan po jedan. S kojim ćemo početi?", "Navedite podatke o jednom konkretnom proizvodu kako bismo ga zasebno provjerili.", "Još nisam potpuno razumio tvoje pitanje. Pojasni što želiš saznati.", "Proizvod koji provjeravamo", "Ne mogu potvrditi da se ovaj rezultat odnosi na odabrani proizvod."],
  sr: ["Можемо да проверимо производе један по један. Од ког да почнемо?", "Наведите податке о једном конкретном производу да бисмо га засебно проверили.", "Још нисам потпуно разумео твоје питање. Појасни шта желиш да сазнаш.", "Производ који проверавамо", "Не могу да потврдим да се овај резултат односи на изабрани производ."],
  lt: ["Galime patikrinti prekes po vieną. Nuo kurios pradėsime?", "Pateikite vieno konkretaus produkto duomenis, kad jį būtų galima patikrinti atskirai.", "Dar ne iki galo supratau jūsų klausimą. Patikslinkite, ką norėtumėte sužinoti.", "Tikrinama prekė", "Negaliu patvirtinti, kad šis rezultatas susijęs su pasirinkta preke."],
  lv: ["Varam pārbaudīt preces pa vienai. Ar kuru sāksim?", "Norādiet viena konkrēta produkta informāciju, lai to varētu pārbaudīt atsevišķi.", "Es vēl neesmu pilnībā sapratis jūsu jautājumu. Precizējiet, ko vēlaties uzzināt.", "Prece, ko pašlaik pārbaudām", "Nevaru apstiprināt, ka šis rezultāts attiecas uz izvēlēto preci."],
  et: ["Saame tooteid ükshaaval kontrollida. Millisest alustame?", "Esita ühe konkreetse toote andmed, et seda saaks eraldi kontrollida.", "Ma ei ole su küsimusest veel täielikult aru saanud. Palun täpsusta, mida soovid teada.", "Praegu kontrollitav toode", "Ma ei saa kinnitada, et see tulemus puudutab valitud toodet."],
});

// A text-only fallback for a validated merchandise purpose. It neither selects
// a prior target nor claims a search, result, price, availability or action.
const PRODUCT_CLARIFICATION_COPY = Object.freeze({
  en: "I understand you’re choosing products. Which requirements matter most to you?",
  zh: "我明白你想挑选商品。你最看重哪些要求？",
  es: "Entiendo que quieres elegir productos. ¿Qué requisitos son los más importantes para ti?",
  fr: "Je comprends que vous souhaitez choisir des produits. Quels critères comptent le plus pour vous ?",
  de: "Ich verstehe, dass du Produkte auswählen möchtest. Welche Anforderungen sind dir am wichtigsten?",
  pt: "Entendo que queres escolher produtos. Quais são os requisitos mais importantes para ti?",
  it: "Capisco che vuoi scegliere dei prodotti. Quali requisiti contano di più per te?",
  ja: "商品を選びたいのですね。どのような条件を最も重視していますか？",
  ko: "상품을 고르고 싶으시군요. 어떤 조건을 가장 중요하게 생각하시나요?",
  ar: "أفهم أنك تريد اختيار منتجات. ما المتطلبات الأهم بالنسبة لك؟",
  hi: "आप उत्पाद चुनना चाहते हैं। आपके लिए कौन-सी ज़रूरतें सबसे ज़्यादा मायने रखती हैं?",
  id: "Aku mengerti kamu ingin memilih produk. Persyaratan apa yang paling penting bagimu?",
  tr: "Ürün seçmek istediğini anlıyorum. Hangi özellikler senin için en önemli?",
  nl: "Ik begrijp dat je producten wilt kiezen. Welke eisen zijn voor jou het belangrijkst?",
  pl: "Rozumiem, że chcesz wybrać produkty. Jakie wymagania są dla Ciebie najważniejsze?",
  sv: "Jag förstår att du vill välja produkter. Vilka krav är viktigast för dig?",
  no: "Jeg forstår at du vil velge produkter. Hvilke krav er viktigst for deg?",
  da: "Jeg forstår, at du vil vælge produkter. Hvilke krav er vigtigst for dig?",
  fi: "Ymmärrän, että haluat valita tuotteita. Mitkä vaatimukset ovat sinulle tärkeimpiä?",
  ru: "Понимаю, что вы хотите выбрать товары. Какие требования для вас важнее всего?",
  uk: "Розумію, що ви хочете вибрати товари. Які вимоги для вас найважливіші?",
  cs: "Rozumím, že si chcete vybrat produkty. Jaké požadavky jsou pro vás nejdůležitější?",
  sk: "Rozumiem, že si chcete vybrať produkty. Aké požiadavky sú pre vás najdôležitejšie?",
  hu: "Értem, hogy termékeket szeretnél választani. Mely szempontok a legfontosabbak számodra?",
  ro: "Înțeleg că vrei să alegi produse. Ce cerințe sunt cele mai importante pentru tine?",
  bg: "Разбирам, че искате да изберете продукти. Кои изисквания са най-важни за вас?",
  el: "Καταλαβαίνω ότι θέλεις να επιλέξεις προϊόντα. Ποιες απαιτήσεις είναι πιο σημαντικές για σένα;",
  he: "ברור שברצונך לבחור מוצרים. אילו דרישות הכי חשובות לך?",
  th: "เข้าใจว่าคุณต้องการเลือกสินค้า เงื่อนไขใดสำคัญกับคุณมากที่สุด?",
  vi: "Mình hiểu bạn muốn chọn sản phẩm. Những yêu cầu nào quan trọng nhất với bạn?",
  ms: "Saya faham anda ingin memilih produk. Apakah keperluan yang paling penting bagi anda?",
  ta: "நீங்கள் பொருட்களைத் தேர்ந்தெடுக்க விரும்புகிறீர்கள் என்பது புரிகிறது. எந்தத் தேவைகள் உங்களுக்கு மிகவும் முக்கியம்?",
  bn: "বুঝতে পারছি আপনি পণ্য বেছে নিতে চান। কোন চাহিদাগুলো আপনার কাছে সবচেয়ে গুরুত্বপূর্ণ?",
  ur: "آپ مصنوعات منتخب کرنا چاہتے ہیں۔ آپ کے لیے کون سی ضروریات سب سے اہم ہیں؟",
  fa: "متوجه‌ام که می‌خواهید محصول انتخاب کنید. کدام معیارها برای شما مهم‌ترند؟",
  sw: "Ninaelewa unataka kuchagua bidhaa. Ni mahitaji gani muhimu zaidi kwako?",
  tl: "Nauunawaan kong gusto mong pumili ng mga produkto. Aling mga kinakailangan ang pinakamahalaga sa iyo?",
  ca: "Entenc que vols triar productes. Quins requisits són els més importants per a tu?",
  hr: "Razumijem da želite odabrati proizvode. Koji su vam zahtjevi najvažniji?",
  sr: "Разумем да желите да изаберете производе. Који су вам захтеви најважнији?",
  lt: "Suprantu, kad norite pasirinkti prekes. Kokie reikalavimai jums svarbiausi?",
  lv: "Saprotu, ka vēlaties izvēlēties preces. Kuras prasības jums ir vissvarīgākās?",
  et: "Saan aru, et soovid tooteid valida. Millised nõuded on sinu jaoks kõige olulisemad?",
});

function copyLanguageCode(languageCode) {
  return normalizeCharacterLanguage(languageCode)?.code
    || normalizeCharacterLanguage(String(languageCode).split(/[-_]/)[0])?.code || "en";
}

export function buildProductClarificationFallbackReply(language = "en") {
  return PRODUCT_CLARIFICATION_COPY[copyLanguageCode(language)] || PRODUCT_CLARIFICATION_COPY.en;
}

function copyFor(languageCode) {
  return COPY[copyLanguageCode(languageCode)] || COPY.en;
}

function evidenceItems(state) {
  if (!Array.isArray(state?.items) || state.items.length < 2 || state.items.length > 4) return null;
  const items = state.items.map((item) => {
    if (typeof item?.evidence !== "string" || !item.evidence.trim() || item.evidence.length > 240) return "";
    // Render quotes as plain text: no embedded lines, bidi controls, HTML or
    // Markdown links/images/code. This never promotes evidence into instructions.
    return item.evidence.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ").replace(/[<>\[\]()`*_#\\]/g, (char) => ({ "<": "‹", ">": "›", "[": "［", "]": "］", "(": "（", ")": "）", "`": "′", "*": "＊", "_": "＿", "#": "＃", "\\": "＼" })[char]).trim();
  });
  return items.every(Boolean) ? items : null;
}

export function buildProductRequestScopeCopy(searchIntent = {}, { languageCode = "en" } = {}) {
  const copy = copyFor(languageCode);
  if (searchIntent.scopeUnverified === true) return copy[2];
  const state = searchIntent.productRequestState;
  if (state?.status === "cleared" || state?.status === "selected") return "";
  if (searchIntent.productScopePending !== true && state?.status !== "pending") return "";
  if (searchIntent.searchState === "clarification_exhausted") return copy[1];
  const items = evidenceItems(state);
  return items ? `${copy[0]}\n${items.map((item, index) => `${index + 1}. “${item}”`).join("\n")}` : copy[2];
}

export function productScopeResultLabel(searchIntent = {}, { languageCode = "en" } = {}) {
  if (searchIntent.scopeUnverified === true || searchIntent.productScopePending === true) return "";
  const state = searchIntent.productRequestState;
  const items = evidenceItems(state);
  const index = state?.selectedIndex;
  return state?.status === "selected" && items && Number.isInteger(index) && index >= 0 && index < items.length
    ? `${copyFor(languageCode)[3]}: “${items[index]}”` : "";
}

export function buildProductScopeUnverifiedResultCopy(searchIntent = {}, { languageCode = "en" } = {}) {
  return searchIntent.scopeUnverified === true || searchIntent.productScopePending === true
    || ["pending", "selected"].includes(searchIntent.productRequestState?.status) ? copyFor(languageCode)[4] : "";
}
