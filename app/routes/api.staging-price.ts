import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { calculatePrice } from "../utils/pricing";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = await request.json();

  const products = body?.products || [];

  const rule = await prisma.pricingRule.findUnique({
    where: { shop: session.shop },
  });

  if (!rule) {
    return new Response(JSON.stringify({ error: "No pricing rule" }), { status: 400 });
  }

  if (!Array.isArray(products) || products.length === 0) {
    console.warn("⚠️ No products received for staging");
  
    return new Response(
      JSON.stringify({ success: false, message: "No products available to apply pricing changes." }),
      { status: 400 }
    );
  }

  const staged = products.map((p: any) => ({
    shop: session.shop,
    variantId: p.variantId,
    productId: p.productId,
    originalPrice: Number(p.oldPrice),
    stagedPrice: calculatePrice(
        Number(p.newPrice),
        rule.markupPercent,
        rule.roundingStep,
        rule.charmPricing
      ),
  }));

  await prisma.stagedPrice.deleteMany({ where: { shop: session.shop } });

  await prisma.stagedPrice.createMany({ data: staged });

  return new Response(JSON.stringify({ success: true }));
};