import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const url = new URL(request.url);

    // 🔥 AUTH
    const { billing, session } = await authenticate.admin(request);

    if (!session?.shop) {
      throw new Error("No session.shop found");
    }

    const shop = session.shop;

    // 🔥 HOST (SAFE)
    let host = url.searchParams.get("host");

    if (!host) {
      const store = shop.replace(".myshopify.com", "");
      host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
    }

    console.log("[BILLING] START", { shop, host });

    // 🔥 IMPORTANT: USE RELATIVE RETURN URL
    const returnUrl = `/app?shop=${shop}&host=${host}&embedded=1`;

    console.log("[BILLING] RETURN URL:", returnUrl);

    // 🔥 BILLING REQUEST
    return billing.request({
      plan: "basic",
      isTest: true,
      trialDays: 7,
      returnUrl,
    });

  } catch (error: any) {
    console.error("❌ BILLING ERROR:", error);

    return new Response(
      JSON.stringify({
        error: "Billing failed",
        message: error?.message,
      }),
      { status: 500 }
    );
  }
};