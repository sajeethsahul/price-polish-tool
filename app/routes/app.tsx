import {
  Outlet,
  Link,
  useLoaderData,
  useNavigation,
  redirect,
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
import { saveSubscription } from "../services/billing.server";
import { getSubscription } from "../services/billing.server";


// ================= LOADER =================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // ================= AUTH =================
  const auth = await authenticate.admin(request);

  if (auth instanceof Response) {
    return auth;
  }

  const { admin, session } = auth;

  if (!session?.shop) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shop = session.shop;

  // ================= HOST =================
  let host = url.searchParams.get("host");
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // ================= BILLING FLOW =================
  const chargeId = url.searchParams.get("charge_id");

const subscription = await getSubscription(shop);
console.log("📦 DB SUBSCRIPTION:", subscription);

  // 🔥 STEP 2 — CHECK DB (SOURCE OF TRUTH)
  let hasActivePlan = false;

  try {
    const subscription = await getSubscription(shop);
    hasActivePlan = subscription?.status === "active";
  } catch (err) {
    console.error("❌ Subscription check failed", err);
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
    host,
    currencyCode,
    hasActivePlan,
  };
};


// ================= COMPONENT =================
export default function AppLayout() {
  const data = useLoaderData() as any;
  const navigation = useNavigation();

  const isLoading = navigation.state === "loading";
  const { apiKey, host, currencyCode, hasActivePlan } = data;

  // 🔥 CLEAN charge_id (extra safety)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.has("charge_id")) {
      window.location.replace(window.location.pathname);
    }
  }, []);

  // 🔥 BILLING BUTTON
  const handleStartTrial = () => {
    const params = new URLSearchParams(window.location.search);

    const shop = params.get("shop");
    const host = params.get("host");

    if (!shop || !host) return;

    const url = `/api/billing?shop=${shop}&host=${host}`;

    // ✅ MUST break iframe
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
            <NavMenu>
              <Link to="/app">Dashboard</Link>
              <Link to="/app/rules">Pricing Rules</Link>
              <Link to="/app/settings">Settings</Link>
              <Link to="/app/help">Help</Link>
            </NavMenu>

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
              <Outlet context={{ currencyCode, hasActivePlan }} />
            )}
          </>
        )}
      </Frame>
    </PolarisProvider>
  );

  if (!apiKey || !host) return AppContent;

  return (
    // @ts-expect-error
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      {AppContent}
    </ShopifyAppProvider>
  );
}