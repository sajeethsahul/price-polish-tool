import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { stagePrices } from "../utils/staging.server";

export async function action({ request }: ActionFunctionArgs) {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) return auth;

    const { session } = auth;
    const shop = session.shop;

    const body = await request.json().catch(() => ({}));
    const { runAt, products } = body;

    if (!runAt) {
        return json({ error: "runAt required" }, { status: 400 });
    }

    // ── Auto-stage: Generate staged prices before creating the job ──
    // Merchants no longer need to click "Apply" first.
    // If products are provided, stage them. If not, verify existing staged prices.
    let stagedCount = 0;
    let failedCount = 0;

    if (Array.isArray(products) && products.length > 0) {
        const stageResult = await stagePrices(shop, products);

        console.log(
            `[Schedule] Auto-staged ${stageResult.successCount} price(s) for shop ${shop}` +
            (stageResult.failedCount > 0 ? `, ${stageResult.failedCount} failed` : "")
        );

        if (stageResult.failedItems.length > 0) {
            console.warn(
                `[Schedule] Failed items for shop ${shop}:`,
                stageResult.failedItems.map(f => `${f.variantId}: ${f.reason}`)
            );
        }

        if (!stageResult.success) {
            return json(
                { error: stageResult.message || "Failed to stage prices for scheduling." },
                { status: 400 }
            );
        }

        stagedCount = stageResult.successCount;
        failedCount = stageResult.failedCount;
    } else {
        // Fallback: verify staged prices already exist (backward compat)
        const staged = await prisma.stagedPrice.findMany({
            where: { shop },
            take: 1,
        });

        if (!staged.length) {
            return json(
                { error: "No products to schedule. Refresh previews and try again." },
                { status: 400 }
            );
        }
    }

    await prisma.scheduledJob.create({
        data: {
            shop,
            runAt: new Date(runAt),
        },
    });

    return json({ success: true, stagedCount, failedCount });
}