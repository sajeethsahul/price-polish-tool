import { Outlet, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AppProvider as PolarisProvider } from "@shopify/polaris";
import {
  AppProvider as ShopifyAppProvider,
} from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);

  // ✅ Shopify handles OAuth redirect
  if (auth?.redirect) {
    return auth.redirect;
  }

  if (!auth) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const { admin } = auth;

  // ✅ Keep your original currency logic
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

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    currencyCode,
  };
};

export default function AppLayout() {
  const data = useLoaderData<typeof loader>();

  // ✅ Prevent crash during redirect phase
  if (!data || typeof data !== "object" || !("apiKey" in data)) {
    return null;
  }

  const { apiKey, currencyCode } = data;

  return (
    <ShopifyAppProvider apiKey={apiKey} embedded>
      <PolarisProvider i18n={{}}>
        {/* ✅ Keep your navigation (same as before) */}
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