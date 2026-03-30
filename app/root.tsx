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
  const host = url.searchParams.get("host");

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

        {/* FINAL ENFORCEMENT: Restrict standalone access (Force Iframe) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (window.top === window.self) {
                const url = new URL(window.location.href);
                const shop = url.searchParams.get("shop");

                if (shop) {
                  const store = shop.replace(".myshopify.com", "");
                  window.location.replace(
                    "https://admin.shopify.com/store/" + store + "/apps"
                  );
                }
              }
            `,
          }}
        />

        <Meta />
        <Links />
      </head>

      <script
        dangerouslySetInnerHTML={{
          __html: `
      console.log("=== DEBUG START ===");

      console.log("URL:", window.location.href);

      console.log("BYPASS:",
        new URL(window.location.href).searchParams.get("bypass")
      );

      console.log("IFRAME:",
        window.top === window.self ? "NO (standalone)" : "YES (embedded)"
      );

      console.log("APP BRIDGE SCRIPT:",
        !!document.querySelector('script[src*="app-bridge"]')
      );

      setTimeout(() => {
        console.log("BODY CONTENT:", document.body.innerText);
      }, 2000);
    `,
        }}
      />
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}