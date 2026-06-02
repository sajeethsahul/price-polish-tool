import {
  Outlet,
  Link,
  useLoaderData,
  useNavigation,
  useLocation,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import {
  AppProvider as PolarisProvider,
  BlockStack,
  Frame,
  Page,
  Text,
  Button,
  Card,
} from "@shopify/polaris";

import {
  AppProvider as ShopifyAppProvider,
} from "@shopify/shopify-app-react-router/react";

import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { recordShopInstall } from "../utils/shop-lifecycle.server";
import {
  PricePolishLoader,
  resolvePricePolishLoaderCopy,
  useDelayedVisibility,
} from "../components/PricePolishLoader";
//import { persistBillingStateFromShopify } from "../utils/billing-persistence.server";

// ================= LOADER =================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // 🔐 AUTH (MANDATORY)
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  const { admin, session, billing } = auth;

  if (!session?.shop) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const shop = session.shop;

  await recordShopInstall({ shop });

  // 🧠 HOST
  let host = url.searchParams.get("host");
  if (!host) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // 💰 BILLING ENFORCEMENT (🔥 THIS IS THE KEY FIX)
  const billingResponse = await billing.require({
    plans: ["basic"],
    isTest: true,
    onFailure: async () =>
      billing.request({
        plan: "basic",
        isTest: true,
      }),
  });

  // If Shopify wants to redirect → do it
  if (billingResponse instanceof Response) {
    return billingResponse;
  }

  // await persistBillingStateFromShopify({
  //   admin,
  //   shop,
  //   expectedPlanName: "basic",
  //   isTest: true,
  // });

  // ✅ If reached here → user has active plan
  const hasActivePlan = true;

  // 💱 CURRENCY
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
  const location = useLocation();

  const isLoading = navigation.state === "loading";
  const { apiKey, host, currencyCode, hasActivePlan } = data;
  const loadingPathname = navigation.location?.pathname ?? location.pathname;
  const loadingCopy = resolvePricePolishLoaderCopy(loadingPathname);
  const showBrandedLoader = useDelayedVisibility(isLoading, 300);

  const AppContent = (
    <PolarisProvider i18n={{}}>
      <Frame>
        {showBrandedLoader ? (
          <PricePolishLoader title={loadingCopy.title} subtitle={loadingCopy.subtitle} />
        ) : (
          <>
            <NavMenu>
              <Link to="/app">Dashboard</Link>
              <Link to="/app/campaign-history">Campaign History</Link>
              <Link to="/app/rules">Pricing Rules</Link>
              <Link to="/app/settings">Settings</Link>
              <Link to="/app/help">Help</Link>
            </NavMenu>

            {!hasActivePlan ? (
              <Page title="Start Free Trial">
                <Card>
                  <BlockStack gap="300">
                    <Text  as="h2"  variant="headingMd">
                      Unlock Price Polish
                    </Text>
                    <Text as="p">
                      Start your 7-day free trial.
                    </Text>
                    <Button
                      variant="primary"
                      onClick={() => {
                        const params = new URLSearchParams(window.location.search);
                        const shop = params.get("shop");
                        const host = params.get("host");

                        if (!shop || !host) return;

                        window.open(
                          `/api/billing?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`,
                          "_top"
                        );
                      }}
                    >
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
