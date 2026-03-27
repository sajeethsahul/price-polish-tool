import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

// This handles requests to /proxy/settings (forwarded from /apps/price-polish/settings)
export const loader = async ({ request }: LoaderFunctionArgs) => {
    console.log("PROXY_HIT:", request.url);
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");

    if (!shop) {
        console.error("PROXY_ERROR: Missing shop parameter");
        return new Response("Missing shop parameter", { status: 400 });
    }

    try {
        const rule = await prisma.pricingRule.findUnique({
            where: { shop },
        });

        const settings = {
            markup: rule?.liveMarkupPercent ?? 0,
            charm: rule?.liveCharmPricing ?? false,
            rounding: rule?.liveRoundingStep ?? 0,
        };

        console.log("PROXY_SUCCESS: Returning settings for", shop);
        return new Response(JSON.stringify(settings), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("PROXY_ERROR: Failed to fetch settings:", error);
        return new Response("Error fetching settings", { status: 500 });
    }
};
