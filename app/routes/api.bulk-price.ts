import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";
import { cors, handlePreflight } from "../utils/cors";
import { applyLocaleFromSession, t } from "../utils/i18n";
import { parseShopifyPrice } from "../utils/price-utils";

const BATCH_SIZE = 50;
const DELAY_MS = 300;

// ================= LOADER =================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  return cors(
    new Response(JSON.stringify({ error: t("server.methodNotAllowed") }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  );
};


// ================= ACTION =================

export const action = async ({ request }: ActionFunctionArgs) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // 🔐 AUTH
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  const { admin, session } = auth;
  const shop = session.shop;

  const sub = await prisma.subscription.findFirst({
    where: { shop },
    select: { status: true, plan: true },
  });

  const activeStates = ["ACTIVE", "PENDING", "active", "trialing", "free"];
  const isActive = sub && activeStates.includes(sub.status);

  if (!isActive) {
    return cors(
      new Response(
        JSON.stringify({ error: "Subscription required. Restore your subscription to continue." }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }

  // Free plan limit check — enforcement pending (post-beta)
  const plan = sub?.plan ?? "free";
  if (plan === "free") {
    console.log("[BILLING] Free plan limit check — enforcement pending", {
      shop, action: "bulk_price"
    });
    // TODO: enforce productsPerCampaign: 50 limit after beta
  }

  applyLocaleFromSession(session);

  console.log("[BULK] SESSION", { shop });

  // ================= MAIN LOGIC =================
  try {
    const body = await request.json();
    const items = body.items;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return cors(
        new Response(
          JSON.stringify({ success: false, error: t("server.noItemsProvided") }),
          { status: 400 }
        )
      );
    }

    const batchId = crypto.randomUUID();
    let successCount = 0;
    let failedCount = 0;
    const failedItems: any[] = [];

    // ================= SAVE HISTORY =================
    await prisma.priceHistory.createMany({
      data: items.map((item: any) => ({
        shop,
        productId: item.productId ?? null,
        variantId: item.variantId,
        oldPrice: parseShopifyPrice(item.oldPrice),
        oldCompareAtPrice: item.compareAtPrice
          ? parseShopifyPrice(item.compareAtPrice)
          : null,
        newPrice: parseShopifyPrice(item.newPrice),
        isManual: item.isManual || false,
        batchId,
      })),
    });

    // ================= GROUP PRODUCTS =================
    const productGroups: Record<string, any[]> = {};

    items.forEach((item: any) => {
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

    const groupEntries = Object.entries(productGroups);

    for (let i = 0; i < groupEntries.length; i += 10) {
      const currentBatch = groupEntries.slice(i, i + 10);

      await Promise.all(
        currentBatch.map(async ([productId, variants]) => {
          try {
            const response = await admin.graphql(mutation, {
              variables: {
                productId,
                variants: (variants as any[]).map((v) => ({
                  id: v.variantId,
                  price: v.newPrice,
                })),
              },
            });

            const data: any = await response.json();
            const userErrors =
              data.data?.productVariantsBulkUpdate?.userErrors || [];

            if (userErrors.length > 0) {
              failedCount += (variants as any[]).length;

              failedItems.push(
                ...(variants as any[]).map((v) => ({
                  variantId: v.variantId,
                  error: userErrors[0].message,
                }))
              );
            } else {
              successCount += (variants as any[]).length;
            }
          } catch (error: any) {
            failedCount += (variants as any[]).length;

            failedItems.push(
              ...(variants as any[]).map((v) => ({
                variantId: v.variantId,
                error: error.message,
              }))
            );
          }
        })
      );

      if (i + 10 < groupEntries.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    const status =
      failedCount === 0
        ? "BULK_SUCCESS"
        : successCount > 0
        ? "BULK_PARTIAL_FAILURE"
        : "BULK_TOTAL_FAILURE";

    await logActivity(shop, status, {
      successCount,
      failedCount,
      total: items.length,
    });

    return cors(
      new Response(
        JSON.stringify({
          success: failedCount === 0,
          successCount,
          failedCount,
          failedItems,
          total: items.length,
          batchId,
          updatedAt: new Date().toISOString(),
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
  } catch (error: any) {
    console.error("[BULK] FATAL ERROR", error);

    await logActivity(shop, "ERROR", {
      action: "BULK_PRICE",
      message: error.message,
    });

    return cors(
      new Response(
        JSON.stringify({
          success: false,
          error: t("server.bulkUpdateFailed"),
        }),
        { status: 500 }
      )
    );
  }
};