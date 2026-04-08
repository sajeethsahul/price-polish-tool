import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // ✅ Authenticate
  const { billing, session } = await authenticate.admin(request);

  // 🔥 Extract shop
  const shop = session.shop;

  // 🔥 Extract host from URL (CRITICAL)
  let host = url.searchParams.get("host");

  // Fallback if missing
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // 🔥 APP URL (from env)
  const APP_URL = process.env.SHOPIFY_APP_URL;

  if (!APP_URL) {
    throw new Error("SHOPIFY_APP_URL missing");
  }

  // ✅ Request billing
  return billing.request({
    plan: "basic", // or "pro" based on your config
    isTest: true,
    returnUrl: `${APP_URL}/app?shop=${shop}&host=${host}&embedded=1`,
    trialDays: 7
  });
};