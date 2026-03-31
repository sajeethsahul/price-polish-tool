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

  let auth;

  try {
    auth = await authenticate.admin(request);
  } catch (error: any) {
    console.error("AUTH FAILED:", error);

    if (isBypass) {
      console.warn("⚠️ BYPASS MODE ACTIVE");
      return {
        apiKey: process.env.SHOPIFY_API_KEY || "mock-api-key",
        currencyCode: "USD",
        host: null,
        isBypass: true,
      };
    }

    throw new Response("Service Unavailable (Database Issue)", {
      status: 503,
    });
  }

  // ✅ HANDLE REDIRECT ONLY WHEN NOT BYPASS
  if (auth?.redirect && !isBypass) {
    return auth.redirect;
  }

  // ✅ SESSION IS THE SOURCE OF TRUTH
  const { admin, session } = auth;

  // ✅ COMPUTE HOST (CRITICAL FOR APP BRIDGE 4)
  let finalHost = url.searchParams.get("host");
  if (!finalHost && session.shop) {
    const store = session.shop.replace(".myshopify.com", "");
    finalHost = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
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

  // TEMP: loader diagnostics (remove after issue is resolved)
  console.log("APP LOADER RETURN:", {
    isBypass,
    apiKeyPresent: Boolean(process.env.SHOPIFY_API_KEY),
    hostFromQuery: url.searchParams.get("host"),
    sessionShopPresent: Boolean(session?.shop),
    finalHostPresent: Boolean(finalHost),
    currencyCode,
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    currencyCode,
    host: finalHost || "",
    isBypass: false,
  };
};

// ================= COMPONENT =================
export default function AppLayout() {
  const data = useLoaderData<typeof loader>();
  const obj = data && typeof data === "object" ? (data as any) : {};
  const apiKey = obj.apiKey as string | undefined;
  const host = obj.host as string | undefined;
  const currencyCode = obj.currencyCode as string | undefined;
  const isBypass = obj.isBypass as boolean | undefined;
  const navigation = useNavigation();

  const isLoading = navigation.state === "loading";

  // ================= COMMON UI =================
  const AppContent = (
    <PolarisProvider i18n={{}}>
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
          <Outlet context={{ currencyCode, isBypass }} />
        </>
      )}
    </PolarisProvider>
  );

  // ================= BYPASS MODE =================
  if (isBypass) {
    console.warn("⚠️ Rendering WITHOUT App Bridge (BYPASS)");
    return AppContent;
  }

  if (!apiKey || !host) {
    console.warn("App Bridge not ready yet:", { apiKey, host });
    return (
      <PolarisProvider i18n={{}}>
        <SkeletonPage title="Loading..." />
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