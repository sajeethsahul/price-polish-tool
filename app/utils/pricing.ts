/**
 * Calculate polished price with markup, rounding, and optional charm pricing.
 *
 * @param price     - Original price
 * @param markup    - Markup percentage (e.g. 10 for 10%)
 * @param rounding  - Rounding step (e.g. 1 rounds to nearest dollar)
 * @param charm     - If true, set decimal to .99
 * @returns         - New calculated price
 */
/**
 * Production-grade pricing engine
 */
export function calculatePrice(
    price: number,
    markup: number,
    rounding: number,
    charm: boolean
  ): number {
    if (!isFinite(price)) return 0;
  
    // 1. Apply markup
    let result = price * (1 + markup / 100);
  
    // 2. Charm pricing (highest priority)
    if (charm) {
      return Number((Math.floor(result) + 0.99).toFixed(2));
    }
  
    // 3. Decimal rounding (e.g., 0.55 → 73.55 or 74.55)
    if (rounding > 0) {
      let rounded = Math.floor(result) + rounding;
  
      // 🔥 critical fix — ensure not less than original
      if (rounded < result) {
        rounded += 1;
      }
  
      return Number(rounded.toFixed(2));
    }
  
    // 4. Default fallback
    return Number(Math.round(result).toFixed(2));
  }