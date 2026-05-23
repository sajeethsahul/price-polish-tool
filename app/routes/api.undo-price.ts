import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { logActivity } from "../utils/activity.server";
import { cors, handlePreflight } from "../utils/cors";
import { revertCampaignPrices } from "../utils/revert.server";

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

    if (!auth?.session) {
        console.error("[UNDO] ❌ NO SESSION FOUND");
        throw new Response("Unauthorized", { status: 401 });
    }

    const { admin, session } = auth;
    const shop = session.shop;

    console.log("[UNDO] SESSION", { shop });

    try {
        const body = await request.json();

        const rawCampaignId = body?.campaignId;
        const campaignId = typeof rawCampaignId === "string" && rawCampaignId.length > 0
            ? rawCampaignId
            : undefined;
        const rawBatchId = body?.batchId;
        const batchId = typeof rawBatchId === "string" && rawBatchId.length > 0
            ? rawBatchId
            : undefined;
        const retryFailedOnly = body?.retryFailedOnly === true;

        if (!campaignId && !batchId) {
            console.warn("[UNDO] ⚠️ NO CAMPAIGN ID OR BATCH ID PROVIDED");
            return new Response(
                JSON.stringify({ error: "No campaignId or batchId provided" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
            );
        }

        console.log("[UNDO] START", { shop, campaignId, batchId });
        if (retryFailedOnly) {
            console.log("[UNDO] 🔁 Retry failed revert started", { shop, campaignId, batchId });
        }

        await logActivity(shop, "UNDO_CLICKED", { campaignId, batchId });

        console.log(
            campaignId
                ? "[UNDO] 🧭 Using campaign-aware revert path"
                : "[UNDO] 🧩 Using legacy batchId revert path",
            { shop, campaignId, batchId }
        );

        const result = await revertCampaignPrices({
            admin,
            shop,
            campaignId,
            batchId,
            retryFailedOnly,
        });

        console.log("[UNDO] COMPLETE", {
            shop,
            campaignId,
            batchId,
            retryFailedOnly,
            successCount: result.restoredCount,
            failCount: result.failedCount,
            unrecoverableCount: result.unrecoverableCount,
            total: result.total,
        });

        await logActivity(shop, "UNDO_SUCCESS", {
            successCount: result.restoredCount,
            total: result.total,
        });

        return cors(new Response(
            JSON.stringify({
                success: result.success,
                terminal: result.terminal,
                restoredCount: result.restoredCount,
                total: result.total,
                failedCount: result.failedCount,
                unrecoverableCount: result.unrecoverableCount,
                results: result.results,
                message: result.message,
            }),
            { headers: { "Content-Type": "application/json" } },
        ));

    } catch (error: any) {
        console.error("[UNDO] FATAL ERROR", error);

        await logActivity(shop, "ERROR", {
            action: "UNDO_PRICE",
            message: error.message,
        });

        if (
            error?.message === "No history found for this campaign" ||
            error?.message === "No history found for this batch"
        ) {
            return cors(new Response(
                JSON.stringify({ error: error.message }),
                { status: 404, headers: { "Content-Type": "application/json" } },
            ));
        }

        return cors(new Response(
            JSON.stringify({ error: "Something went wrong during undo" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        ));
    }
};