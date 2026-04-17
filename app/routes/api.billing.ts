import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { saveSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const chargeId = url.searchParams.get("charge_id");
  const shopParam = url.searchParams.get("shop");

  // ===============================
  // ✅ STEP 1 — AFTER APPROVAL
  // ===============================
  if (chargeId && shopParam) {
    console.log("💰 Saving subscription:", { shop: shopParam, chargeId });

    await saveSubscription(shopParam, chargeId);

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/app?shop=${shopParam}&embedded=1`,
      },
    });
  }

  // ===============================
  // 🔐 STEP 2 — AUTH
  // ===============================
  const auth = await authenticate.admin(request);

  if (auth instanceof Response) {
    return auth;
  }

  const { session, admin } = auth;
  const shop = session.shop;

  let host = url.searchParams.get("host");
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  const APP_URL = process.env.SHOPIFY_APP_URL!;
  const returnUrl = `${APP_URL}/api/billing?shop=${shop}&host=${host}`;

  console.log("🚀 Creating subscription");

  // ===============================
  // 💰 STEP 3 — CREATE BILLING
  // ===============================
  const response = await admin.graphql(`
    mutation {
      appSubscriptionCreate(
        name: "Basic Plan"
        returnUrl: "${returnUrl}"
        test: true
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 6.99, currencyCode: USD }
                interval: EVERY_30_DAYS
              }
            }
          }
        ]
      ) {
        confirmationUrl
        userErrors {
          message
        }
      }
    }
  `);

  const data = await response.json();

  console.log("🔥 BILLING RESPONSE:", JSON.stringify(data, null, 2));

  const confirmationUrl =
    data?.data?.appSubscriptionCreate?.confirmationUrl;

  if (!confirmationUrl) {
    throw new Error("No confirmationUrl");
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: confirmationUrl,
    },
  });
};