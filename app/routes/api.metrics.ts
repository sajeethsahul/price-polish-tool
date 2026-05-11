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

        // FIX 4: Read isLive from AppState — the authoritative source.
        // Previous code used rule.liveMarkupPercent which is never written by any
        // code path, causing the dashboard live indicator to always show OFF.
        const appState = await prisma.appState.findUnique({
            where: { shop },
        });

        const isLive = appState?.isLive === true;

        return cors(new Response(JSON.stringify({
            totalApplied,
            lastUpdate,
            successRate,
            isLive
        }), {
            headers: { "Content-Type": "application/json" },
        }));
    } catch (error) {
        return cors(new Response(JSON.stringify({ totalApplied: 0, lastUpdate: "", successRate: 100 }), {
            headers: { "Content-Type": "application/json" },
        }));
    }
};
