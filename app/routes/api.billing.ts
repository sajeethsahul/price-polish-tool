// app/routes/api.billing.ts
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

interface BillingRequestResult {
  confirmationUrl?: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const { billing, session } = await authenticate.admin(request);

  const shop = session.shop;
  let host = url.searchParams.get("host");
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  const APP_URL = process.env.SHOPIFY_APP_URL!;
  // Detect return is no longer used once returnUrl goes to /app, so you can remove:
  // const hasChargeId = url.searchParams.has("charge_id");

  const rawResult = await billing.request({
    plan: "basic",
    isTest: true,
    trialDays: 7,
    // After approval, Shopify will go here (embedded app)
    returnUrl: `${APP_URL}/app?shop=${shop}&host=${host}&embedded=1`,
  });

  const result = rawResult as BillingRequestResult;

  if (!result || !result.confirmationUrl) {
    throw new Response("Billing creation failed", { status: 500 });
  }

  return json({ confirmationUrl: result.confirmationUrl as string });
};