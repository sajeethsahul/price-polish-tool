import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // ✅ Authenticate
  const { billing, session } = await authenticate.admin(request);

  const shop = session.shop;

  // 🔥 HOST (safe)
  let host = url.searchParams.get("host");

  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  const APP_URL = process.env.SHOPIFY_APP_URL;

  if (!APP_URL) {
    throw new Error("SHOPIFY_APP_URL missing");
  }

  // 🔥 IMPORTANT FIX → prevent re-trigger loop
  const hasChargeId = url.searchParams.has("charge_id");

  if (hasChargeId) {
    console.log("[BILLING RETURN DETECTED]");

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/app?shop=${shop}&host=${host}&embedded=1`,
      },
    });
  }

  // ✅ Normal billing request
  return billing.request({
    plan: "basic",
    isTest: true,
    trialDays: 7,
    returnUrl: `${APP_URL}/app?shop=${shop}&host=${host}&embedded=1`,
  });
};