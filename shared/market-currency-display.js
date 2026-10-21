const MARKET_CURRENCY_FORMATTERS = Object.freeze({
  HUF: Object.freeze({
    fractionDigits: 0,
    format(amount) {
      return new Intl.NumberFormat("hu-HU", {
        style: "currency",
        currency: "HUF",
        currencyDisplay: "symbol",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    },
  }),
  MAD: Object.freeze({
    fractionDigits: 2,
    format(amount) {
      return `Dh ${amount.toFixed(2)} MAD`;
    },
  }),
});

export function normalizeMarketCurrencyCode(value = "") {
  const code = String(value || "").trim().toUpperCase();
  return code === "RMB" ? "CNY" : code;
}

export function detectMarketCurrencyCode(value = "") {
  const text = String(value || "").trim();
  if (/\b(?:HUF|Ft)\b/i.test(text)) return "HUF";
  if (/\b(?:MAD|Dh)\b/i.test(text)) return "MAD";
  return "";
}

export function resolveMarketCurrencyFractionDigits(currency = "") {
  const formatter = MARKET_CURRENCY_FORMATTERS[normalizeMarketCurrencyCode(currency)];
  return formatter ? formatter.fractionDigits : null;
}

export function formatMarketCurrencyAmount(value, currency = "") {
  const amount = Number(value);
  const formatter = MARKET_CURRENCY_FORMATTERS[normalizeMarketCurrencyCode(currency)];
  if (!formatter || !Number.isFinite(amount)) return "";
  return formatter.format(amount);
}
