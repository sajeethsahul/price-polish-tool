import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { BILLING_PLANS } from "../config/billing";

export const loader = async ({ request }: LoaderFunctionArgs) => {
 const { billing, session } = await authenticate.admin(request);

  console.log("[BILLING] Upgrade triggered");

  return billing.request({
    plan: BILLING_PLANS.BASIC.name as any,    
    isTest: true,
    returnUrl: `https://price-polish-tool.onrender.com/app?shop=${session.shop}`,
  });
};