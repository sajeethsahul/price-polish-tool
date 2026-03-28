export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);
}

export const ZERO_DECIMAL_CURRENCIES = [
  "JPY", "KRW", "CLP", "UGX", "VND", "BIF", "DJF", 
  "GNF", "ISK", "KMF", "PYG", "RWF", "VUV", "XAF", "XOF", "XPF"
];

export function getCurrencySymbol(currency: string) {
  return formatMoney(0, currency).replace(/\d/g, '').replace(/\./g, '').replace(/,/g, '').trim() || currency;
}
