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
  BlockStack,
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

  try {
    const auth = await authenticate.admin(request);

    if (auth?.redirect) return auth.redirect;
    if (!auth) throw new Response("Unauthorized", { status: 401 });

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
    } catch (err) {
      console.error("Currency fetch failed:", err);
    }

    const storeName = session.shop.replace(".myshopify.com", "");

    const host = Buffer.from(
      `admin.shopify.com/store/${storeName}`
    ).toString("base64");

    return {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      currencyCode,
      host,
      isBypass: false,
    };
  } catch (error) {
    console.error("AUTH FAILED:", error);

    if (isBypass) {
      console.warn("⚠️ BYPASS MODE ACTIVE");

      return {
        apiKey: process.env.SHOPIFY_API_KEY || "mock-api-key",
        currencyCode: "USD",
        host: null, // 🔥 critical
        isBypass: true,
      };
    }

    throw new Response("Service Unavailable (Database Issue)", {
      status: 503,
    });
  }
};

// ================= COMPONENT =================
export default function AppLayout() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const isLoading = navigation.state === "loading";

  if (!data || typeof data !== "object" || !("apiKey" in data)) {
    return (
      <PolarisProvider i18n={{}}>
        <SkeletonPage title="Price Polish">
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
          </Layout>
        </SkeletonPage>
      </PolarisProvider>
    );
  }

  const { apiKey, currencyCode, host, isBypass } = data;

  // ================= COMMON UI =================
  const AppContent = (
    <PolarisProvider i18n={{}}>
      {isLoading && <Loading />}

      {!isBypass && (
        <NavMenu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/rules">Pricing Rules</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/help">Help Guide</Link>
        </NavMenu>
      )}

      <Outlet context={{ currencyCode, isBypass }} />
    </PolarisProvider>
  );

  // ================= BYPASS MODE =================
  if (isBypass) {
    console.warn("⚠️ Rendering WITHOUT App Bridge (BYPASS)");
    return AppContent;
  }

  // ================= NORMAL MODE =================
  if (!host) {
    return (
      <PolarisProvider i18n={{}}>
        <SkeletonPage title="Price Polish">
          <Loading />
        </SkeletonPage>
      </PolarisProvider>
    );
  }

  return (
    // @ts-expect-error host required for App Bridge v4
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      {AppContent}
    </ShopifyAppProvider>
  );
}