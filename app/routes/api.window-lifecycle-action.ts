import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";
import { revertCampaignPrices } from "../utils/revert.server";
import { resolveWindowLifecycleState } from "../utils/window-lifecycle";

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
  if (!auth?.session || !auth?.admin) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const { session, admin } = auth;
  const shop = session.shop;
  const body = await request.json().catch(() => ({}));
  const campaignId =
    typeof body?.campaignId === "string" && body.campaignId.length > 0
      ? body.campaignId
      : null;
  const requestedAction =
    body?.action === "cancel-schedule" || body?.action === "stop-window"
      ? body.action
      : null;

  if (!campaignId || !requestedAction) {
    return cors(new Response(JSON.stringify({ error: "Choose a valid window action." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));
  }

  const [campaign, job, counts] = await Promise.all([
    (prisma.campaign as any).findFirst({
      where: {
        id: campaignId,
        shop,
        source: "schedule-window",
      },
      select: {
        id: true,
        title: true,
        status: true,
        source: true,
        runAt: true,
        windowEndAt: true,
      },
    }),
    (prisma.scheduledJob as any).findFirst({
      where: {
        shop,
        campaignId,
        mode: "time-window",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        runAt: true,
        windowEndAt: true,
        restoredAt: true,
      },
    }),
    prisma.priceHistory.groupBy({
      by: ["revertStatus"],
      where: { shop, campaignId },
      _count: { _all: true },
    }),
  ]);

  if (!campaign || !job) {
    return cors(new Response(JSON.stringify({ error: "Pricing window was not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }));
  }

  const totalTrackedCount = counts.reduce((total, row) => total + row._count._all, 0);
  const revertedCount = counts
    .filter((row) => row.revertStatus === "reverted")
    .reduce((total, row) => total + row._count._all, 0);
  const unrecoverableCount = counts
    .filter((row) => row.revertStatus === "unrecoverable")
    .reduce((total, row) => total + row._count._all, 0);

  const runtimeState = resolveWindowLifecycleState({
    status: campaign.status,
    source: campaign.source,
    runAt: campaign.runAt ?? job.runAt,
    windowEndAt: campaign.windowEndAt ?? job.windowEndAt,
    restoredAt: job.restoredAt,
    totalTrackedCount,
    revertedCount,
    unrecoverableCount,
  });

  if (requestedAction === "cancel-schedule") {
    if (runtimeState !== "scheduled-window") {
      return cors(new Response(JSON.stringify({
        error: "This window has already started and can no longer be cancelled.",
      }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }));
    }

    await prisma.$transaction([
      (prisma.scheduledJob as any).updateMany({
        where: {
          shop,
          campaignId,
          status: { in: ["pending", "processing"] },
        },
        data: { status: "cancelled" },
      }),
      (prisma.campaign as any).updateMany({
        where: { id: campaignId, shop },
        data: { status: "cancelled-window" },
      }),
      prisma.stagedPrice.deleteMany({ where: { shop, campaignId } }),
      prisma.activityLog.create({
        data: {
          shop,
          action: "WINDOW_CANCELLED",
          meta: { campaignId, jobId: job.id },
        },
      }),
    ]);

    return cors(new Response(JSON.stringify({
      success: true,
      status: "cancelled-window",
      message: "Pricing window cancelled before it started.",
    }), {
      headers: { "Content-Type": "application/json" },
    }));
  }

  if (runtimeState !== "active-window") {
    return cors(new Response(JSON.stringify({
      error: "This pricing window is not currently active.",
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }));
  }

  const restoreResult = await revertCampaignPrices({
    admin,
    shop,
    campaignId,
    successCampaignStatus: "window-stopped",
  });

  const restoredCleanly =
    restoreResult.terminal ||
    (restoreResult.success &&
      restoreResult.failedCount === 0 &&
      restoreResult.unrecoverableCount === 0);

  await prisma.$transaction([
    (prisma.scheduledJob as any).updateMany({
      where: {
        shop,
        campaignId,
        status: { in: ["active-window", "restoring"] },
      },
      data: {
        status: restoredCleanly ? "window-stopped" : "restore-failed",
        restoredAt: new Date(),
      },
    }),
    (prisma.campaign as any).updateMany({
      where: { id: campaignId, shop },
      data: { status: restoredCleanly ? "window-stopped" : "partial" },
    }),
    prisma.stagedPrice.deleteMany({ where: { shop, campaignId } }),
    prisma.activityLog.create({
      data: {
        shop,
        action: "WINDOW_STOPPED",
        meta: {
          campaignId,
          jobId: job.id,
          restoredCount: restoreResult.restoredCount,
          failedCount: restoreResult.failedCount,
          unrecoverableCount: restoreResult.unrecoverableCount,
        },
      },
    }),
  ]);

  return cors(new Response(JSON.stringify({
    success: restoreResult.success || restoreResult.terminal,
    status: restoredCleanly ? "window-stopped" : "partial",
    restoredCount: restoreResult.restoredCount,
    failedCount: restoreResult.failedCount,
    unrecoverableCount: restoreResult.unrecoverableCount,
    message: restoredCleanly
      ? "Original storefront pricing was restored before the scheduled end time."
      : "Original pricing was restored for some products. Review failed items before retrying.",
  }), {
    headers: { "Content-Type": "application/json" },
  }));
};
