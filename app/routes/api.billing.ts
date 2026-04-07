import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  console.log("[BILLING] Upgrade triggered");

  return billing.request({
    plan: "basic",
    isTest: true,
  });
};