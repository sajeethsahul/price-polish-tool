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
      const result: any = await billing.request({
        plan: "basic",
        isTest: true,
        trialDays: 7,
        returnUrl,
      });

      console.log("✅ BILLING REQUEST TRIGGERED");

      // 🔥 SAFE CHECK (instead of instanceof)
      if (result && typeof result === "object" && "status" in result) {
        return result;
      }

      return result;

    } catch (err: any) {
      console.error("❌ BILLING ERROR:", err);

      // 🔥 HANDLE SHOPIFY RESPONSE (302 / 401)
      if (err && typeof err === "object" && "status" in err) {
        console.log("🔁 RETURNING SHOPIFY RESPONSE:", err.status);
        return err;
      }

      return new Response(
        JSON.stringify({
          error: true,
          message: err?.message || "Billing failed",
        }),
        { status: 500 }
      );
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