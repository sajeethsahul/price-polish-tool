import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";

// ✅ ADD THIS
export const links = () => [
  {
    rel: "stylesheet",
    href: "https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />

        {/* Shopify CDN */}
        <link rel="preconnect" href="https://cdn.shopify.com/" />

        {/* Fonts */}
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />

        {/* App Bridge */}
        <script
          src={`https://cdn.shopify.com/shopifycloud/app-bridge.js?apiKey=${apiKey}`}
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