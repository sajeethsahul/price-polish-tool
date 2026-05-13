import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";
import { cors, handlePreflight } from "../utils/cors";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  return cors(
    new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await authenticate.admin(request);

  if (!auth?.session || !auth?.admin) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const { session, admin } = auth;
  const shop = session.shop;

  try {
    const body = await request.json().catch(() => ({}));
    console.log("BODY RECEIVED:", body);
    const clear = body.clear === true;
    const normalizeId = (id: unknown) => String(id ?? "").split("/").pop() ?? "";
    const manualVariantIds = Array.isArray(body.manualVariantIds) ? body.manualVariantIds : [];
    const manualVariantIdSet = new Set<string>(manualVariantIds.map(normalizeId));


    

    // ============================
    // 🛑 STOP LIVE (REVERT)
    // ============================
    // if (clear) {
    //   const lastBatch = await prisma.priceHistory.findFirst({
    //     where: { shop },
    //     orderBy: { createdAt: "desc" },
    //   });

    //   if (!lastBatch) {
    //     return cors(
    //       new Response(JSON.stringify({ error: "No previous price history found." }), {
    //         status: 400,
    //         headers: { "Content-Type": "application/json" },
    //       })
    //     );
    //   }

    //   const records = await prisma.priceHistory.findMany({
    //     where: { batchId: lastBatch.batchId },
    //   });

    //   let revertedCount = 0;

    //   for (const item of records) {
    //     try {
    //             const response = await admin.graphql(`
    //               mutation productVariantsBulkUpdate(
    //                 $productId: ID!,
    //                 $variants: [ProductVariantsBulkInput!]!
    //               ) {
    //                 productVariantsBulkUpdate(
    //                   productId: $productId,
    //                   variants: $variants
    //                 ) {
    //                   product {
    //                     id
    //                   }
    //                   productVariants {
    //                     id
    //                     price
    //                   }
    //                   userErrors {
    //                     field
    //                     message
    //                   }
    //                 }
    //               }
    //             `, {
    //               variables: {
    //                 productId:  item.productId,
    //                 variants: [
    //                   {
    //                     id: item.variantId,
    //                     price: String(item.oldPrice),
    //                   },
    //                 ],
    //               },
    //             });

    //       const result = await response.json();
    //       const userErrors = result?.data?.productVariantsBulkUpdate?.userErrors;

    //       if (userErrors?.length) {
    //         console.error("❌ Revert error:", item.variantId, userErrors);
    //         continue;
    //       }

    //       revertedCount++;
    //     } catch (err) {
    //       console.error("❌ Revert failed:", item.variantId);
    //     }
    //   }

    //   await prisma.appState.upsert({
    //     where: { shop },
    //     update: { isLive: false },
    //     create: { shop, isLive: false },
    //   });

    //   await logActivity(shop, "STOP_LIVE");

    //   return cors(
    //     new Response(JSON.stringify({
    //       success: true,
    //       reverted: revertedCount,
    //     }), {
    //       headers: { "Content-Type": "application/json" },
    //     })
    //   );
    // }

    if (clear) {
      await prisma.appState.upsert({
        where: { shop },
        update: { isLive: false },
        create: { shop, isLive: false },
      });

      return cors(
        new Response(
          JSON.stringify({
            success: true,
            message: "Live storefront pricing disabled.",
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }

    // ============================
    // 🔍 READ STAGED PRICES
    // ============================
    const staged = await prisma.stagedPrice.findMany({
      where: { shop },
    });

    if (!staged.length) {
      return cors(
        new Response(JSON.stringify({
          success: false,
          message: "No staged prices found. Click Apply before going live.",
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    const batchId = `batch_${Date.now()}`;

    let successCount = 0;
    let failCount = 0;
    const failedItems: string[] = [];

    // 🔥 CREATE JOB
    const job = await prisma.pushJob.create({
      data: {
        shop,
        total: staged.length,
      },
    });

    // ============================
    // 🚀 PUSH TO SHOPIFY
    // ============================
    for (const item of staged) {
      try {
        const price = Number(item.stagedPrice);

        // ✅ Validate price
        if (!price || isNaN(price) || price <= 0) {
          console.error("❌ Invalid price:", item);
          failCount++;
          failedItems.push(item.variantId);
          continue;
        }

        const response = await admin.graphql(`
          mutation productVariantsBulkUpdate(
            $productId: ID!,
            $variants: [ProductVariantsBulkInput!]!
          ) {
            productVariantsBulkUpdate(
              productId: $productId,
              variants: $variants
            ) {
              product {
                id
              }
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
        `, {
          variables: {
            productId: item.productId,
            variants: [
              {
                id: item.variantId.startsWith("gid://")
                  ? item.variantId
                  : `gid://shopify/ProductVariant/${item.variantId}`,
                price: String(price),
              },
            ],
          },
        });

        const result = await response.json();

        const userErrors = result?.data?.productVariantsBulkUpdate?.userErrors;

        if (userErrors?.length) {
          console.error("❌ USER ERROR:", item.variantId, userErrors);
          failCount++;
          failedItems.push(item.variantId);
          continue;
        }

        // ✅ Save history ONLY on success
        await prisma.priceHistory.create({
          data: {
            shop,
            productId: item.productId,
            variantId: item.variantId,
            oldPrice: item.originalPrice,
            newPrice: item.stagedPrice,
            isManual: manualVariantIdSet.has(normalizeId(item.variantId)),
            batchId,
          },
        });

        successCount++;

      } catch (err) {
        console.error("❌ Push failed:", item.variantId, err);
        failCount++;
        failedItems.push(item.variantId);
      }

      // 🔥 UPDATE PROGRESS
      await prisma.pushJob.update({
        where: { id: job.id },
        data: {
          processed: { increment: 1 },
          success: successCount,
          failed: failCount,
        },
      });
    }

    // ✅ Mark job complete
    await prisma.pushJob.update({
      where: { id: job.id },
      data: { status: "done" },
    });

    // ============================
    // 🔥 MARK LIVE
    // ============================
    await prisma.appState.upsert({
      where: { shop },
      update: { isLive: true },
      create: { shop, isLive: true },
    });

    // FIX 5: Clear staged prices now that they have been published to Shopify.
    // Only runs when at least one variant succeeded — PriceHistory is the rollback
    // mechanism from this point on. If every variant failed, staged data is preserved
    // so the user can retry Go Live without re-applying.
    if (successCount > 0) {
      await prisma.stagedPrice.deleteMany({ where: { shop } });
      console.log(`✅ StagedPrice cleared for shop ${shop} after successful Go Live (${successCount} applied)`);
    }

    await logActivity(shop, "GO_LIVE", {
      successCount,
      failCount,
    });

    return cors(
      new Response(JSON.stringify({
        success: true,
        applied: successCount,
        failed: failCount,
        failedItems,
        jobId: job.id,
      }), {
        headers: { "Content-Type": "application/json" },
      })
    );

  } catch (error: any) {
    console.error("❌ PUSH STORE ERROR:", error);

    await logActivity(shop, "ERROR", {
      action: "PUSH_STOREFRONT",
      message: error.message,
    });

    return cors(
      new Response(JSON.stringify({
        error: "Failed to push prices to storefront.",
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
  }
};
