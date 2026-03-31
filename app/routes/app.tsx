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
  } catch (error) {
    console.error("AUTH FAILED:", error);

    // ✅ BYPASS SAFE MODE
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

  // ✅ Shopify redirect handling
  if (auth?.redirect && !isBypass) {
    throw auth.redirect;
  }

  const { admin, session } = auth;

  // ================= HOST FIX (CRITICAL) =================
  let host = url.searchParams.get("host");
  const shop = url.searchParams.get("shop");

  // 🔥 1. FROM URL shop param
  if (!host && shop) {
    const store = shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // 🔥 2. FROM SESSION (fallback)
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
  type LoaderData = {
    apiKey: string | null;
    currencyCode: string;
    host: string | null;
    isBypass: boolean;
  };

  const data = useLoaderData() as LoaderData;
  const navigation = useNavigation();

  const isLoading = navigation.state === "loading";

  // 🔥 SAFE EXTRACTION (NO CRASH)
  const apiKey = data.apiKey;
  const host = data.host;
  const currencyCode = data.currencyCode;
  const isBypass = data.isBypass;

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

  // ================= SAFE INIT =================
  if (!apiKey || !host) {
    console.warn("App Bridge not ready:", { apiKey, host });

    return (
      <PolarisProvider i18n={{}}>
        <div style={{ padding: 20 }}>
          Initializing App Bridge...
        </div>
      </PolarisProvider>
    );
  }

  // ================= APP BRIDGE =================
  return (
    // @ts-expect-error host required
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      {AppContent}
    </ShopifyAppProvider>
  );
}