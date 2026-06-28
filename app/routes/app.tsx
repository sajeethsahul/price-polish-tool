import {
  Outlet,
  Link,
  useLoaderData,
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
    select: {
      onboardingFirstRuleAt: true,
      onboardingFirstPreviewAt: true,
      onboardingFirstApplyStartAt: true,
      onboardingFirstApplyAt: true,
      onboardingFirstScheduleAt: true,
      onboardingCompletedAt: true,
      onboardingCelebratedAt: true,
    },
  });
  const isOnboarded =
    Boolean(appState?.onboardingCompletedAt) ||
    Boolean(appState?.onboardingFirstApplyAt);

  // True once the merchant has completed a meaningful wizard milestone.
  // Distinguishes "brand-new install" (all null → force wizard) from
  // "in-progress onboarding" (engaged → allow /app so the merchant can
  // reach the Apply buttons on the dashboard).
  // ApplyStartAt is a transient technical event, not a user milestone.
  // onboardingFirstApplyAt already implies isOnboarded = true, so it
  // never reaches this check.
  const hasOnboardingProgress =
    Boolean(appState?.onboardingFirstRuleAt) ||
    Boolean(appState?.onboardingFirstPreviewAt);

  console.log("[ONBOARDING CHECK]", {
    shop,
    onboardingCompletedAt: appState?.onboardingCompletedAt ?? null,
    isOnboarded,
    hasOnboardingProgress,
  });

  // Onboarding guard: redirect to /app/welcome for un-onboarded merchants accessing non-welcome routes
  const pathname = url.pathname;
  const isWelcomeRoute = pathname === "/app/welcome";
  const allowedDuringOnboarding = new Set<string>([
    "/app/welcome",
    "/app/rules",
    "/app/preview",
  ]);
  const isAllowedDuringOnboarding = allowedDuringOnboarding.has(pathname);

  if (!isOnboarded && !isAllowedDuringOnboarding && !hasOnboardingProgress) {
    console.log("[ONBOARDING STATE]", {
      isOnboarded,
      onboardingFirstRuleAt: appState?.onboardingFirstRuleAt ?? null,
      onboardingFirstPreviewAt: appState?.onboardingFirstPreviewAt ?? null,
      onboardingFirstApplyAt: appState?.onboardingFirstApplyAt ?? null,
      onboardingFirstScheduleAt: appState?.onboardingFirstScheduleAt ?? null,
      onboardingCompletedAt: appState?.onboardingCompletedAt ?? null,
    });

    const incomingSearchParams = new URLSearchParams(url.searchParams);
    const outgoingSearchParams = new URLSearchParams(url.searchParams);

    if (!outgoingSearchParams.get("host")) {
      outgoingSearchParams.set("host", host);
    }

    const search = outgoingSearchParams.toString();
    const to = `/app/welcome${search ? `?${search}` : ""}`;

    const trackedParams = [
      "embedded",
      "host",
      "id_token",
      "session",
      "timestamp",
      "hmac",
      "locale",
    ];

    const preserved = trackedParams.filter(
      (key) => incomingSearchParams.has(key) && outgoingSearchParams.has(key)
    );
    const lost = trackedParams.filter(
      (key) => incomingSearchParams.has(key) && !outgoingSearchParams.has(key)
    );
    const gained = trackedParams.filter(
      (key) => !incomingSearchParams.has(key) && outgoingSearchParams.has(key)
    );

    console.log("[ONBOARDING REDIRECT]");
    console.log("FROM:", request.url);
    console.log("TO:", to);
    console.log("PRESERVED:", preserved);
    console.log("LOST:", lost);
    console.log("GAINED:", gained);

    return redirect(to);
  }
  if (isOnboarded && isWelcomeRoute) {
    const outgoingSearchParams = new URLSearchParams(url.searchParams);
    if (!outgoingSearchParams.get("host")) {
      outgoingSearchParams.set("host", host);
    }
    const search = outgoingSearchParams.toString();
    const to = `/app${search ? `?${search}` : ""}`;

    console.log("[ONBOARDING REDIRECT]");
    console.log("FROM:", request.url);
    console.log("TO:", to);

    return redirect(to);
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

  const { apiKey, shop, host, currencyCode, hasActivePlan, billingStatus, isOnboarded } = data;
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
