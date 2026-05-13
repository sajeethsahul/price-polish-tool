import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";
import { calculatePrice } from "../utils/pricing";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const auth = await authenticate.admin(request);

    if (!auth?.session) {
        console.error("NO SESSION FOUND IN REQUEST");
        throw new Response("Unauthorized", { status: 401 });
    }

    const { admin, session } = auth;
    const shop = session.shop;
    console.log("SESSION SHOP:", shop);

    try {
        const rule = await prisma.pricingRule.findUnique({
            where: { shop },
        });

        const markupPercent = rule?.markupPercent ?? 10;
        const charmPricing = rule?.charmPricing ?? true;
        const roundingStep = rule?.roundingStep ?? 1;

        const response = await admin.graphql(`
        {
          products(first: 250) {
            nodes {
              id
              title
              status
              featuredImage {
                url
              }
              variants(first: 1) {
                nodes {
                  id
                  title
                  price
                }
              }
            }
          }
          productsCount {
            count
          }
        }
      `);

        const data: any = await response.json();

        console.log(`DEBUG BACKEND: GraphQL response status: ${response.status} for shop: ${shop}`);
        if (data.errors) {
            console.error("DEBUG BACKEND ERRORS: Shopify returned GraphQL errors:", JSON.stringify(data.errors, null, 2));
        }

        const totalCount = data?.data?.productsCount?.count ?? 0;
        const nodes = data?.data?.products?.nodes || [];

        console.log(`DEBUG BACKEND: [DIAGNOSTIC] Total Count in Store: ${totalCount}`);
        console.log(`DEBUG BACKEND: [DIAGNOSTIC] Accessible Nodes: ${nodes.length}`);

        if (totalCount > 0 && nodes.length === 0) {
            console.warn("DEBUG BACKEND: [CRITICAL] Count > 0 but Nodes = 0. Products exist but are NOT accessible to this app.");
        }

        // ✅ REPLACED: Promise.all with N+1 queries. 
        // 🚀 OPTIMIZATION: Fetch history in bulk
        const variantIds = nodes
            .map((p: any) => p.variants.nodes[0]?.id)
            .filter(Boolean);

        const histories = await prisma.priceHistory.findMany({
            where: { variantId: { in: variantIds }, shop },
            orderBy: { createdAt: "desc" },
        });

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

        const previews = nodes.map((product: any) => {
            const variant = product.variants.nodes[0];
            const variantId = variant?.id || "";
            const currentPrice = parseFloat(variant?.price ?? "0");

            const history = latestHistoryMap[variantId];
            const basePrice = history ? history.oldPrice : currentPrice;

            let newPrice;
            if (history?.isManual && currentPrice === history.newPrice) {
                newPrice = currentPrice;
            } else {
                newPrice = calculatePrice(
                    basePrice,
                    markupPercent,
                    roundingStep,
                    charmPricing,
                );
            }

            return {
                productId: product.id,
                title: product.title,
                variantTitle: variant?.title ?? "",
                image: product.featuredImage?.url ?? "",
                variantId: variantId,
                oldPrice: currentPrice.toFixed(2),
                newPrice: newPrice.toFixed(2),
                originalBasePrice: basePrice.toFixed(2),
            };
        });

        // ruleExists: true only when a real PricingRule DB row exists for this shop
        // (previews are always returned using defaults if no rule exists)
        const ruleExists = rule !== null;
        console.log("RETURNING PRODUCTS:", previews.length, "| ruleExists:", ruleExists);
        await logActivity(shop, "PREVIEW_CLICKED", { count: previews.length });

        return cors(new Response(JSON.stringify({
            previews,
            markupPercent,
            ruleExists,
            lastUpdate,
        }), {
            headers: { "Content-Type": "application/json" },
        }));
    } catch (error: any) {
        await logActivity(shop, "ERROR", { action: "PREVIEW_LOAD", message: error.message });
        return cors(new Response(JSON.stringify({ error: "Failed to load preview data" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        }));
    }
};
