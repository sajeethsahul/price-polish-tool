import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  try {
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
      const result: any = await billing.request({
        plan: "basic",
        isTest: true,
        trialDays: 7,
        returnUrl,
      });

      console.log("✅ BILLING RESULT:", result);

      // ✅ CASE 1 — confirmationUrl exists
      if (result?.confirmationUrl) {
        console.log("➡️ Redirecting to confirmationUrl");

        return new Response(null, {
          status: 302,
          headers: {
            Location: result.confirmationUrl,
          },
        });
      }

      // ❗ FAIL FAST (no silent fallback)
      console.error("❌ No confirmationUrl returned");

      return new Response(
        JSON.stringify({
          error: true,
          message: "Billing did not return confirmationUrl",
          debug: result,
        }),
        { status: 500 }
      );

    } catch (err: any) {
      console.error("❌ BILLING ERROR:", err);

      // ✅ CASE 2 — Shopify throws redirect Response
      if (err instanceof Response) {
        console.log("➡️ Returning Shopify redirect response");

        return err; // 🔥 CRITICAL FIX
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