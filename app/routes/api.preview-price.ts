import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { calculatePrice } from "../utils/pricing";
import prisma from "../db.server";
import { logActivity } from "../utils/activity.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

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
        }
      `);

        const data = await response.json();

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

        const previews = data.data.products.edges.map(
            (edge: { node: ProductNode }) => {
                const product = edge.node;
                const variant = product.variants.edges[0]?.node;
                const oldPrice = parseFloat(variant?.price ?? "0");
                const newPrice = calculatePrice(
                    oldPrice,
                    markupPercent,
                    roundingStep,
                    charmPricing,
                );

                return {
                    productId: product.id,
                    title: product.title,
                    image: product.featuredImage?.url ?? "",
                    variantId: variant?.id ?? "",
                    oldPrice: oldPrice.toFixed(2),
                    newPrice: newPrice.toFixed(2),
                };
            },
        );

        await logActivity(shop, "PREVIEW_CLICKED", { count: previews.length });

        return new Response(JSON.stringify({ previews }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        await logActivity(shop, "ERROR", { action: "PREVIEW_LOAD", message: error.message });
        return new Response(JSON.stringify({ error: "Failed to load preview data" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
