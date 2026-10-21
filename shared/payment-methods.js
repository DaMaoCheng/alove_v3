export const PAYMENT_METHOD_OPTIONS = Object.freeze([
  Object.freeze({ key: "shop_pay", label: "Shop Pay", icon: "/assets/payment-icons/shop_pay.svg" }),
  Object.freeze({ key: "apple_pay", label: "Apple Pay", icon: "/assets/payment-icons/apple_pay.svg" }),
  Object.freeze({ key: "google_pay", label: "Google Pay", icon: "/assets/payment-icons/google_pay.svg" }),
  Object.freeze({ key: "visa", label: "Visa", icon: "/assets/payment-icons/visa.svg" }),
  Object.freeze({ key: "mastercard", label: "Mastercard", icon: "/assets/payment-icons/mastercard.svg" }),
  Object.freeze({ key: "paypal", label: "PayPal", icon: "/assets/payment-icons/paypal.svg" }),
  Object.freeze({ key: "bancontact", label: "Bancontact", icon: "/assets/payment-icons/bancontact.svg" }),
  Object.freeze({ key: "klarna", label: "Klarna", icon: "/assets/payment-icons/klarna.svg" }),
  Object.freeze({ key: "diners_club", label: "Diners Club", icon: "/assets/payment-icons/diners_club.svg" }),
  Object.freeze({ key: "discover", label: "Discover", icon: "/assets/payment-icons/discover.svg" }),
  Object.freeze({ key: "amex", label: "American Express", icon: "/assets/payment-icons/amex.svg" }),
]);

const PAYMENT_METHOD_KEYS = new Set(PAYMENT_METHOD_OPTIONS.map((option) => option.key));

export function normalizePaymentMethods(value = []) {
  const rawItems = Array.isArray(value) ? value : parsePaymentMethodValue(value);
  const methods = [];
  const seen = new Set();
  for (const item of rawItems) {
    const key = String(item || "").trim().toLowerCase();
    if (!PAYMENT_METHOD_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    methods.push(key);
  }
  return methods;
}

function parsePaymentMethodValue(value) {
  if (value == null || value === "") return [];
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(value)) {
    return parsePaymentMethodValue(value.toString("utf8"));
  }
  if (value instanceof Uint8Array) {
    return parsePaymentMethodValue(new TextDecoder().decode(value));
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value.split(",");
  }
}
