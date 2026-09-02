import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log("[WEBHOOK] APP_SUBSCRIPTIONS_UPDATE received", {
    shop,
    topic,
    status: (payload as any)?.app_subscription?.status,
  });

  const status: string | undefined = (payload as any)?.app_subscription?.status;

  if (!status || !shop) {
    console.warn("[WEBHOOK] Missing shop or status in payload", { shop, payload });
    return new Response("Bad Request", { status: 400 });
  }

  try {
    // Sync subscription status to local DB
    await prisma.subscription.updateMany({
      where: { shop },
      data: {
        status: status,
        updatedAt: new Date(),
      },
    });

    console.log("[WEBHOOK] Subscription status synced", { shop, status });

    // If cancelled/expired/frozen: pause all pending scheduled jobs
    const inactiveStates = ["CANCELLED", "DECLINED", "EXPIRED", "FROZEN"];

    if (inactiveStates.includes(status)) {
      const pauseResult = await (prisma.scheduledJob as any).updateMany({
        where: {
          shop,
          status: "pending",
        },
        data: {
          status: "paused-billing-inactive",
        },
      });

      console.log("[WEBHOOK] Pending jobs paused — billing inactive", {
        shop,
        status,
        pausedCount: pauseResult.count,
      });
    }

    // If reactivated: restore paused jobs back to pending
    if (status === "ACTIVE") {
      const restoreResult = await (prisma.scheduledJob as any).updateMany({
        where: {
          shop,
          status: "paused-billing-inactive",
        },
        data: {
          status: "pending",
        },
      });

      console.log("[WEBHOOK] Paused jobs restored — billing reactivated", {
        shop,
        restoredCount: restoreResult.count,
      });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[WEBHOOK] APP_SUBSCRIPTIONS_UPDATE handler failed", {
      shop,
      error,
    });
    return new Response("Internal Server Error", { status: 500 });
  }
};
