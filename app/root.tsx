import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { isRouteErrorResponse, useRouteError } from "react-router";

import {
  AppProvider,
  Page,
  Card,
  BlockStack,
  Text,
  Button,
} from "@shopify/polaris";

// ================= STYLES =================
export const links = () => [
  {
    rel: "stylesheet",
    href: "https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css",
  },
];

// ================= ROOT =================
export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />

        <link rel="preconnect" href="https://cdn.shopify.com/" />

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

// ================= ERROR BOUNDARY =================
export function ErrorBoundary() {
  const error = useRouteError();

  console.error("ROOT ERROR:", error);

  let message = "Unexpected error";

  if (isRouteErrorResponse(error)) {
    message = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    message = error.message;

    // ✅ SAFE App Bridge recovery
    if (
      typeof window !== "undefined" &&
      error.message.includes("shopify global")
    ) {
      console.warn("Recovering App Bridge...");
      window.location.reload();
    }
  }

  return (
    <html>
      <body>
        <h1>App Error</h1>
        <p>{message}</p>
      </body>
    </html>
  );
}