import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { saveSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const chargeId = url.searchParams.get("charge_id");
  const shopParam = url.searchParams.get("shop");

  // 🔥 STEP 1 — AFTER APPROVAL
  if (chargeId && shopParam) {
    console.log("💰 Saving subscription:", { shop: shopParam, chargeId });

    await saveSubscription(shopParam, chargeId);

    return redirect(`/app?shop=${shopParam}&embedded=1`);
  }

  // 🔥 STEP 2 — AUTH
  const auth = await authenticate.admin(request);

  if (auth instanceof Response) {
    return auth;
  }

  const { billing, session } = auth;

  const shop = session.shop;

  let host = url.searchParams.get("host");
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  const APP_URL = process.env.SHOPIFY_APP_URL!;
  const returnUrl = `${APP_URL}/api/billing?shop=${shop}&host=${host}`;

  console.log("🚀 billing.require triggered");

  // 🔥🔥🔥 THIS IS THE FIX
  return billing.require({
    plans: ["basic"],
    isTest: true,
    onFailure: async () => {
      const result: any = await billing.request({
        plan: "basic",
        isTest: true,
        trialDays: 7,
        returnUrl,
      });

      if (result?.confirmationUrl) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: result.confirmationUrl,
          },
        });
      }

      throw new Error("No confirmationUrl");
    },
  });
};