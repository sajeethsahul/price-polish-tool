import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";
import { cors, handlePreflight } from "../utils/cors";
import { requireActiveBilling } from "../utils/billing-protection.server";
import { withShopifyRetry } from "../utils/shopify-graphql.server";

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

  const billingError = await requireActiveBilling(shop);
  if (billingError) return cors(new Response(JSON.stringify(billingError), { status: 403, headers: { "Content-Type": "application/json" } }));

  let activeJobId: string | undefined;

  try {
    const publishStartMs = Date.now();
    const body = await request.json().catch(() => ({}));
    const clear = body.clear === true;
    const normalizeId = (id: unknown) => String(id ?? "").split("/").pop() ?? "";
    const manualVariantIds = Array.isArray(body.manualVariantIds) ? body.manualVariantIds : [];
    const manualVariantIdSet = new Set<string>(manualVariantIds.map(normalizeId));
    const campaignId =
      typeof body.campaignId === "string" && body.campaignId.length > 0
        ? body.campaignId
        : undefined;
    const stagedWhere = campaignId ? { shop, campaignId } : { shop };
    // Optional batch limit for client-driven progress tracking.
    // When omitted (or 0), all staged prices are processed in one pass (existing behaviour).
    const batchLimit =
      typeof body.limit === "number" && body.limit > 0 ? body.limit : undefined;
    // Client-generated identifier that groups all batches of one logical publish operation.
    // Null for legacy single-shot calls (no grouping needed).
    const operationId =
      typeof body.operationId === "string" && body.operationId.length > 0
        ? body.operationId
        : null;


    

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
      where: stagedWhere,
      ...(batchLimit != null ? { take: batchLimit } : {}),
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

    let effectiveCampaignId = campaignId;
    if (!campaignId) {
      const stagedCampaignIds = [...new Set(
        staged
          .map((item) => item.campaignId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )];

      if (stagedCampaignIds.length === 1) {
        effectiveCampaignId = stagedCampaignIds[0];
        console.log("[PUBLISH] campaign.recovered", {
          shop,
          campaignId: effectiveCampaignId,
          source: "staged-price",
        });
      } else if (stagedCampaignIds.length > 1) {
        console.warn("[PUBLISH] campaign.recovery.failed", {
          shop,
          campaignCount: stagedCampaignIds.length,
        });
        return cors(
          new Response(JSON.stringify({
            success: false,
            error: "Multiple staged campaigns detected. Publish one campaign at a time.",
          }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
    }

    const batchId = `batch_${Date.now()}`;

    // ============================
    // 🔒 CONCURRENCY GUARD
    // ============================
    // Prevent two publish requests from running simultaneously for the same
    // shop. Jobs stuck in "running" for more than 10 minutes are considered
    // abandoned (server crash / timeout) and are allowed to be superseded.
    const STUCK_JOB_TIMEOUT_MS = 10 * 60 * 1000;
    const stuckCutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);
    const runningJob = await prisma.pushJob.findFirst({
      where: { shop, status: "running", createdAt: { gt: stuckCutoff } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (runningJob) {
      console.warn("[PUBLISH] publish.duplicate", { shop, runningJobId: runningJob.id, campaignId });
      return cors(
        new Response(JSON.stringify({
          error: "A publish is already in progress. Please wait for it to complete.",
          jobId: runningJob.id,
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    let successCount = 0;
    let failCount = 0;
    const failedItems: string[] = [];
    let historyLineageLogged = false;

    // 🔥 CREATE JOB
    const job = await prisma.pushJob.create({
      data: {
        shop,
        total: staged.length,
        ...(operationId != null ? { operationId } : {}),
      },
    });
    activeJobId = job.id;

    console.log("[PUBLISH] publish.started", { shop, itemCount: staged.length, campaignId });

    // ============================
    // 🚀 PUSH TO SHOPIFY
    // ============================
    for (const item of staged) {
      try {
        const price = Number(item.stagedPrice);

        // ✅ Validate price
        if (!price || isNaN(price) || price <= 0) {
          failCount++;
          failedItems.push(item.variantId);
          continue;
        }
        const formattedPrice = price.toFixed(2);
        const response = await withShopifyRetry(
          () => admin.graphql(`
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
                  price: String(formattedPrice),
                },
              ],
            },
          }),
          "push-storefront"
        );

        const result = await response.json();

        //console.log( 'SAJEETH_TEST_PRICE_POLICE', JSON.stringify(result.data.productVariantsBulkUpdate.productVariants, null, 2));


        const userErrors = result?.data?.productVariantsBulkUpdate?.userErrors;

        if (userErrors?.length) {
          failCount++;
          failedItems.push(item.variantId);
          continue;
        }

        // ✅ Save history ONLY on success
        await prisma.priceHistory.create({
          data: {
            shop,
            campaignId: effectiveCampaignId,
            productId: item.productId,
            variantId: item.variantId,
            oldPrice: item.originalPrice,
            newPrice: item.stagedPrice,
            isManual: manualVariantIdSet.has(normalizeId(item.variantId)),
            batchId,
          },
        });

        if (!historyLineageLogged) {
          historyLineageLogged = true;
        }

        // Remove the staged record immediately after Shopify confirms the
        // price update. Failed records are left untouched so the next publish
        // request processes only the remaining failures — no re-staging needed.
        await prisma.stagedPrice.delete({ where: { id: item.id } });
        successCount++;

      } catch (err) {
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

    // Count remaining staged prices so the client knows whether to continue batching.
    // Computed before the success block so we can gate GO_LIVE on the final batch.
    // Fast COUNT — accurate because successful items were deleted per-item during the loop.
    const remaining = await prisma.stagedPrice.count({ where: stagedWhere });

    // ============================
    // 🔥 MARK LIVE — only when at least one variant was actually updated
    // ============================
    if (successCount > 0) {
      await prisma.appState.upsert({
        where: { shop },
        update: { isLive: true },
        create: { shop, isLive: true },
      });

      // Staged prices for successful variants were already deleted individually
      // during the push loop. Any remaining StagedPrice rows are failures that
      // the merchant can retry without re-staging.

      // GO_LIVE is logged only on the final batch of a publish operation
      // (remaining === 0 means no more staged items exist). This prevents one
      // logical merchant action from creating multiple ActivityLog entries when
      // the client drives publishing via multiple batched requests.
      if (remaining === 0) {
        console.log("[PUBLISH] publish.completed", { shop, successCount, failCount, campaignId, operationId, durationMs: Date.now() - publishStartMs });
        await logActivity(shop, "GO_LIVE", {
          successCount,
          failCount,
          ...(operationId != null ? { operationId } : {}),
        });
      }

      const state = await prisma.appState.findUnique({
        where: { shop },
        select: { onboardingFirstApplyAt: true },
      });
      if (!state?.onboardingFirstApplyAt) {
        await prisma.appState.upsert({
          where: { shop },
          update: { onboardingFirstApplyAt: new Date() },
          create: { shop, isLive: true, onboardingFirstApplyAt: new Date() },
        });
      }
    }

    return cors(
      new Response(JSON.stringify({
        success: true,
        applied: successCount,
        failed: failCount,
        failedItems,
        jobId: job.id,
        remaining,
      }), {
        headers: { "Content-Type": "application/json" },
      })
    );

  } catch (error: any) {
    // Mark the job as failed so the concurrency guard does not permanently
    // block future publishes if the server crashed mid-loop.
    if (activeJobId) {
      await prisma.pushJob.update({
        where: { id: activeJobId },
        data: { status: "failed" },
      }).catch(() => {});
    }

    console.error("[PUBLISH] publish.failed", { shop, error: error?.message ?? "unknown" });

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
