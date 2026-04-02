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
  }

  // 🔥 FIX: Safe reload ONLY once for App Bridge issue
  if (typeof window !== "undefined") {
    const isAppBridgeError = message?.includes("shopify global");

    if (isAppBridgeError && !(window as any).__reloaded) {
      (window as any).__reloaded = true;
      window.location.reload();
    }
  }

  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Page title="App Error">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="p" variant="bodyMd">
                    The application encountered an unexpected error.
                  </Text>

                  <Text as="p" tone="subdued">
                    {message}
                  </Text>

                  <Button onClick={() => window.location.reload()} variant="primary">
                    Reload
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Page>
        </AppProvider>

        <Scripts />
      </body>
    </html>
  );
}