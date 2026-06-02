import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("🔥 BILLING HIT:", request.url);

  // ===============================
  // 🔐 AUTH (MANDATORY)
  // ===============================
  const auth = await authenticate.admin(request);

  // 🚨 VERY IMPORTANT — handle session-token redirects
  if (auth instanceof Response) {
    console.log("⚠️ AUTH REDIRECT");
    return auth;
  }

  const { admin, session, billing } = auth;

  // ===============================
  // 💰 BILLING FLOW (SHOPIFY HANDLED)
  // ===============================
  const result = await billing.require({
    plans: ["basic"],
    isTest: true,

    onFailure: async () => {
      console.log("🚀 Creating billing request");

      return billing.request({
        plan: "basic",
        isTest: true,
        // trialDays comes from config → no need here
      });
    },
  });

  if (!(result instanceof Response)) {
    const shop = session.shop;
  //  const { persistBillingStateFromShopify } = await import("../utils/billing-persistence.server");
    // await persistBillingStateFromShopify({
    //   admin,
    //   shop,
    //   expectedPlanName: "basic",
    //   isTest: true,
    // });
  }

  return result;
};