import {
  detectMarketCurrencyCode,
  formatMarketCurrencyAmount,
  resolveMarketCurrencyFractionDigits,
} from "../../../shared/market-currency-display.js";

export function parseProductDisplayPrice(value) {
  const text = String(value || "").trim();
  const match = text.match(/-?\d(?:[\d, \u00a0\u202f]*\d)?(?:\.\d+)?/);
  if (!match) return null;
  const token = match[0];
  const numeric = Number(token.replace(/[\s,\u00a0\u202f]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  const prefix = text.slice(0, match.index);
  const suffix = text.slice((match.index || 0) + token.length);
  const currency = detectMarketCurrencyCode(text);
  const fraction = token.match(/\.(\d+)$/)?.[1] || "";
  const marketFractionDigits = resolveMarketCurrencyFractionDigits(currency);
  return {
    value: numeric,
    prefix,
    suffix,
    decimals: marketFractionDigits ?? (fraction ? fraction.length : 2),
    currency,
  };
}

export function formatProductDisplayPrice(parsed, value) {
  const marketFormatted = formatMarketCurrencyAmount(value, parsed?.currency);
  if (marketFormatted) return marketFormatted;
  const decimals = Math.max(0, Math.min(2, Number(parsed?.decimals) || 0));
  return `${parsed?.prefix || ""}${Number(value || 0).toFixed(decimals)}${parsed?.suffix || ""}`;
}

export function formatProductPriceForQuantity(value, quantity = 1) {
  const parsed = parseProductDisplayPrice(value);
  const normalizedQuantity = Math.min(99, Math.max(1, Math.trunc(Number(quantity) || 1)));
  return parsed ? formatProductDisplayPrice(parsed, parsed.value * normalizedQuantity) : String(value || "");
}
