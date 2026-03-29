import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// ✅ All styles must be here (SSR-safe)
export const links = () => [
  {
    rel: "stylesheet",
    href: "https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css",
  }
];

import { authenticate } from "./shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  let host = url.searchParams.get("host");
  let apiKey = process.env.SHOPIFY_API_KEY || "";

  // ✅ ONLY for embedded app routes to avoid OAuth loops in root
  if (url.pathname.startsWith("/app")) {
    try {
      const auth = await authenticate.admin(request);
      const shop = auth?.session?.shop;

      if (shop) {
        const storeName = shop.replace(".myshopify.com", "");
        host = Buffer.from(`admin.shopify.com/store/${storeName}`).toString("base64");
        console.log("✅ Host from session:", host);
      }
    } catch (err) {
      console.log("⚠️ Auth skipped in root:", err);
    }
  }

  // 🔥 fallback (for non-auth routes or missing session)
  if (!host) {
    const shop = url.searchParams.get("shop");
    if (shop) {
      const storeName = shop.replace(".myshopify.com", "");
      host = Buffer.from(`admin.shopify.com/store/${storeName}`).toString("base64");
      console.log("⚠️ Host from URL fallback:", host);
    }
  }

  return {
    apiKey,
    host: host || "",
  };
};

export default function App() {
  const { apiKey, host } = useLoaderData<typeof loader>();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        />

        {/* Shopify CDN preconnect */}
        <link rel="preconnect" href="https://cdn.shopify.com/" />

        {/* Shopify App Bridge Configuration Injection */}
        {host && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.shopifyConfig = { host: "${host}", apiKey: "${apiKey}" };`,
            }}
          />
        )}

        {/* Shopify App Bridge Script */}
        {host && (
          <script
            src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            data-api-key={apiKey}
            data-host={host}
          />
        )}

        <Meta />
        <Links />
      </head>

      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}