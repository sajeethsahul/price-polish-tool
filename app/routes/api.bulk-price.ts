import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";
import { cors, handlePreflight } from "../utils/cors";

const BATCH_SIZE = 50;
const DELAY_MS = 300;

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

    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    try {
        const body = await request.json();
        interface UpdateItem { productId: string; variantId: string; oldPrice: string; newPrice: string; isManual?: boolean };
        const items: UpdateItem[] = body.items;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return cors(new Response(
                JSON.stringify({ success: false, error: "No items provided" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            ));
        }

        const batchId = crypto.randomUUID();
        let successCount = 0;
        let failedCount = 0;
        const failedItems: any[] = [];

        // 1. Save to PriceHistory (Bulk creation)
        await prisma.priceHistory.createMany({
            data: items.map((item) => ({
                shop: session.shop,
                variantId: item.variantId,
                oldPrice: parseFloat(item.oldPrice),
                newPrice: parseFloat(item.newPrice),
                isManual: item.isManual || false,
                batchId,
            })),
        });

        // 🚀 OPTIMIZATION: Group by productId
        const productGroups: Record<string, typeof items> = {};
        items.forEach((item) => {
            if (!item.productId) return;
            if (!productGroups[item.productId]) productGroups[item.productId] = [];
            productGroups[item.productId].push(item);
        });

        const mutation = `
            mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                    userErrors { field message }
                }
            }
        `;

        // 2. Process each product group
        const groupEntries = Object.entries(productGroups);
        for (let i = 0; i < groupEntries.length; i += 10) { // Cluster groups for rate limit safety
            const currentBatch = groupEntries.slice(i, i + 10);
            
            await Promise.all(currentBatch.map(async ([productId, variants]) => {
                try {
                    const response = await admin.graphql(mutation, {
                        variables: {
                            productId,
                            variants: variants.map(v => ({ id: v.variantId, price: v.newPrice })),
                        },
                    });

                    const data: any = await response.json();
                    const userErrors = data.data?.productVariantsBulkUpdate?.userErrors || [];

                    if (userErrors.length > 0) {
                        failedCount += variants.length;
                        failedItems.push(...variants.map(v => ({ variantId: v.variantId, error: userErrors[0].message })));
                    } else {
                        successCount += variants.length;
                    }
                } catch (error: any) {
                    failedCount += variants.length;
                    failedItems.push(...variants.map(v => ({ variantId: v.variantId, error: error.message })));
                }
            }));

            // Throttle between batches of products
            if (i + 10 < groupEntries.length) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }

        const status = failedCount === 0 ? "BULK_SUCCESS" : (successCount > 0 ? "BULK_PARTIAL_FAILURE" : "BULK_TOTAL_FAILURE");
        await logActivity(shop, status, { successCount, failedCount, total: items.length });

        return cors(new Response(
            JSON.stringify({
                success: failedCount === 0,
                successCount,
                failedCount,
                failedItems,
                total: items.length,
                batchId,
                updatedAt: new Date().toISOString(),
            }),
            { headers: { "Content-Type": "application/json" } },
        ));
    } catch (error: any) {
        await logActivity(shop, "ERROR", { action: "BULK_PRICE", message: error.message });
        return cors(new Response(
            JSON.stringify({ success: false, error: "Something went wrong during bulk update" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        ));
    }
};
