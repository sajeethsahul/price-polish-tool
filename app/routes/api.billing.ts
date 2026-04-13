import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);

    console.log("🔥 BILLING HIT:", request.url);

    const APP_URL = process.env.SHOPIFY_APP_URL;

    if (!APP_URL) {
      throw new Error("SHOPIFY_APP_URL missing");
    }

    // ================= AUTH =================
    const { billing, session } = await authenticate.admin(request);

    if (!session?.shop) {
      throw new Error("Missing session.shop");
    }

    const shop = session.shop;

    // ================= HOST =================
    let host = url.searchParams.get("host");

    if (!host) {
      const store = shop.replace(".myshopify.com", "");
      host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
    }

    console.log("✅ SESSION:", { shop, host });

    // ================= RETURN URL =================
    const returnUrl = `${APP_URL}/app?shop=${shop}&host=${host}&embedded=1`;

    console.log("✅ RETURN URL:", returnUrl);

    // ================= BILLING =================
    try {
      const result = await billing.request({
        plan: "basic",
        isTest: true,
        trialDays: 7,
        returnUrl,
      });

      console.log("✅ BILLING REQUEST TRIGGERED");

      // 🔥 IMPORTANT: Shopify may return Response (302)
      if (result instanceof Response) {
        return result;
      }

      return result;

    } catch (err: any) {
      console.error("❌ BILLING ERROR:", err);

      // 🔥 HANDLE ALL SHOPIFY RESPONSE ERRORS (302 / 401 etc)
      if (err instanceof Response) {
        console.log("🔁 FORWARDING SHOPIFY RESPONSE:", err.status);

        // Directly return Shopify response (CRITICAL FIX)
        return err;
      }

      throw err;
    }

  } catch (err: any) {
    console.error("❌ BILLING CRASH:", err);

    return new Response(
      JSON.stringify({
        error: true,
        message: err?.message || "Billing failed",
      }),
      { status: 500 }
    );
  }
};