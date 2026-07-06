import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cors, handlePreflight } from "../utils/cors";
import { resolveWindowLifecycleState } from "../utils/window-lifecycle";
import type { ScheduledProductSnapshot } from "../types/pricing";

type HistoryRow = {
  variantId: string;
  oldPrice: number;
  newPrice: number;
  batchId: string;
  revertStatus: string | null;
  revertFailureReason: string | null;
  revertedAt: Date | null;
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
        newPrice: true,
        batchId: true,
        revertStatus: true,
        revertFailureReason: true,
        revertedAt: true,
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
        const scheduledCampaign = campaignId
          ? await (prisma.campaign as any).findFirst({
              where: {
                id: campaignId,
                shop,
                status: { in: ["scheduled-window", "cancelled-window"] },
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
            })
          : null;

        if (scheduledCampaign) {
          const scheduledJob = await (prisma.scheduledJob as any).findFirst({
            where: {
              shop,
              campaignId,
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              mode: true,
              runAt: true,
              windowEndAt: true,
              productCount: true,
              products: true,
              title: true,
            },
          });

          const products = Array.isArray(scheduledJob?.products)
            ? scheduledJob.products as ScheduledProductSnapshot[]
            : [];
          const rows = products
            .filter((product) => typeof product?.variantId === "string" && product.variantId.length > 0)
            .map((product) => {
              const originalPrice = Number(product.originalVariantPrice ?? product.originalBasePrice ?? product.oldPrice);
              const currentPrice = Number(product.storefrontVariantPrice ?? product.oldPrice);
              const scheduledPrice = Number(product.scheduledPrice);
              return {
                variantId: String(product.variantId),
                productId: typeof product.productId === "string" ? product.productId : null,
                productTitle: product.title || "Untitled Product",
                variantTitle: product.variantTitle ?? null,
                sku: typeof product.sku === "string" ? product.sku : null,
                currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
                scheduledPrice: Number.isFinite(scheduledPrice) ? scheduledPrice : null,
                revertTargetPrice: Number.isFinite(originalPrice) ? originalPrice : 0,
                status: "scheduled",
                revertFailureReason: null,
              };
            });

          return cors(new Response(JSON.stringify({
            campaignId,
            title: scheduledCampaign.title ?? scheduledJob?.title ?? "Scheduled Campaign",
            productCount: scheduledJob?.productCount ?? rows.length,
            latestBatchId: null,
            rows,
            revertedCount: 0,
            failedCount: 0,
            unrecoverableCount: 0,
            totalTrackedCount: 0,
            revertCompletedAt: null,
            missingHistoricalRevertedFromCount: 0,
            terminal: false,
            preActivation: true,
            schedule: {
              type: scheduledJob?.mode === "time-window" ? "time-window" : "one-time",
              status: scheduledCampaign.status,
              runAt: scheduledJob?.runAt ?? scheduledCampaign.runAt ?? null,
              windowEndAt: scheduledJob?.windowEndAt ?? scheduledCampaign.windowEndAt ?? null,
              productCount: scheduledJob?.productCount ?? rows.length,
            },
            message: scheduledCampaign.status === "cancelled-window"
              ? "This pricing window was cancelled before it started."
              : "This pricing window is scheduled and has not started yet.",
          }), {
            headers: { "Content-Type": "application/json" },
          }));
        }

        const scheduledPublishCampaign = campaignId
          ? await (prisma.campaign as any).findFirst({
              where: {
                id: campaignId,
                shop,
                status: { in: ["scheduled-publish", "cancelled-publish"] },
                source: "schedule",
              },
              select: {
                id: true,
                title: true,
                status: true,
                source: true,
                runAt: true,
                createdAt: true,
              },
            })
          : null;

        if (scheduledPublishCampaign) {
          const scheduledJob = await (prisma.scheduledJob as any).findFirst({
            where: {
              shop,
              campaignId,
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              mode: true,
              runAt: true,
              productCount: true,
              products: true,
              title: true,
              createdAt: true,
            },
          });

          const products = Array.isArray(scheduledJob?.products)
            ? scheduledJob.products as ScheduledProductSnapshot[]
            : [];
          const rows = products
            .filter((product) => typeof product?.variantId === "string" && product.variantId.length > 0)
            .map((product) => {
              const originalPrice = Number(product.originalVariantPrice ?? product.originalBasePrice ?? product.oldPrice);
              const currentPrice = Number(product.storefrontVariantPrice ?? product.oldPrice);
              const scheduledPrice = Number(product.scheduledPrice);
              return {
                variantId: String(product.variantId),
                productId: typeof product.productId === "string" ? product.productId : null,
                productTitle: product.title || "Untitled Product",
                variantTitle: product.variantTitle ?? null,
                sku: typeof product.sku === "string" ? product.sku : null,
                currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
                scheduledPrice: Number.isFinite(scheduledPrice) ? scheduledPrice : null,
                revertTargetPrice: Number.isFinite(originalPrice) ? originalPrice : 0,
                status: "scheduled",
                revertFailureReason: null,
              };
            });

          return cors(new Response(JSON.stringify({
            campaignId,
            title: scheduledPublishCampaign.title ?? scheduledJob?.title ?? "Scheduled Campaign",
            productCount: scheduledJob?.productCount ?? rows.length,
            latestBatchId: null,
            rows,
            revertedCount: 0,
            failedCount: 0,
            unrecoverableCount: 0,
            totalTrackedCount: 0,
            revertCompletedAt: null,
            missingHistoricalRevertedFromCount: 0,
            terminal: false,
            prePublish: true,
            schedule: {
              type: "one-time",
              status: scheduledPublishCampaign.status,
              runAt: scheduledJob?.runAt ?? scheduledPublishCampaign.runAt ?? null,
              productCount: scheduledJob?.productCount ?? rows.length,
              createdAt: scheduledJob?.createdAt ?? scheduledPublishCampaign.createdAt ?? null,
            },
            message: scheduledPublishCampaign.status === "cancelled-publish"
              ? "This scheduled publish was cancelled before it started."
              : "This pricing publish is scheduled and has not started yet.",
          }), {
            headers: { "Content-Type": "application/json" },
          }));
        }

        const draftCampaign = campaignId
          ? await (prisma.campaign as any).findFirst({
              where: {
                id: campaignId,
                shop,
                source: "apply",
              },
              select: {
                id: true,
                title: true,
                status: true,
                createdAt: true,
              },
            })
          : null;

        if (draftCampaign) {
          const stagedPrices = await prisma.stagedPrice.findMany({
            where: {
              shop,
              campaignId,
            },
            select: {
              variantId: true,
              productId: true,
              originalPrice: true,
              stagedPrice: true,
            },
          });

          const variantGids = stagedPrices.map((s) =>
            s.variantId.startsWith("gid://")
              ? s.variantId
              : `gid://shopify/ProductVariant/${s.variantId}`
          );
          const currentByVariant = new Map<string, {
            currentPrice: number | null;
            productTitle: string | null;
            productId: string | null;
            variantTitle: string | null;
            sku: string | null;
          }>();

          for (const ids of chunk(variantGids, 100)) {
            const response = await admin.graphql(
              `query RevertPreviewNodes($ids: [ID!]!) {
                nodes(ids: $ids) {
                  ... on ProductVariant {
                    id
                    price
                    title
                    sku
                    product {
                      id
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
                productId: node.product?.id ?? null,
                variantTitle: node.title ?? null,
                sku: node.sku ?? null,
              });
            }
          }

          const rows = stagedPrices.map((item) => {
            const normalizedId = String(item.variantId).split("/").pop() ?? "";
            const current = currentByVariant.get(normalizedId);
            return {
              variantId: item.variantId,
              productId: item.productId ?? current?.productId ?? null,
              productTitle: current?.productTitle ?? "Untitled Product",
              variantTitle: current?.variantTitle ?? null,
              sku: current?.sku ?? null,
              currentPrice: Number(item.originalPrice),
              scheduledPrice: Number(item.stagedPrice),
              revertTargetPrice: null,
              status: "staged",
              revertFailureReason: null,
            };
          });

          return cors(new Response(JSON.stringify({
            campaignId,
            title: draftCampaign.title,
            productCount: stagedPrices.length,
            latestBatchId: null,
            rows,
            revertedCount: 0,
            failedCount: 0,
            unrecoverableCount: 0,
            totalTrackedCount: 0,
            revertCompletedAt: null,
            missingHistoricalRevertedFromCount: 0,
            terminal: false,
            staged: true,
            message: "These prices have been staged but not yet published to Shopify.",
          }), {
            headers: { "Content-Type": "application/json" },
          }));
        }

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
      ? await (prisma.campaign as any).findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          title: true,
          status: true,
          source: true,
          runAt: true,
          windowEndAt: true,
        },
      })
      : null;
    const scheduledJob = campaignId && campaign?.source === "schedule-window"
      ? await (prisma.scheduledJob as any).findFirst({
        where: {
          shop,
          campaignId,
          mode: "time-window",
        },
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          runAt: true,
          windowEndAt: true,
          restoredAt: true,
        },
      })
      : null;

    const variantGids = history.map((h) => toVariantGid(h.variantId));
    const currentByVariant = new Map<string, {
      currentPrice: number | null;
      productTitle: string | null;
      productId: string | null;
      variantTitle: string | null;
      sku: string | null;
    }>();

    for (const ids of chunk(variantGids, 100)) {
      const response = await admin.graphql(
        `query RevertPreviewNodes($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              price
              title
              sku
              product {
                id
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
          productId: node.product?.id ?? null,
          variantTitle: node.title ?? null,
          sku: node.sku ?? null,
        });
      }
    }

    let missingHistoricalRevertedFromCount = 0;
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
      const historicalRevertedFromPrice = Number.isFinite(h.newPrice) ? Number(h.newPrice) : null;
      const shouldUseHistoricalMovement = includeAllStatuses && operationalStatus === "reverted";
      const revertedFromPrice = shouldUseHistoricalMovement
        ? historicalRevertedFromPrice
        : current?.currentPrice ?? null;
      if (shouldUseHistoricalMovement && revertedFromPrice == null) {
        missingHistoricalRevertedFromCount += 1;
      }
      return {
        variantId: h.variantId,
        productId: current?.productId ?? null,
        productTitle: current?.productTitle ?? "Untitled Product",
        variantTitle: current?.variantTitle ?? null,
        sku: current?.sku ?? null,
        currentPrice: revertedFromPrice,
        revertTargetPrice: Number(h.oldPrice),
        status: operationalStatus,
        revertFailureReason: h.revertFailureReason ?? null,
      };
    });

    const latestBatchId = history[0]?.batchId ?? batchId ?? null;
    let revertedCount = history.filter((row) => row.revertStatus === "reverted").length;
    let failedCount = history.filter((row) => row.revertStatus === "failed").length;
    let unrecoverableCount = history.filter((row) => row.revertStatus === "unrecoverable").length;
    const totalTrackedCount = history.length;
    const runtimeWindowState = campaign?.source === "schedule-window"
      ? resolveWindowLifecycleState({
        status: campaign.status,
        source: campaign.source,
        runAt: campaign.runAt ?? scheduledJob?.runAt ?? null,
        windowEndAt: campaign.windowEndAt ?? scheduledJob?.windowEndAt ?? null,
        restoredAt: scheduledJob?.restoredAt ?? null,
        totalTrackedCount,
        revertedCount,
        unrecoverableCount,
      })
      : null;
    const shouldSuppressRestoreState =
      runtimeWindowState === "scheduled-window" || runtimeWindowState === "active-window";
    if (shouldSuppressRestoreState) {
      revertedCount = 0;
      failedCount = 0;
      unrecoverableCount = 0;
    }
    const revertCompletedAt =
      shouldSuppressRestoreState
        ? null
        : history
        .filter((row) => row.revertStatus === "reverted" && row.revertedAt instanceof Date)
        .map((row) => row.revertedAt as Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

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
      rows: shouldSuppressRestoreState
        ? rows.map((row) => ({ ...row, status: "pending", revertFailureReason: null }))
        : rows,
      revertedCount,
      failedCount,
      unrecoverableCount,
      totalTrackedCount,
      revertCompletedAt,
      missingHistoricalRevertedFromCount,
      terminal: false,
      runtimeStatus: runtimeWindowState,
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
