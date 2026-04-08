import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { BILLING_PLANS } from "../config/billing";

export const loader = async ({ request }: LoaderFunctionArgs) => {
 const { billing, session } = await authenticate.admin(request);

  console.log("[BILLING] Upgrade triggered");

  return billing.request({
    plan: BILLING_PLANS.BASIC.name as any,    
    isTest: true,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app?shop=${session.shop}&host=${Buffer.from(`admin.shopify.com/store/${session.shop.replace(".myshopify.com", "")}`).toString("base64")}&embedded=1`,
  });
};