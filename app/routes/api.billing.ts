import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  console.log("🔥 BILLING HIT:", request.url);

  const APP_URL = process.env.SHOPIFY_APP_URL;
  if (!APP_URL) {
    throw new Error("SHOPIFY_APP_URL missing");
  }

  // ================= AUTH =================
  const authOrResponse = await authenticate.admin(request);

  // 🔁 Shopify may return redirect response (reauth)
  if (authOrResponse instanceof Response) {
    console.log("🔁 Returning Shopify auth Response");
    return authOrResponse;
  }

  const { billing, session } = authOrResponse;
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

  // ================= BILLING FLOW =================
  try {
    console.log("🔥 BILLING REQUIRE FLOW");

    const response = await billing.require({
      plans: ["basic"],     // MUST match config
      isTest: true,
      onFailure: async () => {
        console.log("➡️ No active plan → creating charge");

        return billing.request({
          plan: "basic",
          isTest: true,
          trialDays: 7,
          returnUrl,
        });
      },
    });

    // 🔁 VERY IMPORTANT: return Shopify response directly
    if (response instanceof Response) {
      console.log("🔁 Returning Shopify billing response");
      return response;
    }

    // ✅ If no redirect → user already has active plan
    console.log("✅ Active plan already exists");

    return new Response(null, {
      status: 302,
      headers: {
        Location: returnUrl,
      },
    });

  } catch (err: any) {
    console.error("❌ BILLING ERROR:", err);

    // 🔁 Shopify throws Response → MUST return directly
    if (err instanceof Response) {
      console.log("🔁 Returning thrown Shopify billing response");
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
      }
    );
  }
};