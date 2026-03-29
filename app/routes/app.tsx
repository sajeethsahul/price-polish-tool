import { Outlet, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AppProvider as PolarisProvider } from "@shopify/polaris";
import {
  AppProvider as ShopifyAppProvider,
} from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";

export default function Dashboard() {
  return (
    <div style={{ padding: "20px" }}>
      <h1>✅ Price Polish App Loaded</h1>
      <p>If you see this, your app is working.</p>
    </div>
  );
}

// export const loader = async ({ request }: LoaderFunctionArgs) => {
//   const auth = await authenticate.admin(request);

//   // ✅ Let Shopify handle redirects (OAuth/session)
//   if (auth?.redirect) {
//     return auth.redirect;
//   }

//   if (!auth) {
//     throw new Response("Unauthorized", { status: 401 });
//   }

//   const { admin } = auth;

//   let currencyCode = "USD";

//   try {
//     const response = await admin.graphql(`
//       {
//         shop {
//           currencyCode
//         }
//       }
//     `);

//     const data = await response.json();
//     currencyCode = data?.data?.shop?.currencyCode || "USD";
//   } catch (error) {
//     console.error("[Price Polish] GraphQL error:", error);
//   }

//   return {
//     apiKey: process.env.SHOPIFY_API_KEY || "",
//     currencyCode,
//   };
// };

// export default function AppLayout() {
//   const data = useLoaderData<typeof loader>();

//   // ✅ Safety check (in case of redirect response)
//   if (!data || typeof data !== "object" || !("apiKey" in data)) {
//     return null;
//   }

//   const { apiKey, currencyCode } = data;

//   return (
//     <ShopifyAppProvider apiKey={apiKey} embedded>
//       <PolarisProvider i18n={{}}>
//         <NavMenu>
//           <Link to="/app" rel="home">Dashboard</Link>
//           <Link to="/app/rules">Pricing Rules</Link>
//           <Link to="/app/settings">Settings</Link>
//           <Link to="/app/help">Help Guide</Link>
//         </NavMenu>

//         <Outlet context={{ currencyCode }} />
//       </PolarisProvider>
//     </ShopifyAppProvider>
//   );
// }