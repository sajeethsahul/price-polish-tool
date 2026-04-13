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
  if (!shop) {
    throw new Response("Missing shop in session", { status: 401 });
  }

  let host = url.searchParams.get("host");
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  const APP_URL = process.env.SHOPIFY_APP_URL;
  if (!APP_URL) {
    throw new Error("SHOPIFY_APP_URL missing");
  }

  // app/routes/api.billing.ts
  const rawResult = await billing.request({
    plan: "basic",
    isTest: true,
    trialDays: 7,
    returnUrl: `https://price-polish-tool.onrender.com/shopify/billing/success?shop=${shop}&host=${host}&embedded=1`,
  });

  const result = rawResult as BillingRequestResult;

  if (!result || !result.confirmationUrl) {
    throw new Response("Billing creation failed", { status: 500 });
  }

  return json({ confirmationUrl: result.confirmationUrl as string });
};