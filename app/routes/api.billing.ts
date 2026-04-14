import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log("🔥 BILLING HIT:", request.url);

  const APP_URL = process.env.SHOPIFY_APP_URL;
  if (!APP_URL) {
    throw new Error("SHOPIFY_APP_URL missing");
  }

  // 1) Authenticate admin
  const authOrResponse = await authenticate.admin(request);

  // Shopify may return a Response (reauth / redirect) – just return it
  if (authOrResponse instanceof Response) {
    console.log("🔁 Returning Shopify auth Response");
    return authOrResponse;
  }

  const { billing, session } = authOrResponse;
  const shop = session.shop;

  // 2) Resolve host
  let host = url.searchParams.get("host");
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  console.log("✅ SESSION:", { shop, host });

  // 3) Return URL back into /app
  const returnUrl = `${APP_URL}/app?shop=${shop}&host=${host}&embedded=1`;
  console.log("✅ RETURN URL:", returnUrl);

  // 4) Billing request
  try {
    const result: any = await billing.request({
      plan: "basic",          // must match your billing config key
      isTest: true,           // keep true in dev
      trialDays: 7,           // or BILLING_PLANS.BASIC.trialDays
      returnUrl,
    });

    console.log("✅ BILLING RESULT:", result);

    // CASE A: Object with confirmationUrl → redirect to it
    if (result && typeof result === "object" && "confirmationUrl" in result) {
      console.log("➡️ Redirecting to confirmationUrl");
      return new Response(null, {
        status: 302,
        headers: {
          Location: result.confirmationUrl,
        },
      });
    }

    // CASE B: Shopify already returned a Response (often 302)
    if (result instanceof Response) {
      console.log("🔁 Returning Shopify billing Response");
      return result;
    }

    // CASE C: Unexpected shape
    console.error("❌ Billing returned unexpected result", result);
    return new Response(
      JSON.stringify({
        error: true,
        message: "Billing failed: unexpected result",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("❌ BILLING ERROR:", err);

    // If Shopify throws a Response (redirect / error), return it
    if (err instanceof Response) {
      console.log("🔁 Returning thrown Shopify billing Response");
      return err;
    }

    return new Response(
      JSON.stringify({
        error: true,
        message: err?.message || "Billing failed",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};