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
        const items: Array<{ variantId: string; oldPrice: string; newPrice: string; isManual?: boolean }> = body.items;
        const isAll = body.isAll || false;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return new Response(
                JSON.stringify({ success: false, error: "No items provided" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        await logActivity(shop, isAll ? "APPLY_ALL" : "APPLY_SELECTED", { count: items.length });

        const batchId = crypto.randomUUID();
        const results: Array<{ variantId: string; success: boolean; error?: string }> = [];
        let successCount = 0;
        let failedCount = 0;
        const failedItems: Array<{ variantId: string; error: string }> = [];

        // 1. Save to PriceHistory (Bulk creation)
        await prisma.priceHistory.createMany({
            data: items.map((item) => ({
                shop: session.shop,
                variantId: item.variantId,
                oldPrice: parseFloat(item.oldPrice),
                newPrice: parseFloat(item.newPrice),
                isManual: item.isManual || false, // NEW
                batchId,
            })),
        });

        const mutation = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

        // 2. Process in batches to handle rate limits and timeouts
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);

            for (const item of batch) {
                try {
                    const variantQuery = await admin.graphql(`
                    {
                      productVariant(id: "${item.variantId}") {
                        product {
                          id
                        }
                      }
                    }
                `);

                    const variantData = await variantQuery.json();
                    const productId = variantData.data?.productVariant?.product?.id;

                    if (!productId) {
                        throw new Error("Product ID not found for variant");
                    }

                    const response = await admin.graphql(mutation, {
                        variables: {
                            productId,
                            variants: [{ id: item.variantId, price: item.newPrice }],
                        },
                    });

                    const data = await response.json();
                    const userErrors = data.data?.productVariantsBulkUpdate?.userErrors;

                    if (userErrors && userErrors.length > 0) {
                        failedCount++;
                        failedItems.push({ variantId: item.variantId, error: userErrors[0].message });
                        results.push({ variantId: item.variantId, success: false, error: userErrors[0].message });
                    } else {
                        successCount++;
                        results.push({ variantId: item.variantId, success: true });
                    }
                } catch (error) {
                    failedCount++;
                    const errorMsg = error instanceof Error ? error.message : "Unknown error";
                    failedItems.push({ variantId: item.variantId, error: errorMsg });
                    results.push({ variantId: item.variantId, success: false, error: errorMsg });
                }
            }

            // Delay between batches to stay safe with rate limits
            if (i + BATCH_SIZE < items.length) {
                await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
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
