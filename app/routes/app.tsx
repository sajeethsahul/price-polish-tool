import {
  Outlet,
  Link,
  useLoaderData,
  useNavigation,
  useLocation,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";

import {
  AppProvider as PolarisProvider,
  BlockStack,
  Frame,
  Page,
  Text,
  Button,
  Card,
  Toast,
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
import {
  BillingStatusBanner,
  isBillingActive,
  type BillingStatusValue,
} from "../components/BillingStatusBanner";
import { normalizeBillingFromResult } from "../utils/billing-status.server";
import { t } from "../utils/i18n";
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

  // ─── BILLING RECONCILIATION: sync cache with Shopify truth on every app entry ────
  // `billingResponse` is NOT a redirect — merchant was authenticated and approved.
  // Persist a local snapshot so the Billing page and diagnostics are populated.
  // This is non-fatal: persistence errors never block the app from loading.
  console.log(`[BILLING RECONCILIATION] shop=${shop}`);

  // Inline extraction — mirrors billing-persistence.server.ts logic without sharing server-only code.
  const rawBillingResult = billingResponse as unknown as Record<string, unknown>;
  const billingStatus: BillingStatusValue = normalizeBillingFromResult(rawBillingResult);

  try {
    const { persistBillingStateFromShopify } = await import(
      "../utils/billing-persistence.server"
    );
    await persistBillingStateFromShopify({
      shop,
      billingResult: rawBillingResult,
      expectedPlanName: "basic",
      isTest: true,
    });
    console.log(`[BILLING RECONCILIATION SYNC] shop=${shop} billingStatus=${billingStatus}`);
  } catch (err) {
    console.error(
      `[BILLING RECONCILIATION ERROR] shop=${shop} error=${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // ✅ hasActivePlan reflects enforcement gate (always true — no billing gating in this phase).
  const hasActivePlan = isBillingActive(billingStatus);

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
    shop,
    host,
    currencyCode,
    hasActivePlan,
    billingStatus,
  };
};

// ================= COMPONENT =================
export default function AppLayout() {
  const data = useLoaderData() as any;
  const navigation = useNavigation();
  const location = useLocation();

  const isLoading = navigation.state === "loading";
  const { apiKey, shop, host, currencyCode, hasActivePlan, billingStatus } = data;
  const loadingPathname = navigation.location?.pathname ?? location.pathname;
  const loadingCopy = resolvePricePolishLoaderCopy(loadingPathname);
  const showBrandedLoader = useDelayedVisibility(isLoading, 300);
  const [toastContent, setToastContent] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flag = sessionStorage.getItem("pp.billing.restore_initiated");
    if (flag !== "1") return;
    sessionStorage.removeItem("pp.billing.restore_initiated");
    if (hasActivePlan) {
      setToastContent(t("billing.accessRestored"));
    }
  }, [hasActivePlan]);

  const AppContent = (
    <PolarisProvider i18n={{}}>
      <Frame>
        {toastContent ? (
          <Toast content={toastContent} onDismiss={() => setToastContent(null)} />
        ) : null}
        {showBrandedLoader ? (
          <PricePolishLoader title={loadingCopy.title} subtitle={loadingCopy.subtitle} />
        ) : (
          <>
            <NavMenu>
              <Link to="/app">Dashboard</Link>
              <Link to="/app/campaign-history">Campaign History</Link>
              <Link to="/app/rules">Pricing Rules</Link>
              <Link to="/app/billing">Billing</Link>
              <Link to="/app/settings">Settings</Link>
              <Link to="/app/help">Help</Link>
            </NavMenu>

            <BillingStatusBanner
              status={billingStatus as BillingStatusValue}
              shop={shop}
              host={host}
            />

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
                        const targetWindow = window.top ?? window;
                        targetWindow.location.href = `/api/billing?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
                      }}
                    >
                      Start Free Trial
                    </Button>
                  </BlockStack>
                </Card>
              </Page>
            ) : (
              <Outlet context={{ currencyCode, hasActivePlan, shop, host }} />
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
