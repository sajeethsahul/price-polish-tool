/**
 * Safe price parsing for values that may come from the Shopify storefront,
 * Shopify Admin API, or user input.
 *
 * Why this exists:
 *   parseFloat("1.000,00") → 1     (WRONG — European thousands separator)
 *   parseFloat("1,99")     → 1     (WRONG — European decimal comma)
 *
 * Shopify Markets storefronts render prices in the market's locale format
 * (e.g. "€1.000,00"), so any price string that may have been displayed to a
 * customer must be parsed with these rules, not plain parseFloat().
 */
export function parseShopifyPrice(
  value: string | number | null | undefined
): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;

  const str = String(value).trim();
  if (!str) return 0;

  // Remove currency symbols, whitespace, and any other non-numeric characters
  const cleaned = str.replace(/[^0-9.,\-]/g, "");

  const lastComma = cleaned.lastIndexOf(",");
  const lastPeriod = cleaned.lastIndexOf(".");

  if (lastComma > lastPeriod) {
    // European format: 1.000,00 → remove periods (thousands), comma → period
    return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  }

  // Standard format: 1,000.00 → remove commas (thousands)
  return parseFloat(cleaned.replace(/,/g, ""));
}
