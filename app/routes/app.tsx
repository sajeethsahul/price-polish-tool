import { Outlet, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import {
  AppProvider as ShopifyAppProvider,
  useNavigate,
} from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

import "@shopify/polaris/build/esm/styles.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);

  if (auth?.redirect) {
    return auth.redirect;
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
    console.error("GraphQL error:", error);
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    currencyCode,
    shop: session.shop,
  };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function AppLayout() {
  const data = useLoaderData<typeof loader>();

  if (!data || typeof data !== "object" || !("apiKey" in data)) {
    return null;
  }

  const { apiKey, currencyCode, shop } = data;

  return (
    <ShopifyAppProvider apiKey={apiKey} embedded shop={shop}>
      <PolarisProvider i18n={{}}>
        <NavMenu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/rules">Pricing Rules</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/help">Help Guide</Link>
        </NavMenu>

        <Outlet context={{ currencyCode }} />
      </PolarisProvider>
    </ShopifyAppProvider>
  );
}