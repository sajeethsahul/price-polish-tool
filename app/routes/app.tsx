import { Outlet, Link, useLoaderData, useNavigation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import {
  AppProvider as PolarisProvider,
  SkeletonPage,
  Layout,
  Card,
  SkeletonBodyText,
  SkeletonDisplayText,
  Loading,
  Box,
  BlockStack
} from "@shopify/polaris";
import {
  AppProvider as ShopifyAppProvider,
} from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);

  if (auth?.redirect) {
    return auth.redirect;
  }

  if (!auth) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const { admin, session } = auth;

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
  } catch (error) {
    console.error("Currency fetch failed:", error);
  }

  // ✅ ONLY SOURCE OF TRUTH
  const storeName = session.shop.replace(".myshopify.com", "");

  const host = Buffer.from(
    `admin.shopify.com/store/${storeName}`
  ).toString("base64");

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    currencyCode,
    host,
  };
};

export default function AppLayout() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  // ✅ Show Polaris Loading bar during any navigation
  const isLoading = navigation.state === "loading";

  // ✅ Prevent blank screen during redirect/init phase by showing Skeleton
  if (!data || typeof data !== "object" || !("apiKey" in data)) {
    return (
      <PolarisProvider i18n={{}}>
        <SkeletonPage title="Price Polish" primaryAction>
          {isLoading && <Loading />}
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={3} />
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <SkeletonDisplayText size="small" />
                  <SkeletonBodyText lines={2} />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        </SkeletonPage>
      </PolarisProvider>
    );
  }

  const { apiKey, currencyCode, host } = data;

  // Strict Guard: Prevent App Bridge context mismatch by ensuring host is present
  if (!host) {
    return (
      <PolarisProvider i18n={{}}>
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
      </PolarisProvider>
    );
  }

  return (
    // @ts-expect-error - host is required for App Bridge 4 but missing from some library versions of AppProviderProps
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      <PolarisProvider i18n={{}}>
        {/* ✅ Global Loading Bar */}
        {isLoading && <Loading />}

        <NavMenu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/rules">Pricing Rules</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/help">Help Guide</Link>
        </NavMenu>

        {/* ✅ Your app content (UNCHANGED) */}
        <Outlet context={{ currencyCode }} />
      </PolarisProvider>
    </ShopifyAppProvider>
  );
}