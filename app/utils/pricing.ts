/**
 * Calculate polished price with markup, rounding, and optional charm pricing.
 *
 * @param price     - Original price
 * @param markup    - Markup percentage (e.g. 10 for 10%)
 * @param rounding  - Rounding step (e.g. 1 rounds to nearest dollar)
 * @param charm     - If true, set decimal to .99
 * @returns         - New calculated price
 */
export function calculatePrice(
    price: number,
    markup: number,
    rounding: number,
    charm: boolean,
): number {
    // Step 1: Apply markup percentage
    let result = price * (1 + markup / 100);

    // Step 2: Apply Price Ending (Fixed Decimal) or Charm Pricing
    if (charm) {
        result = Math.floor(result) + 0.99;
    } else if (rounding > 0) {
        result = Math.floor(result) + rounding;
    }

    // Ensure two decimal places
    return parseFloat(result.toFixed(2));
}
