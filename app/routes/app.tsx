import { Outlet, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import {
  AppProvider as ShopifyAppProvider,
} from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

import "@shopify/polaris/build/esm/styles.css";

//import { addDocumentResponseHeaders } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");

  const auth = await authenticate.admin(request);

  // 🔥 CRITICAL: handle redirect properly
  if (auth?.redirect) {
    return auth.redirect;
  }

  if (!auth) {
    console.error("[Price Polish] Authentication failed");
    throw new Response("Unauthorized", { status: 401 });
  }

  const { admin, session } = auth;

  console.log(`[Price Polish] Session active for shop: ${session.shop}`);

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
    console.error("[Price Polish] GraphQL error:", error);
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    currencyCode,
    shop: session.shop,
    host, // 🔥 REQUIRED FOR APP BRIDGE
  };
};

// 🔥 REQUIRED FOR EMBEDDED APPS
// export const headers: HeadersFunction = (headersArgs) => {
//   return boundary.headers(headersArgs);
// };
//export const headers = addDocumentResponseHeaders;

export default function AppLayout() {
  const data = useLoaderData<typeof loader>();

  // 🔥 Handle redirect safely
  if (!data || typeof data !== "object" || !("apiKey" in data)) {
    return null;
  }

  const { apiKey, currencyCode, shop, host } = data;



  return (
    <ShopifyAppProvider apiKey={apiKey} embedded>
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