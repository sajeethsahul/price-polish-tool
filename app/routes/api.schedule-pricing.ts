import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { stagePrices } from "../utils/staging.server";
import type { ScheduledProductSnapshot } from "../types/pricing";
import { applyLocaleFromSession, t } from "../utils/i18n";

function normalizeScheduledProductSnapshot(product: any): ScheduledProductSnapshot | null {
    if (!product || typeof product !== "object") {
        return null;
    }

    const productId = typeof product.productId === "string" ? product.productId : "";
    const variantId = typeof product.variantId === "string" ? product.variantId : "";

    if (!productId || !variantId) {
        return null;
    }

    return {
        productId,
        variantId,
        title: typeof product.title === "string" && product.title.length > 0
            ? product.title
            : "Untitled Product",
        variantTitle: typeof product.variantTitle === "string" ? product.variantTitle : null,
        sku: typeof product.sku === "string" ? product.sku : null,
        image: typeof product.image === "string" ? product.image : null,
        oldPrice: product.oldPrice,
        newPrice: product.newPrice,
        originalBasePrice: product.originalBasePrice ?? null,
        compareAtPrice: product.compareAtPrice ?? null,
        storefrontVariantPrice: product.storefrontVariantPrice ?? product.oldPrice ?? null,
        originalVariantPrice: product.originalVariantPrice ?? product.originalBasePrice ?? product.oldPrice ?? null,
        scheduledPrice: product.scheduledPrice ?? product.newPrice ?? null,
        isManual: product.isManual === true,
    };
}

export async function action({ request }: ActionFunctionArgs) {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) return auth;

    const { session } = auth;
    const shop = session.shop;

    const sub = await prisma.subscription.findFirst({
        where: { shop },
        select: { status: true, plan: true },
    });

    const activeStates = ["ACTIVE", "PENDING", "active", "trialing", "free"];
    const isActive = sub && activeStates.includes(sub.status);

    if (!isActive) {
        return Response.json(
            { error: "Subscription required. Restore your subscription to continue." },
            { status: 403 }
        );
    }

    // Free plan limit check — enforcement pending (post-beta)
    const plan = sub?.plan ?? "free";
    if (plan === "free") {
        console.log("[BILLING] Free plan limit check — enforcement pending", {
            shop, action: "campaign_create"
        });
        // TODO: enforce campaignsPerMonth: 2 limit after beta
    }

    applyLocaleFromSession(session);

    const body = await request.json().catch(() => ({}));
    const { runAt, title } = body;
    const products = Array.isArray(body?.products)
        ? body.products
            .map((product: any) => normalizeScheduledProductSnapshot(product))
            .filter((product: ScheduledProductSnapshot | null): product is ScheduledProductSnapshot => product !== null)
        : [];
    const scheduleMode = body?.mode === "time-window" ? "time-window" : "one-time";
    const windowEndAt = typeof body?.windowEndAt === "string" ? body.windowEndAt : undefined;

    if (!runAt) {
        return Response.json({ error: t("server.choosePublishTime") }, { status: 400 });
    }

    const runAtDate = new Date(runAt);
    const windowEndAtDate = windowEndAt ? new Date(windowEndAt) : null;
    const now = new Date();

    if (Number.isNaN(runAtDate.getTime())) {
        return Response.json({ error: t("server.chooseValidPublishTime") }, { status: 400 });
    }

    if (runAtDate.getTime() <= now.getTime()) {
        return Response.json({ error: t("server.chooseFutureStart") }, { status: 400 });
    }

    if (scheduleMode === "time-window") {
        if (!windowEndAtDate || Number.isNaN(windowEndAtDate.getTime())) {
            return Response.json({ error: t("server.chooseRestoreTime") }, { status: 400 });
        }

        if (windowEndAtDate.getTime() <= runAtDate.getTime()) {
            return Response.json({ error: t("server.windowEndAfterStart") }, { status: 400 });
        }

        if (!Array.isArray(products) || products.length === 0) {
            return Response.json(
                { error: t("server.chooseProductsWindow") },
                { status: 400 }
            );
        }
    }

    // ── Auto-stage: Generate staged prices before creating the job ──
    // Merchants no longer need to click "Apply" first.
    // If products are provided, stage them. If not, verify existing staged prices.
    let stagedCount = 0;
    let failedCount = 0;
    let campaignId: string | undefined;

    if (Array.isArray(products) && products.length > 0) {
        campaignId = crypto.randomUUID();
        const stageResult = await stagePrices(shop, products, campaignId);

        if (!stageResult.success) {
            console.warn("[SCHEDULER] schedule.stage.rejected", { shop, campaignId, successCount: stageResult.successCount, failCount: stageResult.failedCount, reason: stageResult.message });
            return Response.json(
                { error: stageResult.message || t("server.stageFailed") },
                { status: 400 }
            );
        }

        if (stageResult.failedCount > 0) {
            console.warn("[SCHEDULER] schedule.stage.partial", { shop, campaignId, successCount: stageResult.successCount, failCount: stageResult.failedCount });
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
            return Response.json(
                { error: t("server.noProductsSchedule") },
                { status: 400 }
            );
        }
    }

    await (prisma.scheduledJob as any).create({
        data: {
            shop,
            campaignId,
            runAt: runAtDate,
            mode: scheduleMode,
            windowEndAt: scheduleMode === "time-window" ? windowEndAtDate : null,
            title: title || "Scheduled Campaign",
            productCount: products ? products.length : 0,
            products: products || [],
        },
    });

    const nowForOnboarding = new Date();
    const existingState = await prisma.appState.findUnique({
        where: { shop },
        select: { onboardingFirstScheduleAt: true, isLive: true },
    });

    if (!existingState?.onboardingFirstScheduleAt) {
        await prisma.appState.upsert({
            where: { shop },
            update: { onboardingFirstScheduleAt: nowForOnboarding },
            create: { shop, isLive: existingState?.isLive ?? false, onboardingFirstScheduleAt: nowForOnboarding },
        });
    }

    if (campaignId) {
        await (prisma.campaign as any).create({
            data: {
                id: campaignId,
                shop,
                title: title || "Scheduled Campaign",
                status: scheduleMode === "time-window" ? "scheduled-window" : "scheduled-publish",
                runAt: runAtDate,
                windowEndAt: scheduleMode === "time-window" ? windowEndAtDate : null,
                source: scheduleMode === "time-window" ? "schedule-window" : "schedule",
            },
        });

        if (scheduleMode === "time-window") {
            await prisma.activityLog.create({
                data: {
                    shop,
                    action: "WINDOW_SCHEDULED",
                    meta: {
                        campaignId,
                        runAt: runAtDate.toISOString(),
                        windowEndAt: windowEndAtDate?.toISOString(),
                        productCount: products ? products.length : 0,
                    },
                },
            });
        }
    }

    console.log("[SCHEDULER] schedule.created", { shop, mode: scheduleMode, runAt: runAtDate.toISOString(), productCount: products?.length ?? 0, campaignId });

    return Response.json({ success: true, stagedCount, failedCount, ...(campaignId ? { campaignId } : {}) });
}
