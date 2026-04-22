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
    const clear = body.clear === true;

    // ============================
    // 🛑 STOP LIVE (REVERT)
    // ============================
    if (clear) {
      const lastBatch = await prisma.priceHistory.findFirst({
        where: { shop },
        orderBy: { createdAt: "desc" },
      });

      if (!lastBatch) {
        return cors(
          new Response(JSON.stringify({ error: "No history found" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      const records = await prisma.priceHistory.findMany({
        where: { batchId: lastBatch.batchId },
      });

      for (const item of records) {
        await admin.graphql(`
          mutation {
            productVariantUpdate(input: {
              id: "gid://shopify/ProductVariant/${item.variantId}",
              price: "${item.oldPrice}"
            }) {
              productVariant { id }
            }
          }
        `);
      }

      await prisma.appState.upsert({
        where: { shop },
        update: { isLive: false },
        create: { shop, isLive: false },
      });

      await logActivity(shop, "STOP_LIVE");

      return cors(
        new Response(JSON.stringify({ success: true, reverted: true }), {
          headers: { "Content-Type": "application/json" },
        })
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
          message: "No staged prices found. Click Apply first.",
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
          await admin.graphql(`
            mutation {
              productVariantUpdate(input: {
                id: "gid://shopify/ProductVariant/${item.variantId}",
                price: "${item.stagedPrice}"
              }) {
                productVariant { id }
              }
            }
          `);
      
          await prisma.priceHistory.create({
            data: {
              shop,
              variantId: item.variantId,
              oldPrice: item.originalPrice,
              newPrice: item.stagedPrice,
              batchId,
            },
          });
      
          successCount++;
        } catch (err) {
          console.error("❌ Failed:", item.variantId);
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
          jobId: job.id, // 🔥 for progress tracking
        }), {
          headers: { "Content-Type": "application/json" },
        })
      );

  } catch (error: any) {
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