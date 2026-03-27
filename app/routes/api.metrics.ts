import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    try {
        const logs = await prisma.activityLog.findMany({
            where: { shop },
            orderBy: { createdAt: "desc" },
            take: 100,
        });

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

        const rule = await prisma.pricingRule.findUnique({
            where: { shop },
            select: { liveMarkupPercent: true }
        });

        const isLive = !!(rule?.liveMarkupPercent && rule.liveMarkupPercent !== 0);

        return new Response(JSON.stringify({
            totalApplied,
            lastUpdate,
            successRate,
            isLive
        }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({ totalApplied: 0, lastUpdate: "", successRate: 100 }), {
            headers: { "Content-Type": "application/json" },
        });
    }
};
