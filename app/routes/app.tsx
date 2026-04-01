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
  console.error("AUTH ERROR:", error);

  // ✅ THIS IS THE FIX
  if (error instanceof Response) {
    throw error; // 🔥 RE-THROW redirect (DO NOT CHANGE IT)
  }

  // Optional: only fallback for bypass
  if (isBypass) {
    return {
      apiKey: process.env.SHOPIFY_API_KEY ?? "mock-api-key",
      currencyCode: "USD",
      host: null,
      isBypass: true,
    };
  }

  throw new Response("Service Unavailable", { status: 503 });
}

  // ✅ CRITICAL FIX (DO NOT RETURN)
  if (auth?.redirect && !isBypass) {
    throw auth.redirect;
  }

  const { admin, session } = auth;

  // ================= HOST FIX =================
  let host = url.searchParams.get("host");
  const shop = url.searchParams.get("shop");

  // from URL
  if (!host && shop) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // from session
  if (!host && session?.shop) {
    const store = session.shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // ================= SHOP DATA =================
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

  // ================= DEBUG =================
  console.log("LOADER RESULT:", {
    apiKey: process.env.SHOPIFY_API_KEY,
    host,
    shop,
  });

  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? null,
    currencyCode,
    host: host ?? null,
    isBypass: false,
  };
};

// ================= COMPONENT =================
export default function AppLayout() {
  const raw = useLoaderData() as any;
  const navigation = useNavigation();

  const isLoading = navigation.state === "loading";

  // ✅ SAFE EXTRACTION
  const apiKey = raw?.apiKey ?? null;
  const host = raw?.host ?? null;
  const currencyCode = raw?.currencyCode ?? "USD";
  const isBypass = raw?.isBypass ?? false;

  // ================= MAIN UI =================
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

  // ================= BYPASS =================
  if (isBypass) {
    console.warn("⚠️ BYPASS MODE ACTIVE");
    return AppContent;
  }

  // ================= CRITICAL CHANGE =================
  // ❌ DO NOT BLOCK UI (this was your biggest issue)
  if (!apiKey || !host) {
    console.warn("App Bridge not ready:", { apiKey, host });

    return AppContent; // 🔥 IMPORTANT FIX
  }

  // ================= APP BRIDGE =================
  return (
    // @ts-expect-error host required
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      {AppContent}
    </ShopifyAppProvider>
  );
}