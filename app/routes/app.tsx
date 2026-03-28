import { Outlet, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

import "@shopify/polaris/build/esm/styles.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  
  const response = await admin.graphql(`
    {
      shop {
        currencyCode
      }
    }
  `);
  
  const data = await response.json();
  const currencyCode = data.data.shop.currencyCode || "USD";
  
  return { apiKey: process.env.SHOPIFY_API_KEY || "", currencyCode };
};

export default function AppLayout() {
  const { apiKey, currencyCode } = useLoaderData<typeof loader>();

  return (
    <ShopifyAppProvider apiKey={apiKey} embedded={true}>
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
