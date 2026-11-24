import { sanitizeProductSizingChart } from "./product-sizing-context-service.js";

const UNVERIFIED = Object.freeze({
  en: "I can’t confirm this product’s measurements here.", zh: "目前无法确认这件商品的具体尺码数据。", es: "No puedo confirmar las medidas de este producto aquí.",
  fr: "Je ne peux pas confirmer les mesures de ce produit ici.", de: "Ich kann die Maße dieses Produkts hier nicht bestätigen.", it: "Non posso confermare le misure di questo prodotto qui.", pt: "Não consigo confirmar as medidas deste produto aqui.",
  hu: "Itt nem tudom megerősíteni ennek a terméknek a méreteit.", tr: "Bu ürünün ölçülerini burada doğrulayamıyorum.", ar: "لا أستطيع تأكيد قياسات هذا المنتج هنا.", ja: "ここではこの商品の寸法を確認できません。", ko: "여기서는 이 상품의 치수를 확인할 수 없어요.",
  hi: "मैं यहाँ इस उत्पाद के माप की पुष्टि नहीं कर सकता।", id: "Saya belum bisa memastikan ukuran produk ini di sini.", nl: "Ik kan de afmetingen van dit product hier niet bevestigen.", pl: "Nie mogę tutaj potwierdzić wymiarów tego produktu.",
  sv: "Jag kan inte bekräfta måtten på den här produkten här.", no: "Jeg kan ikke bekrefte målene på dette produktet her.", da: "Jeg kan ikke bekræfte målene på dette produkt her.", fi: "En voi vahvistaa tämän tuotteen mittoja täällä.",
  ru: "Я не могу подтвердить размеры этого товара здесь.", uk: "Я не можу підтвердити розміри цього товару тут.", cs: "Zde nemohu potvrdit rozměry tohoto produktu.", sk: "Tu nemôžem potvrdiť rozmery tohto produktu.", ro: "Nu pot confirma aici dimensiunile acestui produs.",
  bg: "Тук не мога да потвърдя размерите на този продукт.", el: "Δεν μπορώ να επιβεβαιώσω εδώ τις διαστάσεις αυτού του προϊόντος.", he: "אין לי אפשרות לאמת כאן את מידות המוצר הזה.", th: "ฉันยังยืนยันขนาดของสินค้านี้ที่นี่ไม่ได้", vi: "Mình chưa thể xác nhận số đo của sản phẩm này tại đây.",
  ms: "Saya belum dapat mengesahkan ukuran produk ini di sini.", ta: "இந்தப் பொருளின் அளவுகளை இங்கே உறுதிப்படுத்த முடியவில்லை.", bn: "আমি এখানে এই পণ্যের মাপ নিশ্চিত করতে পারছি না।", ur: "میں یہاں اس مصنوع کی پیمائش کی تصدیق نہیں کر سکتا۔", fa: "نمی‌توانم اندازه‌های این محصول را در اینجا تأیید کنم.",
  sw: "Siwezi kuthibitisha vipimo vya bidhaa hii hapa.", tl: "Hindi ko makumpirma ang mga sukat ng produktong ito rito.", ca: "No puc confirmar aquí les mides d’aquest producte.", hr: "Ovdje ne mogu potvrditi mjere ovog proizvoda.", sr: "Овде не могу да потврдим мере овог производа.",
  lt: "Čia negaliu patvirtinti šios prekės matmenų.", lv: "Šeit nevaru apstiprināt šīs preces izmērus.", et: "Ma ei saa siin selle toote mõõtmeid kinnitada.",
});

// Translate interface labels only. Source cells and explicit units remain
// byte-for-byte quotations; an unfamiliar heading is never guessed.
const CHART_LABEL_KEYS = ['Size Chart', 'Size', 'Age ref', 'Height', 'Weight', 'Length', 'Chest', 'Shorts Length'];
const CHART_LABELS = Object.freeze({
  en: CHART_LABEL_KEYS,
  es: ['Tabla de tallas', 'Talla', 'Edad de referencia', 'Estatura', 'Peso', 'Largo', 'Pecho', 'Largo del pantalón corto'],
  zh: ['尺码表', '尺码', '参考年龄', '身高', '体重', '衣长', '胸围', '短裤长度'],
  fr: ['Guide des tailles', 'Taille', 'Âge indicatif', 'Taille corporelle', 'Poids', 'Longueur', 'Poitrine', 'Longueur du short'],
  de: ['Größentabelle', 'Größe', 'Richtalter', 'Körpergröße', 'Gewicht', 'Länge', 'Brust', 'Shortslänge'],
  it: ['Tabella taglie', 'Taglia', 'Età indicativa', 'Altezza', 'Peso', 'Lunghezza', 'Torace', 'Lunghezza pantaloncini'],
  pt: ['Tabela de tamanhos', 'Tamanho', 'Idade de referência', 'Altura', 'Peso', 'Comprimento', 'Peito', 'Comprimento dos calções'],
  hu: ['Mérettáblázat', 'Méret', 'Tájékoztató életkor', 'Magasság', 'Testsúly', 'Hossz', 'Mellbőség', 'Rövidnadrág hossza'],
  tr: ['Beden tablosu', 'Beden', 'Referans yaş', 'Boy', 'Kilo', 'Uzunluk', 'Göğüs', 'Şort uzunluğu'],
  ar: ['جدول المقاسات', 'المقاس', 'العمر المرجعي', 'الطول', 'الوزن', 'طول القطعة', 'الصدر', 'طول الشورت'],
});

// A controlled replacement quotes only the bounded source table. It adds no
// unit, conversion, body-size rule or fit promise when generation cannot pass review.
export function buildProductSizingFallback(product = {}, language = "en", { userText = '', recentUserMessages = [] } = {}) {
  const chart = product.sizeChartResolved === true ? sanitizeProductSizingChart(product.sizeChart) : null;
  if (!chart) return UNVERIFIED[language] || UNVERIFIED.en;
  let rows = chart.rows;
  // Quote rows corresponding to literal USER numbers only. No age-to-size
  // mapping, unit assumption, numeric interpolation or fit recommendation.
  if (/\d/.test(userText)) {
    const sizeIndex = chart.columns.findIndex(column => /^size$/i.test(column.trim()));
    const currentNumbers = new Set(String(userText).match(/\b\d+(?:[.,]\d+)?\b/g) || []);
    const ranges = new Set([String(userText), ...recentUserMessages.filter(value => typeof value === 'string').slice(-4)]
      .flatMap(value => value.match(/\b\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\b/g) || [])
      .map(value => value.replace(/\s/g, '').replace(/–/g, '-')));
    const matching = chart.rows.filter(row => sizeIndex >= 0 && currentNumbers.has(row[sizeIndex])
      || row.some(cell => ranges.has(String(cell).replace(/\s/g, '').replace(/–/g, '-'))));
    if (matching.length) rows = matching;
  }
  const labels = CHART_LABELS[String(language).toLowerCase().split(/[-_]/)[0]];
  const label = value => { const index = CHART_LABEL_KEYS.findIndex(key => key.toLowerCase() === String(value).trim().toLowerCase()); return labels && index >= 0 ? labels[index] : value; };
  return [label(chart.title), chart.unit || "", chart.columns.map(label).join(" | "), ...rows.map((row) => row.join(" | "))].filter(Boolean).join("\n");
}
