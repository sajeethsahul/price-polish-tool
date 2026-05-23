import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { resolveWindowLifecycleState } from "../utils/window-lifecycle";

type CampaignHistoryItem = {
  campaignId: string;
  title: string;
  status: string;
  createdAt: Date;
  runAt: Date | null;
  windowEndAt: Date | null;
  productCount: number;
  source: string | null;
  latestBatchId: string | null;
  revertable: boolean;
  unrecoverableReason: string | null;
  revertedCount: number;
  failedCount: number;
  unrecoverableCount: number;
  totalTrackedCount: number;
  runtimeStatus: string;
};

function normalizeSource(source: string | null): string | null {
  if (!source) return null;
  if (source === "apply") return "manual";
  if (source === "schedule") return "scheduled";
  if (source === "schedule-window") return "time-window";
  return source;
}

function normalizeUnrecoverableReason(rawReason: string | null): string | null {
  if (!rawReason) return null;
  const normalized = rawReason.toLowerCase();
  if (normalized.includes("variant") && (normalized.includes("no longer exists") || normalized.includes("not found") || normalized.includes("does not exist"))) {
    return "Variant no longer exists in Shopify";
  }
  if (normalized.includes("product") && (normalized.includes("resource") || normalized.includes("not found") || normalized.includes("does not exist"))) {
    return "Product resource is no longer accessible";
  }
  if (normalized.includes("invalid") && normalized.includes("id")) {
    return "Invalid Shopify resource ID";
  }
  if (normalized.includes("not_found") || normalized.includes("not found")) {
    return "Shopify resource not found";
  }
  return "Shopify resource is no longer recoverable";
}

function unrecoverableReasonPriority(reason: string | null): number {
  if (!reason) return 999;
  if (reason === "Variant no longer exists in Shopify") return 1;
  if (reason === "Product resource is no longer accessible") return 2;
  if (reason === "Invalid Shopify resource ID") return 3;
  if (reason === "Shopify resource not found") return 4;
  return 5;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  const { session } = auth;
  const shop = session.shop;

  console.log("[Campaign History API] Fetch started", { shop });

  try {
    const campaigns = await (prisma.campaign as any).findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        runAt: true,
        windowEndAt: true,
        createdAt: true,
        source: true,
      },
    });

    if (campaigns.length === 0) {
      console.log("[Campaign History API] Count returned", { shop, count: 0 });
      return json({ campaigns: [] });
    }

    const campaignIds = campaigns.map((c) => c.id);

    const [historyRows, scheduledRows] = await Promise.all([
      prisma.priceHistory.findMany({
        where: {
          shop,
          campaignId: { in: campaignIds },
        },
        orderBy: { createdAt: "desc" },
        select: {
          campaignId: true,
          batchId: true,
          revertStatus: true,
        },
      }),
      (prisma.scheduledJob as any).findMany({
        where: {
          shop,
          campaignId: { in: campaignIds },
        },
        orderBy: { createdAt: "desc" },
        select: {
          campaignId: true,
          productCount: true,
          mode: true,
          windowEndAt: true,
          restoredAt: true,
          status: true,
        },
      }),
    ]);

    const latestBatchByCampaign = new Map<string, string>();
    const historyCountByCampaign = new Map<string, number>();
    const revertedCountByCampaign = new Map<string, number>();
    const failedCountByCampaign = new Map<string, number>();
    const unrevertedCountByCampaign = new Map<string, number>();
    const unrecoverableCountByCampaign = new Map<string, number>();
    for (const row of historyRows) {
      if (!row.campaignId) continue;
      if (!latestBatchByCampaign.has(row.campaignId)) {
        latestBatchByCampaign.set(row.campaignId, row.batchId);
      }
      historyCountByCampaign.set(
        row.campaignId,
        (historyCountByCampaign.get(row.campaignId) ?? 0) + 1
      );
      if (row.revertStatus === "reverted") {
        revertedCountByCampaign.set(
          row.campaignId,
          (revertedCountByCampaign.get(row.campaignId) ?? 0) + 1
        );
      }
      if (row.revertStatus === "failed") {
        failedCountByCampaign.set(
          row.campaignId,
          (failedCountByCampaign.get(row.campaignId) ?? 0) + 1
        );
      }
      if (row.revertStatus !== "reverted") {
        unrevertedCountByCampaign.set(
          row.campaignId,
          (unrevertedCountByCampaign.get(row.campaignId) ?? 0) + 1
        );
      }
      if (row.revertStatus === "unrecoverable") {
        unrecoverableCountByCampaign.set(
          row.campaignId,
          (unrecoverableCountByCampaign.get(row.campaignId) ?? 0) + 1
        );
      }
    }

    const unrecoverableReasonByCampaign = new Map<string, { reason: string | null; rank: number; createdAt: Date }>();
    try {
      const reasonRows = await prisma.priceHistory.findMany({
        where: {
          shop,
          campaignId: { in: campaignIds },
          revertStatus: "unrecoverable",
        },
        orderBy: { createdAt: "desc" },
        select: {
          campaignId: true,
          revertFailureReason: true,
          createdAt: true,
        },
      });
      for (const row of reasonRows) {
        if (!row.campaignId) continue;
        const conciseReason = normalizeUnrecoverableReason(row.revertFailureReason ?? null);
        const nextRank = unrecoverableReasonPriority(conciseReason);
        const current = unrecoverableReasonByCampaign.get(row.campaignId);
        if (!current || nextRank < current.rank) {
          unrecoverableReasonByCampaign.set(row.campaignId, {
            reason: conciseReason,
            rank: nextRank,
            createdAt: row.createdAt,
          });
        }
      }
    } catch (reasonError) {
      console.warn("[Campaign History API] Could not load unrecoverable reasons", reasonError);
    }

    const scheduledCountByCampaign = new Map<string, number>();
    const scheduledWindowEndByCampaign = new Map<string, Date | null>();
    const scheduledRestoredAtByCampaign = new Map<string, Date | null>();
    const scheduledStatusByCampaign = new Map<string, string | null>();
    for (const row of scheduledRows) {
      if (!row.campaignId) continue;
      if (!scheduledCountByCampaign.has(row.campaignId)) {
        scheduledCountByCampaign.set(row.campaignId, row.productCount ?? 0);
      }
      if (!scheduledWindowEndByCampaign.has(row.campaignId)) {
        scheduledWindowEndByCampaign.set(row.campaignId, row.windowEndAt ?? null);
      }
      if (!scheduledRestoredAtByCampaign.has(row.campaignId)) {
        scheduledRestoredAtByCampaign.set(row.campaignId, row.restoredAt ?? null);
      }
      if (!scheduledStatusByCampaign.has(row.campaignId)) {
        scheduledStatusByCampaign.set(row.campaignId, row.status ?? null);
      }
    }

    const now = new Date();
    const result: CampaignHistoryItem[] = campaigns.map((campaign) => {
      const latestBatchId = latestBatchByCampaign.get(campaign.id) ?? null;
      const productCount =
        scheduledCountByCampaign.get(campaign.id) ??
        historyCountByCampaign.get(campaign.id) ??
        0;
      const totalTrackedCount = historyCountByCampaign.get(campaign.id) ?? 0;
      let revertedCount = revertedCountByCampaign.get(campaign.id) ?? 0;
      let failedCount = failedCountByCampaign.get(campaign.id) ?? 0;
      const unrevertedCount = unrevertedCountByCampaign.get(campaign.id) ?? 0;
      let unrecoverableCount = unrecoverableCountByCampaign.get(campaign.id) ?? 0;
      const retryableCount = Math.max(0, unrevertedCount - unrecoverableCount);
      let effectiveStatus =
        unrecoverableCount > 0 && retryableCount === 0
          ? "unrecoverable"
          : campaign.status;
      if (campaign.source === "schedule-window") {
        const windowState = resolveWindowLifecycleState(
          {
            status: campaign.status,
            source: campaign.source,
            runAt: campaign.runAt,
            windowEndAt: campaign.windowEndAt ?? scheduledWindowEndByCampaign.get(campaign.id) ?? null,
            restoredAt: scheduledRestoredAtByCampaign.get(campaign.id) ?? null,
            totalTrackedCount,
            revertedCount,
            unrecoverableCount,
          },
          now
        );
        if (windowState) {
          effectiveStatus = windowState;
        }
        if (windowState === "scheduled-window" || windowState === "active-window") {
          revertedCount = 0;
          failedCount = 0;
          unrecoverableCount = 0;
        }
      }
      const surfacedReason = unrecoverableReasonByCampaign.get(campaign.id)?.reason ?? null;

      return {
        campaignId: campaign.id,
        title: campaign.title,
        status: effectiveStatus,
        runtimeStatus: effectiveStatus,
        createdAt: campaign.createdAt,
        runAt: campaign.runAt,
        windowEndAt: campaign.windowEndAt ?? scheduledWindowEndByCampaign.get(campaign.id) ?? null,
        productCount,
        source: normalizeSource(campaign.source),
        latestBatchId,
        revertable: retryableCount > 0,
        unrecoverableReason: surfacedReason,
        revertedCount,
        failedCount,
        unrecoverableCount,
        totalTrackedCount,
      };
    });

    const revertableCount = result.filter((c) => c.revertable).length;
    console.log("[Campaign History API] Revertability recalculated", {
      shop,
      revertableCount,
      total: result.length,
    });
    console.log("[Campaign History API] Unrecoverable reason surfaced", {
      shop,
      count: result.filter((c) => c.unrecoverableReason).length,
    });

    console.log("[Campaign History API] Count returned", {
      shop,
      count: result.length,
    });
    console.log("[Campaign History API] operational metrics enriched", {
      shop,
      campaignsWithTrackedHistory: result.filter((campaign) => campaign.totalTrackedCount > 0).length,
    });

    return json({ campaigns: result });
  } catch (error) {
    console.error("[Campaign History API] Error fetching campaign history:", error);
    return json({ error: "Failed to load campaign history" }, { status: 500 });
  }
}
