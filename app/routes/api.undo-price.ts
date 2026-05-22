import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";
import { cors, handlePreflight } from "../utils/cors";

function classifyUnrecoverableReason(message: string): string | null {
    const normalized = message.toLowerCase();
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    return cors(new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
    }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const auth = await authenticate.admin(request);

    if (!auth?.session) {
        console.error("[UNDO] ❌ NO SESSION FOUND");
        throw new Response("Unauthorized", { status: 401 });
    }

    const { admin, session } = auth;
    const shop = session.shop;

    console.log("[UNDO] SESSION", { shop });

    try {
        const body = await request.json();

        const rawCampaignId = body?.campaignId;
        const campaignId = typeof rawCampaignId === "string" && rawCampaignId.length > 0
            ? rawCampaignId
            : undefined;
        const rawBatchId = body?.batchId;
        const batchId = typeof rawBatchId === "string" && rawBatchId.length > 0
            ? rawBatchId
            : undefined;
        const retryFailedOnly = body?.retryFailedOnly === true;

        if (!campaignId && !batchId) {
            console.warn("[UNDO] ⚠️ NO CAMPAIGN ID OR BATCH ID PROVIDED");
            return new Response(
                JSON.stringify({ error: "No campaignId or batchId provided" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        console.log("[UNDO] START", { shop, campaignId, batchId });
        if (retryFailedOnly) {
            console.log("[UNDO] 🔁 Retry failed revert started", { shop, campaignId, batchId });
        }

        await logActivity(shop, "UNDO_CLICKED", { campaignId, batchId });

        const useCampaignPath = Boolean(campaignId);
        if (useCampaignPath) {
            console.log("[UNDO] 🧭 Using campaign-aware revert path", { shop, campaignId });
        } else {
            console.log("[UNDO] 🧩 Using legacy batchId revert path", { batchId });
        }

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

        const baseWhere = useCampaignPath
            ? { shop, campaignId }
            : { batchId };

        const history = await prisma.priceHistory.findMany({
            where: historyWhere,
        });

        if (history.length === 0) {
            const totalHistoryCount = await prisma.priceHistory.count({
                where: baseWhere,
            });
            const unrecoverableCount = await prisma.priceHistory.count({
                where: {
                    ...baseWhere,
                    revertStatus: "unrecoverable",
                },
            });
            if (totalHistoryCount > 0) {
                if (unrecoverableCount > 0) {
                    console.log("[UNDO] ⚠️ terminal unrecoverable campaign detected", {
                        campaignId,
                        batchId,
                        unrecoverableCount,
                    });
                }
                console.log("[UNDO] ⚠️ no retryable revert rows remain", {
                    campaignId,
                    batchId,
                });
                return cors(new Response(
                    JSON.stringify({
                        success: false,
                        terminal: true,
                        restoredCount: 0,
                        total: 0,
                        failedCount: 0,
                        unrecoverableCount,
                        message: unrecoverableCount > 0
                            ? "This campaign can no longer be reverted."
                            : "No retryable revert actions remain.",
                        results: [],
                    }),
                    { headers: { "Content-Type": "application/json" } },
                ));
            }
            console.warn("[UNDO] ⚠️ NO HISTORY FOUND", { campaignId, batchId });

            return new Response(
                JSON.stringify({
                    error: useCampaignPath
                        ? "No history found for this campaign"
                        : "No history found for this batch",
                }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }

        console.log("[UNDO] HISTORY FETCHED", {
            campaignId,
            batchId,
            count: history.length,
        });
        if (retryFailedOnly) {
            console.log("[UNDO] 🔁 Retry eligible row count", {
                campaignId,
                batchId,
                eligibleCount: history.length,
            });
            const skippedUnrecoverableCount = await prisma.priceHistory.count({
                where: useCampaignPath
                    ? { shop, campaignId, revertStatus: "unrecoverable" }
                    : { batchId, revertStatus: "unrecoverable" },
            });
            if (skippedUnrecoverableCount > 0) {
                console.log("[UNDO] 🔁 Retry skipped unrecoverable rows", {
                    campaignId,
                    batchId,
                    skippedUnrecoverableCount,
                });
            }
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

        const results: Array<{
            id: string;
            variantId: string;
            success: boolean;
            error?: string;
            unrecoverableReason?: string;
        }> = [];

        for (const record of history) {
            try {
                const variantQuery = await admin.graphql(`
                {
                    productVariant(id: "${record.variantId}") {
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
                    console.warn("[UNDO] ❌ Unrecoverable revert detected", {
                        variantId: record.variantId,
                        reason,
                    });
                    console.error("[UNDO] PRODUCT NOT FOUND", {
                        variantId: record.variantId,
                    });

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
                            id: record.variantId,
                            price: record.oldPrice.toFixed(2),
                        }],
                    },
                });

                const data = await response.json();
                const userErrors = data.data.productVariantsBulkUpdate.userErrors;

                if (userErrors && userErrors.length > 0) {
                    const rawError = userErrors[0].message;
                    const unrecoverableReason = classifyUnrecoverableReason(rawError);
                    if (unrecoverableReason) {
                        console.warn("[UNDO] ❌ Unrecoverable revert detected", {
                            variantId: record.variantId,
                            reason: unrecoverableReason,
                        });
                    }
                    console.error("[UNDO] GRAPHQL ERROR", {
                        variantId: record.variantId,
                        error: rawError,
                    });

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
                if (unrecoverableReason) {
                    console.warn("[UNDO] ❌ Unrecoverable revert detected", {
                        variantId: record.variantId,
                        reason: unrecoverableReason,
                    });
                }
                console.error("[UNDO] REQUEST ERROR", {
                    variantId: record.variantId,
                    error: error.message,
                });

                results.push({
                    id: record.id,
                    variantId: record.variantId,
                    success: false,
                    error: error.message,
                    unrecoverableReason: unrecoverableReason ?? undefined,
                });
            }
        }

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.length - successCount;

        const successVariantIds = new Set(
            results.filter((r) => r.success).map((r) => r.variantId)
        );
        const failedVariantIds = new Set(
            results.filter((r) => !r.success).map((r) => r.variantId)
        );
        const unrecoverableByHistoryId = new Map<string, string>();
        for (const row of results) {
            if (row.unrecoverableReason) {
                unrecoverableByHistoryId.set(row.id, row.unrecoverableReason);
            }
        }

        const successfulHistoryIds = history
            .filter((record) => successVariantIds.has(record.variantId))
            .map((record) => record.id);
        const unrecoverableHistoryIds = history
            .filter((record) => unrecoverableByHistoryId.has(record.id))
            .map((record) => record.id);
        const failedHistoryIds = history
            .filter((record) => failedVariantIds.has(record.variantId) && !unrecoverableByHistoryId.has(record.id))
            .map((record) => record.id);

        if (successfulHistoryIds.length > 0) {
            await prisma.priceHistory.updateMany({
                where: {
                    id: { in: successfulHistoryIds },
                },
                data: {
                    revertStatus: "reverted",
                    revertedAt: new Date(),
                },
            });
        }

        if (failedHistoryIds.length > 0) {
            await prisma.priceHistory.updateMany({
                where: {
                    id: { in: failedHistoryIds },
                },
                data: {
                    revertStatus: "failed",
                },
            });
        }

        if (unrecoverableHistoryIds.length > 0) {
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
                    console.log("[UNDO] ⚠️ Unrecoverable reason persisted", {
                        historyId,
                        reason,
                    });
                } catch {
                    await prisma.priceHistory.updateMany({
                        where: { id: historyId },
                        data: { revertStatus: "unrecoverable" },
                    });
                    console.warn("[UNDO] ⚠️ Could not persist revertFailureReason (column missing). Status saved only.", {
                        historyId,
                    });
                }
            }
        }

        if (campaignId && (successCount > 0 || unrecoverableHistoryIds.length > 0)) {
            const nextCampaignStatus =
                unrecoverableHistoryIds.length > 0 && failedHistoryIds.length === 0
                    ? "unrecoverable"
                    : (failCount > 0 ? "partial" : "reverted");
            await prisma.campaign.updateMany({
                where: { id: campaignId, shop },
                data: { status: nextCampaignStatus },
            });
            console.log("[UNDO] 🏷️ Campaign status transitioned", {
                campaignId,
                status: nextCampaignStatus,
            });
        }

        console.log("[UNDO] COMPLETE", {
            shop,
            campaignId,
            batchId,
            retryFailedOnly,
            successCount,
            failCount,
            total: history.length,
        });
        if (retryFailedOnly) {
            console.log("[UNDO] 🔁 Retry success/failure counts", {
                campaignId,
                batchId,
                successCount,
                failCount,
            });
        }

        console.log("[UNDO] STATUS UPDATES APPLIED", {
            revertedRows: successfulHistoryIds.length,
            failedRows: failedHistoryIds.length,
            unrecoverableRows: unrecoverableHistoryIds.length,
            campaignId,
            batchId,
        });

        await logActivity(shop, "UNDO_SUCCESS", {
            successCount,
            total: history.length,
        });

        return cors(new Response(
            JSON.stringify({
                success: successCount > 0,
                terminal: false,
                restoredCount: successCount,
                total: history.length,
                failedCount: failedHistoryIds.length,
                unrecoverableCount: unrecoverableHistoryIds.length,
                results,
                message:
                    successCount > 0 && unrecoverableHistoryIds.length > 0
                        ? `${successCount} products reverted. ${unrecoverableHistoryIds.length} product${unrecoverableHistoryIds.length === 1 ? "" : "s"} could not be reverted.`
                        : null,
            }),
            { headers: { "Content-Type": "application/json" } },
        ));

    } catch (error: any) {
        console.error("[UNDO] FATAL ERROR", error);

        await logActivity(shop, "ERROR", {
            action: "UNDO_PRICE",
            message: error.message,
        });

        return cors(new Response(
            JSON.stringify({ error: "Something went wrong during undo" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        ));
    }
};