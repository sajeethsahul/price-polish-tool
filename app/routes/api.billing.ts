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

  // ─── BILLING CALLBACK: approval flow completed ───────────────────────────────
  // `result` is the Shopify billing context — NOT a redirect Response.
  // It contains appSubscriptions[] which is all we need to persist the snapshot.
  if (!(result instanceof Response)) {
    const shop = session.shop;
    console.log(`[BILLING CALLBACK] shop=${shop} billing approved`);

    try {
      const { persistBillingStateFromShopify } = await import(
        "../utils/billing-persistence.server"
      );
      await persistBillingStateFromShopify({
        shop,
        billingResult: result as unknown as Record<string, unknown>,
        expectedPlanName: "basic",
        isTest: true,
      });
      console.log(`[BILLING CALLBACK SYNC] shop=${shop} subscription record persisted`);
    } catch (err) {
      console.error(
        `[BILLING CALLBACK ERROR] shop=${shop} error=${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // Fail-safe: persistence errors never block the merchant flow.
    }
  }

  return result;
};