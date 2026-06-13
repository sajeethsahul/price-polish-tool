import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cors, handlePreflight } from "../utils/cors";
import { logActivity } from "../utils/activity.server";
import { requireActiveBilling } from "../utils/billing-protection.server";

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

  try {
    const body = await request.json();
    const { failedItems } = body;

    if (!failedItems || !Array.isArray(failedItems)) {
      return cors(new Response(JSON.stringify({
        error: "Invalid failedItems"
      }), { status: 400 }));
    }

    // 🔥 get staged data for those variants
    const staged = await prisma.stagedPrice.findMany({
      where: {
        shop,
        variantId: { in: failedItems },
      },
    });

    let success = 0;
    let failed = 0;
    const stillFailed: string[] = [];

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

        success++;
      } catch (err) {
        failed++;
        stillFailed.push(item.variantId);
      }
    }

    await logActivity(shop, "RETRY_FAILED", {
      success,
      failed,
    });

    return cors(new Response(JSON.stringify({
      success: true,
      retried: success,
      stillFailed,
    })));

  } catch (error: any) {
    return cors(new Response(JSON.stringify({
      error: "Retry failed",
    }), { status: 500 }));
  }
};