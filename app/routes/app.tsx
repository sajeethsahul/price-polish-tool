import { Outlet, Link, useLoaderData, useNavigation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  AppProvider as PolarisProvider,
  SkeletonPage, Frame,
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

  if (isBypass) {
    return {
      apiKey: process.env.SHOPIFY_API_KEY ?? "mock-api-key",
      currencyCode: "USD",
      host: null,
      isBypass: true,
      hasActivePlan: false, // 👈 important
    };
  }

  let auth;

  try {
    auth = await authenticate.admin(request);
  } catch (err: any) {
    console.error("AUTH ERROR:", err);

    if (err?.headers?.get("Location")) {
      throw new Response(null, {
        status: 302,
        headers: {
          Location: err.headers.get("Location"),
        },
      });
    }

    throw err;
  }

  const { admin, session, billing: billingApi } = auth;

  // 🔥 SAFETY CHECK
  if (!session?.shop) {
    console.warn("NO SESSION → forcing auth");

    throw new Response(null, {
      status: 302,
      headers: {
        Location: `/auth?shop=${url.searchParams.get("shop")}`,
      },
    });
  }

  // ================= BILLING CHECK (NEW) =================
  console.log("[BILLING] Checking plan...");
  
    let hasActivePlan = false;

    try {
      const billingCheck = await billingApi.check({
        plans: ["basic"], // ✅ match your config
        isTest: true,
      });

      hasActivePlan = billingCheck?.hasActivePayment || false;

      if (!hasActivePlan) {
        console.log("[BILLING] FREE MODE");
      } else {
        console.log("[BILLING] PAID USER");
      }

    } catch (err) {
      console.error("[BILLING] CHECK ERROR:", err);
      hasActivePlan = false;
    }

  console.log("[BILLING] STATUS:", hasActivePlan ? "PAID" : "FREE");

  // ================= HOST =================
  let host = url.searchParams.get("host");

  if (!host) {
    const store = session.shop.replace(".myshopify.com", "");
    host = Buffer.from(`admin.shopify.com/store/${store}`).toString("base64");
  }

  // ================= DATA =================
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
    hasActivePlan, // 👈 IMPORTANT (used in UI)
  };
};

// ================= COMPONENT =================
export default function AppLayout() {
  const raw = useLoaderData() as any;
  const navigation = useNavigation();
  const hasActivePlan = raw?.hasActivePlan ?? false;
  const handleUpgrade = () => {
  window.location.href = "/api/billing";
};

  const isLoading = navigation.state === "loading";

  const apiKey = raw?.apiKey ?? null;
  const host = raw?.host ?? null;
  const currencyCode = raw?.currencyCode ?? "USD";
  const isBypass = raw?.isBypass ?? false;

  // ================= MAIN UI =================
  const AppContent = (
    <PolarisProvider i18n={{}}>
      <Frame> {/* 🔥 CRITICAL FIX */}
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

          {!hasActivePlan && (
            <div style={{
              background: "#fff4e5",
              padding: "12px",
              borderRadius: "8px",
              marginBottom: "12px",
              border: "1px solid #ffd79d"
            }}>
              <p style={{ margin: 0 }}>
                 Unlock full pricing automation with Pro plan
              </p>

              <button
                onClick={handleUpgrade}
                style={{
                  marginTop: "8px",
                  padding: "8px 12px",
                  background: "#008060",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer"
                }}
              >
                Upgrade Now
              </button>
            </div>
          )}
            <Outlet context={{ currencyCode, isBypass }} />
          </>
        )}
      </Frame> {/* 🔥 CRITICAL FIX */}
    </PolarisProvider>
  );

  // ================= BYPASS =================
  if (isBypass) {
    return AppContent;
  }

  // ================= SAFE GUARD =================
  // 🔥 DO NOT BLOCK UI EVER
  if (!apiKey || !host) {

    console.warn("App Bridge not ready:", { apiKey, host });

    return AppContent; // ✅ NEVER return Skeleton here
  }


  // ================= APP BRIDGE =================
  return (
    // @ts-expect-error host required
    <ShopifyAppProvider apiKey={apiKey} host={host} embedded>
      {AppContent}
    </ShopifyAppProvider>
  );
}