import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cors, handlePreflight } from "../utils/cors";

type HistoryRow = {
  variantId: string;
  oldPrice: number;
  batchId: string;
  revertStatus: string | null;
  revertFailureReason: string | null;
};

function toVariantGid(variantId: string) {
  return variantId.startsWith("gid://")
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

  try {
    const body = await request.json().catch(() => ({}));
    const campaignId =
      typeof body?.campaignId === "string" && body.campaignId.length > 0
        ? body.campaignId
        : undefined;
    const batchId =
      typeof body?.batchId === "string" && body.batchId.length > 0
        ? body.batchId
        : undefined;
    const retryFailedOnly = body?.retryFailedOnly === true;
    const includeAllStatuses = body?.includeAllStatuses === true;

    if (!campaignId && !batchId) {
      return cors(new Response(JSON.stringify({ error: "No campaignId or batchId provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }));
    }

    if (retryFailedOnly) {
      console.log("[Campaign Revert Preview] retry preview mode enabled", { shop, campaignId, batchId });
    }
    if (includeAllStatuses) {
      console.log("[Campaign Revert Preview] campaign detail view opened", { shop, campaignId, batchId });
    }

    const baseWhere = campaignId
      ? { shop, campaignId }
      : { batchId };

    const historyWhere = campaignId
      ? {
          ...baseWhere,
          ...(includeAllStatuses
            ? {}
            : retryFailedOnly
              ? { revertStatus: "failed" }
              : {
                  OR: [
                    { revertStatus: null },
                    { revertStatus: { notIn: ["reverted", "unrecoverable"] } },
                  ],
                }),
        }
      : {
          ...baseWhere,
          ...(includeAllStatuses
            ? {}
            : retryFailedOnly
              ? { revertStatus: "failed" }
              : {
                  OR: [
                    { revertStatus: null },
                    { revertStatus: { notIn: ["reverted", "unrecoverable"] } },
                  ],
                }),
        };

    const history = await prisma.priceHistory.findMany({
      where: historyWhere,
      orderBy: { createdAt: "desc" },
      select: {
        variantId: true,
        oldPrice: true,
        batchId: true,
        revertStatus: true,
        revertFailureReason: true,
      },
    });

    if (retryFailedOnly) {
      console.log("[Campaign Revert Preview] retry preview eligible count", {
        shop,
        campaignId,
        batchId,
        eligibleCount: history.length,
      });
    }

    if (history.length === 0) {
      if (includeAllStatuses) {
        return cors(new Response(JSON.stringify({
          error: campaignId ? "No campaign details found" : "No campaign batch details found",
        }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }));
      }
      const totalHistoryCount = await prisma.priceHistory.count({
        where: baseWhere,
      });
      const unrecoverableCount = await prisma.priceHistory.count({
        where: {
          ...baseWhere,
          revertStatus: "unrecoverable",
        },
      });
      if (totalHistoryCount > 0) {
        const terminalMessage =
          unrecoverableCount > 0
            ? "This campaign can no longer be reverted."
            : "No retryable revert actions remain.";
        if (unrecoverableCount > 0) {
          console.log("[Campaign Revert Preview] terminal unrecoverable campaign detected", {
            shop,
            campaignId,
            batchId,
            unrecoverableCount,
          });
        }
        return cors(new Response(JSON.stringify({
          campaignId: campaignId ?? null,
          title: "Unrecoverable Campaign",
          productCount: 0,
          latestBatchId: batchId ?? null,
          rows: [],
          terminal: true,
          message: terminalMessage,
          unrecoverableCount,
        }), {
          headers: { "Content-Type": "application/json" },
        }));
      }
      return cors(new Response(JSON.stringify({
        error: campaignId ? "No history found for this campaign" : "No history found for this batch",
      }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }));
    }

    const campaign = campaignId
      ? await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, title: true },
      })
      : null;

    const variantGids = history.map((h) => toVariantGid(h.variantId));
    const currentByVariant = new Map<string, { currentPrice: number | null; productTitle: string | null }>();

    for (const ids of chunk(variantGids, 100)) {
      const response = await admin.graphql(
        `query RevertPreviewNodes($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              price
              product {
                title
              }
            }
          }
        }`,
        { variables: { ids } }
      );

      const data: any = await response.json();
      const nodes = data?.data?.nodes ?? [];
      for (const node of nodes) {
        if (!node?.id) continue;
        const normalizedId = String(node.id).split("/").pop() ?? "";
        currentByVariant.set(normalizedId, {
          currentPrice: node.price != null ? Number(node.price) : null,
          productTitle: node.product?.title ?? null,
        });
      }
    }

    const rows = history.map((h) => {
      const normalizedId = String(h.variantId).split("/").pop() ?? "";
      const current = currentByVariant.get(normalizedId);
      const operationalStatus =
        h.revertStatus === "reverted"
          ? "reverted"
          : h.revertStatus === "failed"
            ? "failed"
            : h.revertStatus === "unrecoverable"
              ? "unrecoverable"
              : "pending";
      return {
        variantId: h.variantId,
        productTitle: current?.productTitle ?? "Untitled Product",
        currentPrice: current?.currentPrice,
        revertTargetPrice: Number(h.oldPrice),
        status: operationalStatus,
        revertFailureReason: h.revertFailureReason ?? null,
      };
    });

    const latestBatchId = history[0]?.batchId ?? batchId ?? null;
    const revertedCount = history.filter((row) => row.revertStatus === "reverted").length;
    const failedCount = history.filter((row) => row.revertStatus === "failed").length;
    const unrecoverableCount = history.filter((row) => row.revertStatus === "unrecoverable").length;
    const totalTrackedCount = history.length;

    if (includeAllStatuses) {
      console.log("[Campaign Revert Preview] informational campaign detail loaded", {
        shop,
        campaignId,
        batchId: latestBatchId,
        totalTrackedCount,
      });
    }

    return cors(new Response(JSON.stringify({
      campaignId: campaignId ?? null,
      title: campaign?.title ?? "Legacy Batch Revert",
      productCount: history.length,
      latestBatchId,
      rows,
      revertedCount,
      failedCount,
      unrecoverableCount,
      totalTrackedCount,
      terminal: false,
      message: null,
    }), {
      headers: { "Content-Type": "application/json" },
    }));
  } catch (error: any) {
    return cors(new Response(JSON.stringify({ error: error?.message || "Failed to load revert preview" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    }));
  }
};
