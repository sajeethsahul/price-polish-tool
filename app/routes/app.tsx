import {
  Outlet,
  Link,
  useLoaderData,
  useNavigation,
  useNavigate,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

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
    if (err?.headers?.get("Location")) {
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

  // 🔥 FORCE BILLING TOGGLE
  const FORCE_BILLING = process.env.NODE_ENV !== "production";

  let hasActivePlan = false;

  if (!FORCE_BILLING) {
    try {
      const billingCheck = await billing.check({
        plans: ["basic"],
        isTest: true,
      });

      console.log("[BILLING RAW]", billingCheck);

      hasActivePlan = billingCheck?.hasActivePayment || false;
    } catch (err) {
      console.error("[BILLING ERROR]", err);
      hasActivePlan = false;
    }
  } else {
    // 🔥 DEV MODE → ALWAYS SHOW BILLING
    hasActivePlan = false;
  }

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
    isBypass: false,
    hasActivePlan,
  };
};

// ================= COMPONENT =================
export default function AppLayout() {
  const data = useLoaderData() as any;
  const navigation = useNavigation();
  const navigate = useNavigate();

  const isLoading = navigation.state === "loading";

  const { apiKey, host, currencyCode, isBypass, hasActivePlan } = data;

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
                <Link to="/app" rel="home">Dashboard</Link>
                <Link to="/app/rules">Pricing Rules</Link>
                <Link to="/app/settings">Settings</Link>
                <Link to="/app/help">Help Guide</Link>
              </NavMenu>
            )}

            {/* 🔥 BILLING UI (GLOBAL CONTROL) */}
            {!hasActivePlan ? (
              <Page title="Start Free Trial">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Unlock Price Polish 🚀
                    </Text>
                    <Text as="p">
                      Start your 7-day free trial to activate pricing automation.
                    </Text>
                    <Button
                      variant="primary"
                      onClick={() => navigate("/api/billing")}
                    >
                      Start Free Trial
                    </Button>
                  </BlockStack>
                </Card>
              </Page>
            ) : (
              <Outlet context={{ currencyCode, isBypass, hasActivePlan }} />
            )}
          </>
        )}
      </Frame>
    </PolarisProvider>
  );

  if (isBypass) {
    return AppContent;
  }

  if (!apiKey || !host) {
    return AppContent;
  }

  return (
    // @ts-expect-error
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      {AppContent}
    </ShopifyAppProvider>
  );
}