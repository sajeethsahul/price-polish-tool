import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);

    console.log("🔥 BILLING HIT:", request.url);

    // ================= AUTH =================
    const auth = await authenticate.admin(request);

    if (!auth) {
      throw new Error("Auth failed");
    }

    const { billing, session } = auth;

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
    const returnUrl = `/app?shop=${shop}&host=${host}&embedded=1`;

    console.log("✅ RETURN URL:", returnUrl);

    // ================= BILLING =================
    const result = await billing.request({
      plan: "basic",
      isTest: true,
      trialDays: 7,
      returnUrl,
    });

    console.log("✅ BILLING REQUEST SUCCESS");

    return result;

  } catch (err: any) {
    console.error("❌ BILLING CRASH:", err);

    return new Response(
      JSON.stringify({
        error: true,
        message: err?.message || "Unknown error",
      }),
      { status: 500 }
    );
  }
};