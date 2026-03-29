import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";
import { calculatePrice } from "../utils/pricing";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    console.log("DEBUG BACKEND: Authenticated session for shop:", shop);

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
            edges {
              node {
                id
                title
                status
                featuredImage {
                  url
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                    }
                  }
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
        const edges = data?.data?.products?.edges || [];
        
        console.log(`DEBUG BACKEND: [DIAGNOSTIC] Total Count in Store: ${totalCount}`);
        console.log(`DEBUG BACKEND: [DIAGNOSTIC] Accessible Edges: ${edges.length}`);
        
        if (totalCount > 0 && edges.length === 0) {
            console.warn("DEBUG BACKEND: [CRITICAL] Count > 0 but Edges = 0. Products exist but are NOT accessible to this app. Check Sales Channel permissions.");
            if (data.data.products?.edges) {
               console.log("DEBUG BACKEND: products block found but empty.");
            } else {
               console.error("DEBUG BACKEND: products block is MISSING from response.");
            }
        }

        interface ProductNode {
            id: string;
            title: string;
            featuredImage?: {
                url: string;
            };
            variants: {
                edges: Array<{
                    node: {
                        id: string;
                        price: string;
                    };
                }>;
            };
        }

        const previews = await Promise.all(edges.map(
            async (edge: { node: ProductNode }) => {
                const product = edge.node;
                const variant = product.variants.edges[0]?.node;
                const currentPrice = parseFloat(variant?.price ?? "0");

                // Check PriceHistory for the "original" base price
                // This prevents "Double Markup" if the user has already applied a change
                const history = await prisma.priceHistory.findFirst({
                    where: { variantId: variant?.id, shop },
                    orderBy: { createdAt: "desc" },
                });

                // Use the oldest available price as the base for calculations
                const basePrice = history ? history.oldPrice : currentPrice;

                // If the last change was manual, we respect the user's choice as final
                // and don't suggest a new price based on rules unless the current price
                // has changed from what we last set.
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
                    image: product.featuredImage?.url ?? "",
                    variantId: variant?.id ?? "",
                    oldPrice: currentPrice.toFixed(2),
                    newPrice: newPrice.toFixed(2),
                    originalBasePrice: basePrice.toFixed(2), // NEW
                };
            },
        ));

        await logActivity(shop, "PREVIEW_CLICKED", { count: previews.length });

        return cors(new Response(JSON.stringify({ previews, markupPercent }), {
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
