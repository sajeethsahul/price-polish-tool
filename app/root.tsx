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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let host = url.searchParams.get("host");

  // Fallback if host is missing (e.g. after a redirect)
  if (!host) {
    // We can't authenticate.admin(request) here easily without potentially triggering redirects,
    // so we look for shop in the URL or use a generic loader approach if available.
    // For now, if host is missing, we try to get it from searchParams or return null.
    // (Actual auth-based fallback is in app/routes/app.tsx which is the primary route)
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    host,
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

        {/* Shopify App Bridge */}
        <script
          src={`https://cdn.shopify.com/shopifycloud/app-bridge.js?apiKey=${apiKey}${host ? `&host=${host}` : ""}`}
        ></script>

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