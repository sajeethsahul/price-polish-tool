import {
  Outlet,
  Link,
  useLoaderData,
  useNavigation,
  useLocation,
  redirect,
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

  const toTopLevelRedirect = (response: Response): Response => {
    const location = response.headers.get("Location");
    console.log("[REDIRECT TRACE]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", response.status);
    console.log("LOCATION:", location);
    if (!location) return response;
    if (!location.startsWith("https://admin.shopify.com")) return response;

    const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><script>window.top.location.href=${JSON.stringify(location)};</script></body></html>`;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  };

  // 🔐 AUTH (MANDATORY)
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) {
    console.log("[AUTH/BILLING REDIRECT]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", auth.status);
    console.log("LOCATION:", auth.headers.get("Location"));
    return toTopLevelRedirect(auth);
  }

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

  // Check if merchant has completed onboarding
  const { default: prisma } = await import("../db.server");
  const appState = await prisma.appState.findUnique({
    where: { shop },
    select: { onboardingFirstApplyAt: true },
  });
  const isOnboarded = Boolean(appState?.onboardingFirstApplyAt);

  // Onboarding guard: redirect to /app/welcome for un-onboarded merchants accessing non-welcome routes
  const pathname = url.pathname;
  const isWelcomeRoute = pathname === "/app/welcome";
  if (!isOnboarded && !isWelcomeRoute) {
    console.log("[REDIRECT TRACE]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", 302);
    console.log("LOCATION:", `/app/welcome?shop=${shop}&host=${host}`);
    return redirect(
      `/app/welcome?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
    );
  }
  if (isOnboarded && isWelcomeRoute) {
    console.log("[REDIRECT TRACE]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", 302);
    console.log("LOCATION:", `/app?shop=${shop}&host=${host}`);
    return redirect(`/app?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`);
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
    console.log("[AUTH/BILLING REDIRECT]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", billingResponse.status);
    console.log("LOCATION:", billingResponse.headers.get("Location"));
    return toTopLevelRedirect(billingResponse);
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
    isOnboarded,
  };
};

// ================= COMPONENT =================
export default function AppLayout() {
  const data = useLoaderData() as any;
  const navigation = useNavigation();
  const location = useLocation();

  const isLoading = navigation.state === "loading";
  const { apiKey, shop, host, currencyCode, hasActivePlan, billingStatus, isOnboarded } = data;
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
              <Link to="/app/welcome">Get Started</Link>
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
