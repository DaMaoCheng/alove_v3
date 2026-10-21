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

// A controlled replacement quotes only the bounded source table. It adds no
// unit, conversion, body-size rule or fit promise when generation cannot pass review.
export function buildProductSizingFallback(product = {}, language = "en") {
  const chart = product.sizeChartResolved === true ? sanitizeProductSizingChart(product.sizeChart) : null;
  if (!chart) return UNVERIFIED[language] || UNVERIFIED.en;
  return [chart.title, chart.unit || "", chart.columns.join(" | "), ...chart.rows.map((row) => row.join(" | "))].filter(Boolean).join("\n");
}
