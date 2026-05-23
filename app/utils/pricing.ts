export type PricingRuleLike = {
  adjustmentType?: string;
  adjustmentDirection?: string;
  adjustmentValue?: number | null;
  endingOption?: string | null;
  roundingPrecision?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
};

type LegacySignature = {
  markup: number;
  rounding: number;
  charm: boolean;
};

function normalizeLegacy(markup: number, rounding: number, charm: boolean): PricingRuleLike {
  const direction = markup < 0 ? "decrease" : "increase";
  const endingOption = charm
    ? "0.99"
    : rounding > 0
      ? Number(rounding).toFixed(2)
      : "none";

  return {
    adjustmentType: "percentage",
    adjustmentDirection: direction,
    adjustmentValue: Math.abs(markup),
    endingOption,
    roundingPrecision: "standard",
    minPrice: null,
    maxPrice: null,
  };
}

function applyRoundingPrecision(value: number, roundingPrecision: string) {
  if (!isFinite(value)) return 0;

  if (roundingPrecision === "whole") {
    return Math.round(value);
  }

  if (roundingPrecision === "nearest-0.05") {
    return Math.round(value / 0.05) * 0.05;
  }

  return Number(value.toFixed(2));
}

function applyEndingOption(value: number, endingOption: string, direction: string) {
  if (!isFinite(value)) return 0;

  const normalized = (endingOption ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "none") {
    return Number(value.toFixed(2));
  }

  const endingNumber = Number(normalized);
  if (!isFinite(endingNumber) || endingNumber < 0 || endingNumber >= 1) {
    return Number(value.toFixed(2));
  }

  let candidate = Math.floor(value) + endingNumber;
  const dir = (direction ?? "").toLowerCase();

  if (dir === "decrease") {
    if (candidate > value) {
      candidate -= 1;
    }
  } else {
    if (candidate < value) {
      candidate += 1;
    }
  }

  return Number(candidate.toFixed(2));
}

function clamp(value: number, minPrice?: number | null, maxPrice?: number | null) {
  let result = value;
  if (typeof minPrice === "number" && isFinite(minPrice)) {
    result = Math.max(result, minPrice);
  }
  if (typeof maxPrice === "number" && isFinite(maxPrice)) {
    result = Math.min(result, maxPrice);
  }
  return Number(result.toFixed(2));
}

export function calculatePrice(price: number, markup: number, rounding: number, charm: boolean): number;
export function calculatePrice(price: number, rule: PricingRuleLike): number;
export function calculatePrice(
  price: number,
  markupOrRule: number | PricingRuleLike,
  rounding?: number,
  charm?: boolean
): number {
  if (!isFinite(price)) return 0;

  const rule: PricingRuleLike = typeof markupOrRule === "number"
    ? normalizeLegacy(markupOrRule, Number(rounding ?? 0), Boolean(charm))
    : (markupOrRule ?? {});

  const adjustmentType = (rule.adjustmentType ?? "percentage").toLowerCase();
  const adjustmentDirection = (rule.adjustmentDirection ?? "increase").toLowerCase();
  const adjustmentValue = Number(rule.adjustmentValue ?? 0);

  const signed = adjustmentDirection === "decrease" ? -1 : 1;
  let adjusted = price;

  if (adjustmentType === "fixed") {
    adjusted = price + signed * adjustmentValue;
  } else {
    adjusted = price * (1 + signed * (adjustmentValue / 100));
  }

  adjusted = applyRoundingPrecision(adjusted, (rule.roundingPrecision ?? "standard").toLowerCase());
  const finalWithEnding = applyEndingOption(adjusted, String(rule.endingOption ?? "none"), adjustmentDirection);
  return clamp(finalWithEnding, rule.minPrice, rule.maxPrice);
}
