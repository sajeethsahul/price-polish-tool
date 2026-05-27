import prisma from "../db.server";

type HistoryRecord = {
  id: string;
  variantId: string;
  oldPrice: number;
};

type RevertResultRow = {
  id: string;
  variantId: string;
  success: boolean;
  error?: string;
  unrecoverableReason?: string;
};

type RevertCampaignPricesOptions = {
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

  const mutation = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const results: RevertResultRow[] = [];

  for (const record of history as HistoryRecord[]) {
    try {
      const variantQuery = await admin.graphql(`
        {
          productVariant(id: "${toVariantGid(record.variantId)}") {
            product {
              id
            }
          }
        }
      `);

      const variantData = await variantQuery.json();
      const productId = variantData.data.productVariant?.product?.id;

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

      const response = await admin.graphql(mutation, {
        variables: {
          productId,
          variants: [{
            id: toVariantGid(record.variantId),
            price: record.oldPrice.toFixed(2),
          }],
        },
      });

      const data = await response.json();
      const userErrors = data.data.productVariantsBulkUpdate.userErrors;

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
  const failedHistoryIds = results
    .filter((row) => !row.success && !unrecoverableByHistoryId.has(row.id))
    .map((row) => row.id);

  if (successfulHistoryIds.length > 0) {
    await prisma.priceHistory.updateMany({
      where: { id: { in: successfulHistoryIds } },
      data: {
        revertStatus: "reverted",
        revertedAt: new Date(),
      },
    });
  }

  if (failedHistoryIds.length > 0) {
    await prisma.priceHistory.updateMany({
      where: { id: { in: failedHistoryIds } },
      data: { revertStatus: "failed" },
    });
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

  if (campaignId && (successCount > 0 || unrecoverableHistoryIds.length > 0)) {
    const nextCampaignStatus =
      unrecoverableHistoryIds.length > 0 && failedHistoryIds.length === 0
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
