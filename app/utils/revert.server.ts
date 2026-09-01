import prisma from "../db.server";

export type HistoryRecord = {
  id: string;
  variantId: string;
  oldPrice: number;
  newPrice?: number | null;
  productId?: string | null;
  oldCompareAtPrice?: number | null;
};

export type RevertResultRow = {
  id: string;
  variantId: string;
  success: boolean;
  error?: string;
  unrecoverableReason?: string;
};

export type RevertCampaignPricesOptions = {
  admin: any;
  shop: string;
  campaignId?: string;
  batchId?: string;
  retryFailedOnly?: boolean;
  successCampaignStatus?: string;
};

export type RevertCampaignPricesResult = {
  success: boolean;
  terminal: boolean;
  restoredCount: number;
  total: number;
  failedCount: number;
  unrecoverableCount: number;
  results: RevertResultRow[];
  message: string | null;
};

export function decideRestore(
  oldPrice: number,
  campaignPrice: number | null,
  currentPrice: number,
): { action: "restore" | "skip" | "flag"; reason?: string } {
  const tolerance = 0.01;

  // If we don't know what campaign wrote, fall back safely
  if (campaignPrice === null) {
    return { action: "restore", reason: "no_campaign_price_fallback" };
  }

  // Current price matches what campaign wrote — safe to restore
  if (Math.abs(currentPrice - campaignPrice) <= tolerance) {
    return { action: "restore" };
  }

  // Current price already matches old price — already at target
  if (Math.abs(currentPrice - oldPrice) <= tolerance) {
    return { action: "skip", reason: "already_at_target" };
  }

  // Price differs from both — external change detected
  return {
    action: "flag",
    reason: `drift_detected: expected ${campaignPrice}, found ${currentPrice}`,
  };
}

type LiveVariantPrice = {
  price: number;
  compareAtPrice: number | null;
  productId?: string | null;
};

async function fetchLiveVariantPrices(
  admin: any,
  variantGids: string[],
): Promise<Map<string, LiveVariantPrice>> {
  const priceMap = new Map<string, LiveVariantPrice>();
  const BATCH_SIZE = 50;

  for (let i = 0; i < variantGids.length; i += BATCH_SIZE) {
    const batch = variantGids.slice(i, i + BATCH_SIZE);
    try {
      const response = await admin.graphql(
        `query GetCurrentVariantPrices($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              price
              compareAtPrice
              product {
                id
              }
            }
          }
        }`,
        {
          variables: { ids: batch },
        }
      );

      const data: any = await response.json();
      const nodes = data?.data?.nodes ?? [];

      for (const node of nodes) {
        if (!node || !node.id) continue;
        const parsedPrice = node.price != null ? parseFloat(String(node.price)) : NaN;
        const parsedCompareAt =
          node.compareAtPrice != null && node.compareAtPrice !== ""
            ? parseFloat(String(node.compareAtPrice))
            : null;

        if (!Number.isNaN(parsedPrice)) {
          const info: LiveVariantPrice = {
            price: parsedPrice,
            compareAtPrice: Number.isNaN(parsedCompareAt) ? null : parsedCompareAt,
            productId: node.product?.id ?? null,
          };
          priceMap.set(node.id, info);
          priceMap.set(toVariantGid(node.id), info);
        }
      }
    } catch (error: any) {
      console.warn(
        `[REVERT] ⚠️ Failed to fetch live prices batch (${batch.length} variants), falling back to Level 1 behavior:`,
        error?.message || error
      );
    }
  }

  return priceMap;
}

function classifyUnrecoverableReason(message: unknown): string | null {
  const normalized = typeof message === "string" ? message.toLowerCase() : "";
  if (!normalized) return null;
  if (
    normalized.includes("variant") &&
    (normalized.includes("not found") || normalized.includes("does not exist"))
  ) {
    return "Variant no longer exists in Shopify";
  }
  if (
    normalized.includes("product") &&
    (normalized.includes("not found") || normalized.includes("does not exist"))
  ) {
    return "Product resource is no longer accessible";
  }
  if (
    normalized.includes("invalid id") ||
    normalized.includes("invalid global id") ||
    normalized.includes("invalid resource id")
  ) {
    return "Invalid Shopify resource ID";
  }
  if (normalized.includes("not_found") || normalized.includes("not found")) {
    return "Shopify resource not found";
  }
  return null;
}

function toVariantGid(variantId: string) {
  return variantId.startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;
}

export async function revertCampaignPrices({
  admin,
  shop,
  campaignId,
  batchId,
  retryFailedOnly = false,
  successCampaignStatus = "reverted",
}: RevertCampaignPricesOptions): Promise<RevertCampaignPricesResult> {
  if (!campaignId && !batchId) {
    throw new Error("No campaignId or batchId provided");
  }

  const useCampaignPath = Boolean(campaignId);
  const historyWhere = useCampaignPath
    ? {
        shop,
        campaignId,
        ...(retryFailedOnly
          ? { revertStatus: "failed" }
          : {
              OR: [
                { revertStatus: null },
                { revertStatus: { notIn: ["reverted", "unrecoverable"] } },
              ],
            }),
      }
    : {
        batchId,
        ...(retryFailedOnly
          ? { revertStatus: "failed" }
          : {
              OR: [
                { revertStatus: null },
                { revertStatus: { notIn: ["reverted", "unrecoverable"] } },
              ],
            }),
      };

  const baseWhere = useCampaignPath ? { shop, campaignId } : { batchId };

  const history = await prisma.priceHistory.findMany({
    where: historyWhere,
    select: {
      id: true,
      variantId: true,
      oldPrice: true,
      newPrice: true,
      productId: true,
      oldCompareAtPrice: true,
    },
  });

  if (history.length === 0) {
    const totalHistoryCount = await prisma.priceHistory.count({ where: baseWhere });
    const unrecoverableCount = await prisma.priceHistory.count({
      where: {
        ...baseWhere,
        revertStatus: "unrecoverable",
      },
    });

    if (totalHistoryCount > 0) {
      return {
        success: false,
        terminal: true,
        restoredCount: 0,
        total: 0,
        failedCount: 0,
        unrecoverableCount,
        message:
          unrecoverableCount > 0
            ? "This campaign can no longer be reverted."
            : "No retryable revert actions remain.",
        results: [],
      };
    }

    throw new Error(useCampaignPath ? "No history found for this campaign" : "No history found for this batch");
  }

  // Pre-fetch live Shopify prices for drift detection and compareAtPrice restore
  const uniqueVariantGids = Array.from(
    new Set(history.map((record) => toVariantGid(record.variantId)))
  );
  const livePricesMap = await fetchLiveVariantPrices(admin, uniqueVariantGids);

  const mutation = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          compareAtPrice
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const results: RevertResultRow[] = [];

  for (const record of history as HistoryRecord[]) {
    const variantGid = toVariantGid(record.variantId);
    const liveVariant = livePricesMap.get(variantGid);

    let currentPrice: number;
    let fallbackToLevel1 = false;

    if (!liveVariant || Number.isNaN(liveVariant.price)) {
      console.warn(
        `[REVERT] ⚠️ Live price not found for variant ${record.variantId} (${variantGid}), falling back to Level 1 restore behavior`
      );
      fallbackToLevel1 = true;
      currentPrice = record.oldPrice;
    } else {
      currentPrice = liveVariant.price;
    }

    const campaignPrice =
      record.newPrice != null && Number.isFinite(record.newPrice)
        ? Number(record.newPrice)
        : null;

    const decision = fallbackToLevel1
      ? { action: "restore" as const, reason: "live_price_fetch_fallback" }
      : decideRestore(record.oldPrice, campaignPrice, currentPrice);

    console.log("[REVERT] variant decision", {
      variantId: record.variantId,
      action: decision.action,
      reason: decision.reason,
      oldPrice: record.oldPrice,
      campaignPrice,
      currentPrice: fallbackToLevel1 ? null : currentPrice,
    });

    if (decision.action === "skip") {
      results.push({
        id: record.id,
        variantId: record.variantId,
        success: true,
      });
      continue;
    }

    if (decision.action === "flag") {
      const driftReason = `Price drift detected. Expected ${campaignPrice}, found ${currentPrice}. Manual review required.`;
      results.push({
        id: record.id,
        variantId: record.variantId,
        success: false,
        error: driftReason,
      });
      continue;
    }

    // action is "restore"
    try {
      let productId = record.productId || liveVariant?.productId;
      if (!productId) {
        const variantQuery = await admin.graphql(`
          {
            productVariant(id: "${variantGid}") {
              product {
                id
              }
            }
          }
        `);

        const variantData = await variantQuery.json();
        productId = variantData?.data?.productVariant?.product?.id;
      }

      if (!productId) {
        const reason = "Product resource is no longer accessible";
        results.push({
          id: record.id,
          variantId: record.variantId,
          success: false,
          error: reason,
          unrecoverableReason: reason,
        });
        continue;
      }

      const hasOldCompareAtPrice =
        record.oldCompareAtPrice != null &&
        Number.isFinite(record.oldCompareAtPrice);

      if (!hasOldCompareAtPrice) {
        console.log("[REVERT] compareAtPrice not available — price only restored");
      }

      const variantInput: {
        id: string;
        price: string;
        compareAtPrice?: string | null;
      } = {
        id: variantGid,
        price: record.oldPrice.toFixed(2),
      };

      if (hasOldCompareAtPrice) {
        variantInput.compareAtPrice = Number(record.oldCompareAtPrice).toFixed(2);
      }

      const response = await admin.graphql(mutation, {
        variables: {
          productId,
          variants: [variantInput],
        },
      });

      const data = await response.json();
      const userErrors = data?.data?.productVariantsBulkUpdate?.userErrors;

      if (userErrors && userErrors.length > 0) {
        const rawError = userErrors[0].message;
        const unrecoverableReason = classifyUnrecoverableReason(rawError);
        results.push({
          id: record.id,
          variantId: record.variantId,
          success: false,
          error: rawError,
          unrecoverableReason: unrecoverableReason ?? undefined,
        });
      } else {
        results.push({
          id: record.id,
          variantId: record.variantId,
          success: true,
        });
      }
    } catch (error: any) {
      const unrecoverableReason = classifyUnrecoverableReason(error.message);
      results.push({
        id: record.id,
        variantId: record.variantId,
        success: false,
        error: error.message,
        unrecoverableReason: unrecoverableReason ?? undefined,
      });
    }
  }

  const successCount = results.filter((row) => row.success).length;
  const failCount = results.length - successCount;
  const successfulHistoryIds = results.filter((row) => row.success).map((row) => row.id);
  const unrecoverableByHistoryId = new Map<string, string>();
  for (const row of results) {
    if (row.unrecoverableReason) {
      unrecoverableByHistoryId.set(row.id, row.unrecoverableReason);
    }
  }
  const unrecoverableHistoryIds = [...unrecoverableByHistoryId.keys()];
  const failedResults = results.filter(
    (row) => !row.success && !unrecoverableByHistoryId.has(row.id)
  );
  const failedHistoryIds = failedResults.map((row) => row.id);

  if (successfulHistoryIds.length > 0) {
    await prisma.priceHistory.updateMany({
      where: { id: { in: successfulHistoryIds } },
      data: {
        revertStatus: "reverted",
        revertedAt: new Date(),
        revertFailureReason: null,
      },
    });
  }

  for (const failedRow of failedResults) {
    const reason = failedRow.error ?? "Failed to revert price";
    try {
      await prisma.priceHistory.update({
        where: { id: failedRow.id },
        data: {
          revertStatus: "failed",
          revertFailureReason: reason,
        },
      });
    } catch {
      await prisma.priceHistory.updateMany({
        where: { id: failedRow.id },
        data: { revertStatus: "failed" },
      });
    }
  }

  for (const historyId of unrecoverableHistoryIds) {
    const reason = unrecoverableByHistoryId.get(historyId) ?? "Shopify resource not found";
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "PriceHistory"
         SET "revertStatus" = $1,
             "revertFailureReason" = $2
         WHERE "id" = $3`,
        "unrecoverable",
        reason,
        historyId
      );
    } catch {
      await prisma.priceHistory.updateMany({
        where: { id: historyId },
        data: { revertStatus: "unrecoverable" },
      });
    }
  }

  if (campaignId && (successCount > 0 || unrecoverableHistoryIds.length > 0 || failedHistoryIds.length > 0)) {
    const nextCampaignStatus =
      unrecoverableHistoryIds.length > 0 && failedHistoryIds.length === 0 && successCount === 0
        ? "unrecoverable"
        : failCount > 0
          ? "partial"
          : successCampaignStatus;

    await prisma.campaign.updateMany({
      where: { id: campaignId, shop },
      data: { status: nextCampaignStatus },
    });
  }

  return {
    success: successCount > 0,
    terminal: false,
    restoredCount: successCount,
    total: history.length,
    failedCount: failedHistoryIds.length,
    unrecoverableCount: unrecoverableHistoryIds.length,
    results,
    message:
      successCount > 0 && unrecoverableHistoryIds.length > 0
        ? `${successCount} products reverted. ${unrecoverableHistoryIds.length} product${
            unrecoverableHistoryIds.length === 1 ? "" : "s"
          } could not be reverted.`
        : null,
  };
}
