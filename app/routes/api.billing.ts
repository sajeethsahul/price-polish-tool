import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  console.log("🔥 BILLING HIT:", request.url);

  // ================= AUTH =================
  const auth = await authenticate.admin(request);

  if (auth instanceof Response) {
    return auth;
  }

  const { billing, session } = auth;
  const shop = session.shop;

  // ================= HOST =================
  let host = url.searchParams.get("host");

  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // ================= RETURN URL =================
  const APP_URL = process.env.SHOPIFY_APP_URL!;
  const returnUrl = `${APP_URL}/app?shop=${shop}&host=${host}&embedded=1`;

  console.log("✅ RETURN URL:", returnUrl);

  // ================= BILLING =================
  try {
    const result: any = await billing.request({
      plan: "basic",
      isTest: true,  
      returnUrl,
    });

   console.log("🔥 BILLING RESULT FULL:", JSON.stringify(result, null, 2));

    // ✅ CASE 1 — Shopify returns Response
    if (result instanceof Response) {
      return result;
    }

    // ✅ CASE 2 — confirmationUrl
    if (result?.confirmationUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: result.confirmationUrl,
        },
      });
    }

    // ❌ Unexpected
    return new Response(
      JSON.stringify({
        error: true,
        message: "Billing failed: no confirmationUrl",
      }),
      { status: 500 }
    );

  } catch (err: any) {
    console.error("❌ BILLING ERROR:", err);

    if (err instanceof Response) {
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
};