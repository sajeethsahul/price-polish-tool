import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";
import { cors, handlePreflight } from "../utils/cors";

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
        const { batchId } = body;

        if (!batchId) {
            console.warn("[UNDO] ⚠️ NO BATCH ID PROVIDED");
            return new Response(
                JSON.stringify({ error: "No batchId provided" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        console.log("[UNDO] START", { shop, batchId });

        await logActivity(shop, "UNDO_CLICKED", { batchId });

        const history = await prisma.priceHistory.findMany({
            where: { batchId },
        });

        if (history.length === 0) {
            console.warn("[UNDO] ⚠️ NO HISTORY FOUND", { batchId });

            return new Response(
                JSON.stringify({ error: "No history found for this batch" }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            );
        }

        console.log("[UNDO] HISTORY FETCHED", {
            batchId,
            count: history.length,
        });

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

        const results: Array<{ variantId: string; success: boolean; error?: string }> = [];

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
                    console.error("[UNDO] PRODUCT NOT FOUND", {
                        variantId: record.variantId,
                    });

                    results.push({
                        variantId: record.variantId,
                        success: false,
                        error: "Product not found",
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
                    console.error("[UNDO] GRAPHQL ERROR", {
                        variantId: record.variantId,
                        error: userErrors[0].message,
                    });

                    results.push({
                        variantId: record.variantId,
                        success: false,
                        error: userErrors[0].message,
                    });
                } else {
                    results.push({
                        variantId: record.variantId,
                        success: true,
                    });
                }

            } catch (error: any) {
                console.error("[UNDO] REQUEST ERROR", {
                    variantId: record.variantId,
                    error: error.message,
                });

                results.push({
                    variantId: record.variantId,
                    success: false,
                    error: error.message,
                });
            }
        }

        const successCount = results.filter((r) => r.success).length;

        console.log("[UNDO] COMPLETE", {
            shop,
            batchId,
            successCount,
            total: history.length,
        });

        // Delete history if fully restored
        if (successCount === history.length) {
            await prisma.priceHistory.deleteMany({
                where: { batchId },
            });

            console.log("[UNDO] HISTORY CLEANED", { batchId });
        }

        await logActivity(shop, "UNDO_SUCCESS", {
            successCount,
            total: history.length,
        });

        return cors(new Response(
            JSON.stringify({
                success: successCount > 0,
                restoredCount: successCount,
                total: history.length,
                results,
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