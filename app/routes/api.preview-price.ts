import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";
import { calculatePrice } from "../utils/pricing";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";
import type { PricingPreviewItem } from "../types/pricing";
import { applyLocaleFromSession, t } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const auth = await authenticate.admin(request);

    if (!auth?.session) {
        throw new Response("Unauthorized", { status: 401 });
    }

    const { admin, session } = auth;
    const shop = session.shop;
    applyLocaleFromSession(session);
    const previewStartMs = Date.now();

    console.log("[PREVIEW] preview.started", { shop });

    try {
        const rule = await prisma.pricingRule.findUnique({
            where: { shop },
        });

        const markupPercent = rule?.markupPercent ?? 10;
        const charmPricing = rule?.charmPricing ?? true;
        const roundingStep = rule?.roundingStep ?? 1;
        const endingOption = rule?.endingOption ?? (charmPricing ? "0.99" : (roundingStep > 0 ? Number(roundingStep).toFixed(2) : "none"));
        const roundingPrecision = rule?.roundingPrecision ?? "standard";
        const minPrice = rule?.minPrice ?? null;
        const maxPrice = rule?.maxPrice ?? null;
        const adjustmentType = rule?.adjustmentType ?? "percentage";
        const adjustmentDirection = adjustmentType === "percentage"
          ? (markupPercent < 0 ? "decrease" : "increase")
          : (rule?.adjustmentDirection ?? "increase");
        const adjustmentValue = adjustmentType === "percentage"
          ? Math.abs(markupPercent)
          : (rule?.adjustmentValue ?? 0);

        const MAX_PAGES = 20;
        const PAGE_SIZE = 100;
        const TIMEOUT_MS = 25000;

        let cursor: string | null = null;
        let hasNextPage = true;
        let pageCount = 0;
        let truncated = false;
        const allProducts: any[] = [];
        let totalCount = 0;

        while (hasNextPage && pageCount < MAX_PAGES) {
            if (Date.now() - previewStartMs > TIMEOUT_MS) {
                console.warn("[PREVIEW] preview.timeout.warning", {
                    shop,
                    pageCount,
                    totalFetched: allProducts.length,
                    durationMs: Date.now() - previewStartMs,
                    reason: "Hard timeout guard (25s) reached",
                });
                truncated = true;
                break;
            }

            pageCount++;

            const response = await admin.graphql(
                `query GetPreviewProducts($cursor: String) {
                  products(first: ${PAGE_SIZE}, after: $cursor) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    nodes {
                      id
                      title
                      status
                      productType
                      vendor
                      featuredImage {
                        url
                      }
                      variants(first: 100) {
                        nodes {
                          id
                          title
                          sku
                          price
                          compareAtPrice
                          inventoryQuantity
                        }
                      }
                    }
                  }
                  productsCount {
                    count
                  }
                }`,
                {
                    variables: {
                        cursor,
                    },
                }
            );

            const data: any = await response.json();

            if (data.errors) {
                console.error("[PREVIEW] preview.graphql.error", { shop, errors: data.errors });
            }

            if (totalCount === 0 && data?.data?.productsCount?.count != null) {
                totalCount = data.data.productsCount.count;
            }

            const pageNodes = data?.data?.products?.nodes || [];
            allProducts.push(...pageNodes);

            const pageInfo = data?.data?.products?.pageInfo;
            hasNextPage = pageInfo?.hasNextPage ?? false;
            cursor = pageInfo?.endCursor ?? null;

            if (!hasNextPage || !cursor) {
                break;
            }

            if (pageCount >= MAX_PAGES && hasNextPage) {
                console.warn("[PREVIEW] preview.page_limit.warning", {
                    shop,
                    pageCount,
                    totalFetched: allProducts.length,
                    reason: "Max 20 pages reached (2,000 products cap)",
                });
                truncated = true;
                break;
            }
        }

        const totalFetched = allProducts.length;

        if (totalCount > 0 && totalFetched === 0) {
            console.warn("[PREVIEW] preview.access.warning", { shop, totalCount, accessibleCount: totalFetched, reason: "products exist but are not accessible to this app" });
        }

        // ✅ REPLACED: Promise.all with N+1 queries.
        // 🚀 OPTIMIZATION: Fetch history in bulk
        const variantIds: string[] = [];
        for (const product of allProducts) {
            const variantNodes = product?.variants?.nodes || [];
            for (const variant of variantNodes) {
                if (variant?.id) {
                    variantIds.push(variant.id);
                }
            }
        }

        const uniqueVariantIds = Array.from(new Set(variantIds));

        const histories = uniqueVariantIds.length > 0
            ? await prisma.priceHistory.findMany({
                where: { variantId: { in: uniqueVariantIds }, shop },
                orderBy: { createdAt: "desc" },
            })
            : [];

        // Create a map for the LATEST history per variant
        const latestHistoryMap: Record<string, any> = {};
        histories.forEach((h: any) => {
            if (!latestHistoryMap[h.variantId]) {
                latestHistoryMap[h.variantId] = h;
            }
        });

        const lastUpdate = await prisma.priceHistory.findFirst({
            where: { shop },
            orderBy: { createdAt: "desc" },
        });

        const previews: PricingPreviewItem[] = [];

        for (const product of allProducts) {
            const variantNodes = product?.variants?.nodes || [];
            for (const variant of variantNodes) {
                const variantId = variant?.id || "";
                const currentPrice = parseFloat(variant?.price ?? "0");
                const compareAtPrice = Number(variant?.compareAtPrice ?? NaN);

                const history = latestHistoryMap[variantId];
                const historyOld = history ? parseFloat(String(history.oldPrice)) : NaN;
                const historyNew = history ? parseFloat(String(history.newPrice)) : NaN;

                // Baseline rules:
                // - Normal (rule-based) applies keep using the prior baseline (history.oldPrice) to avoid compounding.
                // - Manual applies become the NEW storefront baseline once Shopify reflects the manual value.
                const basePrice =
                    history &&
                    history.isManual === true &&
                    isFinite(historyNew) &&
                    currentPrice === historyNew
                        ? currentPrice
                        : (isFinite(historyOld) ? historyOld : currentPrice);

                const newPrice = calculatePrice(basePrice, {
                    adjustmentType,
                    adjustmentDirection,
                    adjustmentValue,
                    endingOption,
                    roundingPrecision,
                    minPrice,
                    maxPrice,
                });

                previews.push({
                    productId: product.id,
                    title: product.title,
                    variantTitle: variant?.title ?? "",
                    sku: variant?.sku ?? null,
                    image: product.featuredImage?.url ?? "",
                    variantId: variantId,
                    oldPrice: currentPrice.toFixed(2),
                    newPrice: newPrice.toFixed(2),
                    originalBasePrice: basePrice.toFixed(2),
                    compareAtPrice: Number.isFinite(compareAtPrice) ? compareAtPrice.toFixed(2) : null,
                    storefrontVariantPrice: currentPrice.toFixed(2),
                    originalVariantPrice: basePrice.toFixed(2),
                    productType: product.productType ?? "",
                    vendor: product.vendor ?? "",
                    inventoryQuantity: variant?.inventoryQuantity ?? 0,
                });
            }
        }

        // ruleExists: true only when a real PricingRule DB row exists for this shop
        // (previews are always returned using defaults if no rule exists)
        const ruleExists = rule !== null;
        await logActivity(shop, "PREVIEW_CLICKED", { count: previews.length });

        const now = new Date();
        const existingState = await prisma.appState.findUnique({
          where: { shop },
          select: { onboardingFirstPreviewAt: true, isLive: true },
        });

        if (!existingState?.onboardingFirstPreviewAt) {
          await prisma.appState.upsert({
            where: { shop },
            update: { onboardingFirstPreviewAt: now },
            create: { shop, isLive: existingState?.isLive ?? false, onboardingFirstPreviewAt: now },
          });
        }

        console.log("[PREVIEW] preview.completed", {
            shop,
            totalFetched,
            truncated,
            productCount: previews.length,
            ruleExists,
            durationMs: Date.now() - previewStartMs,
        });

        return cors(new Response(JSON.stringify({
            previews,
            truncated,
            totalFetched,
            markupPercent,
            roundingStep,
            charmPricing,
            adjustmentType,
            adjustmentDirection,
            adjustmentValue,
            endingOption,
            roundingPrecision,
            minPrice,
            maxPrice,
            ruleExists,
            lastUpdate,
        }), {
            headers: { "Content-Type": "application/json" },
        }));
    } catch (error: any) {
        console.error("[PREVIEW] preview.failed", { shop, error: error?.message ?? "unknown", durationMs: Date.now() - previewStartMs });

        try {
            await logActivity(shop, "ERROR", {
                action: "PREVIEW_LOAD",
                message: error?.message || "unknown-error",
            });
        } catch (logError) {
            console.error("[PREVIEW] preview.activity.failed", { shop });
        }

        return cors(new Response(JSON.stringify({
            error: t("server.previewLoadFailed"),
            debug: error?.message || "unknown-error"
        }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        }));
    }
};
