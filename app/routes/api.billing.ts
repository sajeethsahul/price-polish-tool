import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { saveSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const chargeId = url.searchParams.get("charge_id");
  const shop = url.searchParams.get("shop");

  // 🔥 STEP 1 — AFTER APPROVAL (MOST IMPORTANT)
  if (chargeId && shop) {
    console.log("💰 Saving subscription:", { shop, chargeId });

    await saveSubscription(shop, chargeId);

    return redirect(`/app?shop=${shop}&embedded=1`);
  }

  // 🔥 STEP 2 — START BILLING FLOW
  const auth = await authenticate.admin(request);

  if (auth instanceof Response) {
    return auth;
  }

  const { billing, session } = auth;

  if (!session?.shop) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const currentShop = session.shop;

  let host = url.searchParams.get("host");
  if (!host) {
    const store = currentShop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  const APP_URL = process.env.SHOPIFY_APP_URL!;
  const returnUrl = `${APP_URL}/api/billing?shop=${currentShop}&host=${host}`;

  console.log("🚀 Creating billing request");

  const result: any = await billing.request({
    plan: "basic",
    isTest: true,
    trialDays: 7,
    returnUrl,
  });

  // ✅ Redirect to Shopify approval page
  if (result?.confirmationUrl) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: result.confirmationUrl,
      },
    });
  }

  throw new Error("Billing failed: no confirmationUrl");
};