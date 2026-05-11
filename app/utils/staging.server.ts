import prisma from "../db.server";
import { calculatePrice } from "./pricing";

type ProductInput = {
  variantId: string;
  productId: string;
  oldPrice: string | number;
  newPrice: string | number;
  overriddenPrice?: string;
  isManual?: boolean;
};

type StagedItem = {
  variantId: string;
  productId: string;
  originalPrice: number;
  stagedPrice: number;
};

type FailedItem = {
  variantId: string;
  reason: string;
};

type StagingResult = {
  success: boolean;
  successCount: number;
  failedCount: number;
  stagedItems: StagedItem[];
  failedItems: FailedItem[];
  message?: string;
};

/**
 * Shared staging logic — generates StagedPrice rows for a shop.
 *
 * Used by:
 *   - api.staging-price.ts  (Apply flow)
 *   - api.schedule-pricing.ts (Schedule flow — auto-stage before creating job)
 *   - Future bulk workflows
 *
 * Validates per-item, calculates via calculatePrice, persists to StagedPrice.
 * Returns a structured result with success/fail counts and item-level detail
 * for better logs, toasts, and analytics.
 */
export async function stagePrices(
  shop: string,
  products: ProductInput[]
): Promise<StagingResult> {
  const emptyResult: StagingResult = {
    success: false,
    successCount: 0,
    failedCount: 0,
    stagedItems: [],
    failedItems: [],
    message: "No products available to stage.",
  };

  if (!Array.isArray(products) || products.length === 0) {
    return emptyResult;
  }

  const rule = await prisma.pricingRule.findUnique({
    where: { shop },
  });

  if (!rule) {
    return {
      ...emptyResult,
      message: "No pricing rule configured.",
    };
  }

  // Per-item validation + calculation
  const stagedItems: StagedItem[] = [];
  const failedItems: FailedItem[] = [];

  for (const p of products) {
    // Validate variantId
    if (!p.variantId) {
      failedItems.push({ variantId: p.variantId || "unknown", reason: "Missing variantId" });
      continue;
    }

    const inputPrice = Number(
      p.overriddenPrice !== undefined ? p.overriddenPrice : p.newPrice
    );

    // Validate input price
    if (!isFinite(inputPrice) || inputPrice <= 0) {
      failedItems.push({ variantId: p.variantId, reason: `Invalid input price: ${inputPrice}` });
      continue;
    }

    const stagedPrice = calculatePrice(
      inputPrice,
      rule.markupPercent,
      rule.roundingStep,
      rule.charmPricing
    );

    // Validate calculated price
    if (!isFinite(stagedPrice) || stagedPrice <= 0) {
      failedItems.push({ variantId: p.variantId, reason: `Invalid calculated price: ${stagedPrice}` });
      continue;
    }

    stagedItems.push({
      variantId: p.variantId,
      productId: p.productId,
      originalPrice: Number(p.oldPrice),
      stagedPrice,
    });
  }

  // Only persist if we have valid items
  if (stagedItems.length > 0) {
    const rows = stagedItems.map((item) => ({
      shop,
      variantId: item.variantId,
      productId: item.productId,
      originalPrice: item.originalPrice,
      stagedPrice: item.stagedPrice,
    }));

    // Replace all existing staged prices for this shop with the new set
    await prisma.stagedPrice.deleteMany({ where: { shop } });
    await prisma.stagedPrice.createMany({ data: rows });
  }

  const success = stagedItems.length > 0;

  return {
    success,
    successCount: stagedItems.length,
    failedCount: failedItems.length,
    stagedItems,
    failedItems,
    message: success
      ? `Staged ${stagedItems.length} price(s) successfully${failedItems.length > 0 ? `, ${failedItems.length} failed` : ""}.`
      : `All ${failedItems.length} item(s) failed validation.`,
  };
}
