import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const auth = await authenticate.admin(request);
    if (auth instanceof Response) {
        console.log("[AUTH/BILLING REDIRECT]");
        console.log("REQUEST:", request.url);
        console.log("STATUS:", auth.status);
        console.log("LOCATION:", auth.headers.get("Location"));
        return auth;
    }
    
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
            latestDonePushJob,
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
                    status: { notIn: ["reverted", "unrecoverable", "auto-restored"] },
                },
            }),
            prisma.campaign.count({
                where: {
                    shop,
                    status: { in: ["reverted", "unrecoverable", "auto-restored"] },
                },
            }),
            prisma.pushJob.findFirst({
                where: { shop, status: "done" },
                orderBy: { createdAt: "desc" },
                select: { failed: true },
            }),
        ]);

        // Calculate operational metrics for Phase 8C.2
        const campaignStatusCounts = await prisma.campaign.groupBy({
            by: ['status'],
            where: { shop },
            _count: { status: true },
        });

        let activeCampaignsCount = 0;
        let scheduledRunsCount = 0;

        campaignStatusCounts.forEach(group => {
            const status = group.status.toLowerCase();
            if (['published', 'active-window', 'publishing'].includes(status)) {
                activeCampaignsCount += group._count.status;
            }
            if (['scheduled-publish', 'scheduled-window'].includes(status)) {
                scheduledRunsCount += group._count.status;
            }
        });

        const isLive = appState?.isLive === true;
        const onboarding = {
            onboardingFirstRuleAt: appState?.onboardingFirstRuleAt ?? null,
            onboardingFirstPreviewAt: appState?.onboardingFirstPreviewAt ?? null,
            onboardingFirstApplyStartAt: appState?.onboardingFirstApplyStartAt ?? null,
            onboardingFirstApplyAt: appState?.onboardingFirstApplyAt ?? null,
            onboardingFirstScheduleAt: appState?.onboardingFirstScheduleAt ?? null,
            onboardingCompletedAt: (appState as any)?.onboardingCompletedAt ?? null,
            onboardingCelebratedAt: appState?.onboardingCelebratedAt ?? null,
            reviewRequestShownAt: appState?.reviewRequestShownAt ?? null,
            reviewRequestDismissedAt: appState?.reviewRequestDismissedAt ?? null,
        };
        
        // Check for enabled live pricing rules
        const pricingRule = await prisma.pricingRule.findUnique({
            where: { shop }
        });
        // A live rule is active if isLive is true and there are live settings (or default rule exists)
        const livePricingRulesCount = isLive && pricingRule ? 1 : 0;

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
        // pendingRetryCount: failures from the last completed publish that still
        // have staged records. Capped at stagedPendingCount so stale job data
        // from a previous session does not overstate the current retry queue.
        const pendingRetryCount = Math.min(latestDonePushJob?.failed ?? 0, stagedPendingCount);

        return cors(new Response(JSON.stringify({
            activeCampaignsCount,
            scheduledRunsCount,
            livePricingRulesCount,
            productsUnderAutomationCount: influencedVariantCount,
            isLive,
            onboarding,
            storefrontControl: {
                influencedVariantCount,
                stagedPendingCount,
                pendingRetryCount,
                retryableRevertCount,
                unrecoverableCount,
                latestInfluenceAt,
                openCampaignCount,
                closedCampaignCount,
                activeCampaignId: appState?.activeCampaignId ?? null,
                canGoLive,
                goLiveMessage: canGoLive
                    ? "Staged prices are ready to publish."
                    : "No staged prices are ready. Apply pricing before going live."
            },
        }), {
            headers: { "Content-Type": "application/json" },
        }));
    } catch (error) {
        return cors(new Response(JSON.stringify({
            activeCampaignsCount: 0,
            scheduledRunsCount: 0,
            livePricingRulesCount: 0,
            productsUnderAutomationCount: 0,
            isLive: false,
            onboarding: {
                onboardingFirstRuleAt: null,
                onboardingFirstPreviewAt: null,
                onboardingFirstApplyStartAt: null,
                onboardingFirstApplyAt: null,
                onboardingFirstScheduleAt: null,
                onboardingCompletedAt: null,
                onboardingCelebratedAt: null,
                reviewRequestShownAt: null,
                reviewRequestDismissedAt: null,
            },
            storefrontControl: {
                influencedVariantCount: 0,
                stagedPendingCount: 0,
                pendingRetryCount: 0,
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
