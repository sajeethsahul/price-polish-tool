import { Outlet, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

import "@shopify/polaris/build/esm/styles.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <ShopifyAppProvider apiKey={apiKey} embedded={true}>
      <PolarisProvider i18n={{}}>
        <NavMenu>
          <Link to="/app" rel="home">Dashboard</Link>
          <Link to="/app/rules">Pricing Rules</Link>
          <Link to="/app/settings">Settings</Link>
          <Link to="/app/bulk">Bulk Editor</Link>
          <Link to="/app/help">Help Guide</Link>
        </NavMenu>
        <Outlet />
      </PolarisProvider>
    </ShopifyAppProvider>
  );
}
