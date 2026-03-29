import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";

export const loader = async () => {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    try {
        const body = await request.json().catch(() => ({}));
        const clear = body.clear === true;

        if (clear) {
            await prisma.pricingRule.update({
                where: { shop },
                data: {
                    liveMarkupPercent: 0,
                    liveCharmPricing: false,
                    liveRoundingStep: 0,
                },
            });
            await logActivity(shop, "CLEAR_STOREFRONT");
            return new Response(JSON.stringify({ success: true, cleared: true }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        const rule = await prisma.pricingRule.findUnique({
            where: { shop },
        });

        if (!rule) {
            return new Response(JSON.stringify({ error: "No rules found to push." }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Push "Working" rules to "Live" storefront settings
        await prisma.pricingRule.update({
            where: { shop },
            data: {
                liveMarkupPercent: rule.markupPercent,
                liveCharmPricing: rule.charmPricing,
                liveRoundingStep: rule.roundingStep,
            },
        });

        await logActivity(shop, "PUSH_TO_STOREFRONT", { 
            markup: rule.markupPercent, 
            charm: rule.charmPricing, 
            rounding: rule.roundingStep 
        });

        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        await logActivity(shop, "ERROR", { action: "PUSH_STOREFRONT", message: error.message });
        return new Response(JSON.stringify({ error: "Failed to push rules to storefront." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
