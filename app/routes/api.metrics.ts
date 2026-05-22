import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const auth = await authenticate.admin(request);
    
    if (!auth?.session) {
        console.error("NO SESSION FOUND IN REQUEST (METRICS)");
        throw new Response("Unauthorized", { status: 401 });
    }

    const { session } = auth;
    const shop = session.shop;
    console.log("SESSION SHOP (METRICS):", shop);

    try {
        const [
            logs,
            appState,
            stagedPendingCount,
            latestVariantRows,
            openCampaignCount,
            closedCampaignCount,
        ] = await Promise.all([
            prisma.activityLog.findMany({
                where: { shop },
                orderBy: { createdAt: "desc" },
                take: 100,
            }),
            prisma.appState.findUnique({
                where: { shop },
            }),
            prisma.stagedPrice.count({
                where: { shop },
            }),
            prisma.priceHistory.findMany({
                where: { shop },
                select: {
                    variantId: true,
                    revertStatus: true,
                    createdAt: true,
                },
                distinct: ["variantId"],
                orderBy: [
                    { variantId: "asc" },
                    { createdAt: "desc" },
                ],
            }),
            prisma.campaign.count({
                where: {
                    shop,
                    status: { notIn: ["reverted", "unrecoverable"] },
                },
            }),
            prisma.campaign.count({
                where: {
                    shop,
                    status: { in: ["reverted", "unrecoverable"] },
                },
            }),
        ]);

        // Calculate total optimizations (successful BULK or APPLY)
        const successLogs = logs.filter(l => 
            l.action === "BULK_SUCCESS" || 
            l.action === "BULK_PARTIAL_FAILURE"
        );

        let totalApplied = 0;
        let totalFailed = 0;

        successLogs.forEach(log => {
            const meta = (log.meta as any) || {};
            totalApplied += meta.successCount || 0;
            totalFailed += meta.failedCount || 0;
        });

        const lastUpdate = successLogs[0]?.createdAt.toISOString() || "";
        const successRate = (totalApplied + totalFailed) > 0 
            ? (totalApplied / (totalApplied + totalFailed)) * 100 
            : 100;

        const isLive = appState?.isLive === true;
        let influencedVariantCount = 0;
        let retryableRevertCount = 0;
        let unrecoverableCount = 0;
        let latestInfluenceAt = "";

        for (const row of latestVariantRows) {
            const status = (row.revertStatus ?? "").toLowerCase();
            if (status === "reverted") continue;

            if (!latestInfluenceAt || row.createdAt.toISOString() > latestInfluenceAt) {
                latestInfluenceAt = row.createdAt.toISOString();
            }

            if (status === "failed") {
                retryableRevertCount += 1;
                influencedVariantCount += 1;
                continue;
            }

            if (status === "unrecoverable") {
                unrecoverableCount += 1;
                continue;
            }

            influencedVariantCount += 1;
        }

        const canGoLive = stagedPendingCount > 0;

        return cors(new Response(JSON.stringify({
            totalApplied,
            lastUpdate,
            successRate,
            isLive,
            storefrontControl: {
                influencedVariantCount,
                stagedPendingCount,
                retryableRevertCount,
                unrecoverableCount,
                latestInfluenceAt,
                openCampaignCount,
                closedCampaignCount,
                canGoLive,
                goLiveMessage: canGoLive
                    ? "Staged prices are ready to publish."
                    : "No staged prices are ready. Apply pricing before going live.",
            },
        }), {
            headers: { "Content-Type": "application/json" },
        }));
    } catch (error) {
        return cors(new Response(JSON.stringify({
            totalApplied: 0,
            lastUpdate: "",
            successRate: 100,
            isLive: false,
            storefrontControl: {
                influencedVariantCount: 0,
                stagedPendingCount: 0,
                retryableRevertCount: 0,
                unrecoverableCount: 0,
                latestInfluenceAt: "",
                openCampaignCount: 0,
                closedCampaignCount: 0,
                canGoLive: false,
                goLiveMessage: "Unable to load storefront control status.",
            },
        }), {
            headers: { "Content-Type": "application/json" },
        }));
    }
};
