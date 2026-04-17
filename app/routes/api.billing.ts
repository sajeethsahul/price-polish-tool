import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { saveSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  let shop = url.searchParams.get("shop");
  let host = url.searchParams.get("host");
  const chargeId = url.searchParams.get("charge_id");

  console.log("🧪 QUERY PARAMS:", { shop, host, chargeId });

  // ===============================
  // 🔥 STEP 1 — HOST FALLBACK (CRITICAL)
  // ===============================
  if (!host && shop) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // ===============================
  // 🔥 STEP 2 — AFTER APPROVAL
  // ===============================
  if (chargeId && shop) {
    console.log("💰 Saving subscription:", { shop, chargeId });

    await saveSubscription(shop, chargeId);

    return redirect(`/app?shop=${shop}&host=${host}&embedded=1`);
  }
  // ===============================
  // 🔐 STEP 3 — AUTHENTICATE
  // ===============================
  const auth = await authenticate.admin(request);

  // Shopify may force re-auth → just return it
  if (auth instanceof Response) {
    const location = auth.headers.get("Location");
    console.log("⚠️ AUTH REDIRECT:", location);
    return auth;
  }

  // ✅ IMPORTANT
  const { session, admin } = auth;

  // Always trust session.shop over query
  shop = session.shop;

  // Ensure host again (safety)
  if (!host && shop) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // ===============================
  // 🔗 STEP 4 — BUILD RETURN URL
  // ===============================
  const APP_URL = process.env.SHOPIFY_APP_URL!;
  const returnUrl = `${APP_URL}/api/billing?shop=${shop}&host=${host}`;

  console.log("🚀 Creating subscription via GraphQL");

  // ===============================
  // 💰 STEP 5 — CREATE BILLING
  // ===============================
  try {
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
            field
            message
          }
        }
      }
    `);

    const data = await response.json();

    console.log("🔥 GRAPHQL BILLING RESPONSE:", JSON.stringify(data, null, 2));

    const confirmationUrl =
      data?.data?.appSubscriptionCreate?.confirmationUrl;

    const errors =
      data?.data?.appSubscriptionCreate?.userErrors;

    // ===============================
    // ❌ HANDLE SHOPIFY ERRORS
    // ===============================
    if (errors && errors.length > 0) {
      console.error("❌ BILLING USER ERRORS:", errors);

      return new Response(
        JSON.stringify({
          error: true,
          message: "Shopify billing error",
          details: errors,
        }),
        { status: 500 }
      );
    }

    // ===============================
    // ✅ REDIRECT TO APPROVAL PAGE
    // ===============================
    if (confirmationUrl) {
      console.log("➡️ Redirecting to Shopify billing page");

      return new Response(null, {
        status: 302,
        headers: {
          Location: confirmationUrl,
        },
      });
    }

    // ===============================
    // ❌ SAFETY FALLBACK
    // ===============================
    console.error("❌ No confirmationUrl returned");

    return new Response(
      JSON.stringify({
        error: true,
        message: "No confirmation URL returned",
      }),
      { status: 500 }
    );

  } catch (err: any) {
    console.error("❌ GRAPHQL BILLING CRASH:", err);

    return new Response(
      JSON.stringify({
        error: true,
        message: err?.message || "Billing failed",
      }),
      { status: 500 }
    );
  }
};
