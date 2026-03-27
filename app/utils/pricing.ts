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

    // Step 2: Round to nearest rounding step (safe rounding)
    const roundingStep = rounding > 0 ? rounding : 1;
    result = Math.round(result / roundingStep) * roundingStep;

    // Step 3: If charm pricing, end with .99
    if (charm) {
        result = Math.floor(result) + 0.99;
    }

    // Ensure two decimal places
    return parseFloat(result.toFixed(2));
}
