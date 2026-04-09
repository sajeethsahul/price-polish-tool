// app/routes/api.billing.ts
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Shape we expect from billing.request()
interface BillingRequestResult {
  confirmationUrl?: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // ✅ Authenticate with Shopify admin
  const { billing, session } = await authenticate.admin(request);

  const shop = session.shop;
  if (!shop) {
    throw new Response("Missing shop in session", { status: 401 });
  }

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

  // 🔁 Detect return from billing (Shopify sends charge_id)
  const hasChargeId = url.searchParams.has("charge_id");

  // if (hasChargeId) {
  //   console.log("[BILLING RETURN DETECTED]");
  //   // Tell client there is no new confirmation URL → it should reload /app
  //   return json({ confirmationUrl: null as string | null });
  // }

  // ✅ Normal billing request: create charge and get confirmationUrl
const rawResult = await billing.request({
  plan: "basic",
  isTest: true,
  trialDays: 7,
  // ✅ After approval, go back into embedded app
  returnUrl: `${APP_URL}/app?shop=${shop}&host=${host}&embedded=1`,
});

  // Explicitly assert the shape so TS knows confirmationUrl exists
  const result = rawResult as BillingRequestResult;

  if (!result || !result.confirmationUrl) {
    console.error("[BILLING] No confirmationUrl", result);
    throw new Response("Billing creation failed", { status: 500 });
  }

  return json({ confirmationUrl: result.confirmationUrl as string });
};