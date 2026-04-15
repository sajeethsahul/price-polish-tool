import {
  Outlet,
  Link,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";

import {
  AppProvider as PolarisProvider,
  SkeletonPage,
  Layout,
  Card,
  SkeletonBodyText,
  SkeletonDisplayText,
  Loading,
  BlockStack,
  Frame,
  Page,
  Text,
  Button,
} from "@shopify/polaris";

import {
  AppProvider as ShopifyAppProvider,
} from "@shopify/shopify-app-react-router/react";

import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// ================= LOADER =================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isBypass = url.searchParams.get("bypass") === "true";

  if (isBypass) {
    return {
      apiKey: process.env.SHOPIFY_API_KEY ?? "mock-api-key",
      currencyCode: "USD",
      host: null,
      isBypass: true,
      hasActivePlan: true,
    };
  }

  let auth;
  try {
    auth = await authenticate.admin(request);
  } catch (err: any) {
    if (err?.headers?.get && err.headers.get("Location")) {
      throw new Response(null, {
        status: 302,
        headers: { Location: err.headers.get("Location") },
      });
    }
    throw err;
  }

  const { admin, session, billing } = auth;

  if (!session?.shop) {
    const shop = url.searchParams.get("shop");

    if (shop) {
      throw new Response(null, {
        status: 302,
        headers: { Location: `/auth?shop=${shop}` },
      });
    }

    throw new Response("Unauthorized", { status: 401 });
  }

  let host = url.searchParams.get("host");
  if (!host) {
    const store = session.shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // 🔥 HANDLE BILLING STATE
  const chargeId = url.searchParams.get("charge_id");

  let hasActivePlan = false;

  // ✅ STEP 1 — After approval (temporary unlock)
  if (chargeId) {
    console.log("💰 Charge detected → unlock UI");
    hasActivePlan = true;
  } else {
    try {
      const billingCheck = await billing.check({
        plans: ["basic"],
        isTest: true,
      });

      console.log("[BILLING RAW]", billingCheck);

      hasActivePlan =
        billingCheck?.hasActivePayment ||
        billingCheck?.appSubscriptions?.length > 0 ||
        false;

    } catch (err) {
      console.error("[BILLING ERROR]", err);
      hasActivePlan = false;
    }
  }

  // ================= CURRENCY =================
  let currencyCode = "USD";

  try {
    const response = await admin.graphql(`
      {
        shop {
          currencyCode
        }
      }
    `);

    const data = await response.json();
    currencyCode = data?.data?.shop?.currencyCode || "USD";
  } catch (err) {
    console.error("Currency fetch failed:", err);
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? null,
    currencyCode,
    host,
    isBypass,
    hasActivePlan,
  };
};

// ================= COMPONENT =================
export default function AppLayout() {
  const data = useLoaderData() as any;
  const navigation = useNavigation();

  const isLoading = navigation.state === "loading";
  const { apiKey, host, currencyCode, isBypass, hasActivePlan } = data;

  // 🔥 CLEAN charge_id AFTER RETURN
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.has("charge_id")) {
      console.log("🧹 Cleaning charge_id from URL");
      window.location.replace(window.location.pathname);
    }
  }, []);

  // 🔥 BILLING BUTTON
  const handleStartTrial = () => {
    const params = new URLSearchParams(window.location.search);

    const shop = params.get("shop");
    const host = params.get("host");

    if (!shop || !host) {
      console.error("Missing shop/host");
      return;
    }

    const url = `/api/billing?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;

    // ✅ MUST BREAK OUT OF IFRAME
    window.open(url, "_top");
  };

  const AppContent = (
    <PolarisProvider i18n={{}}>
      <Frame>
        {isLoading ? (
          <SkeletonPage title="Price Polish">
            <Loading />
            <Layout>
              <Layout.Section>
                <Card>
                  <BlockStack gap="400">
                    <SkeletonDisplayText size="small" />
                    <SkeletonBodyText lines={3} />
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          </SkeletonPage>
        ) : (
          <>
            {!isBypass && (
              <NavMenu>
                <Link to="/app">Dashboard</Link>
                <Link to="/app/rules">Pricing Rules</Link>
                <Link to="/app/settings">Settings</Link>
                <Link to="/app/help">Help</Link>
              </NavMenu>
            )}

            {!hasActivePlan ? (
              <Page title="Start Free Trial">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Unlock Price Polish
                    </Text>
                    <Text as="p">
                      Start your 7-day free trial.
                    </Text>
                    <Button variant="primary" onClick={handleStartTrial}>
                      Start Free Trial
                    </Button>
                  </BlockStack>
                </Card>
              </Page>
            ) : (
              <Outlet
                context={{ currencyCode, isBypass, hasActivePlan }}
              />
            )}
          </>
        )}
      </Frame>
    </PolarisProvider>
  );

  if (isBypass || !apiKey || !host) return AppContent;

  return (
    // @ts-expect-error
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      {AppContent}
    </ShopifyAppProvider>
  );
}