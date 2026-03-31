import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
//import { isRouteErrorResponse, useRouteError } from "react-router";
import { isRouteErrorResponse, useRouteError } from "@remix-run/react";
import type { LoaderFunctionArgs } from "react-router";

import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  AppProvider,
  Box,
} from "@shopify/polaris";

// ✅ POLARIS STYLES (REQUIRED FOR BOTH APP + ERROR UI)
export const links = () => [
  {
    rel: "stylesheet",
    href: "https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css",
  },
];

// ================= LOADER =================
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const host = url.searchParams.get("host");

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    host,
  };
};

// ================= ROOT APP =================
export default function App() {
  useLoaderData<typeof loader>(); // keep for hydration

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />

        {/* Shopify CDN preconnect */}
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

  let errorMessage = "An unknown error has occurred. Please try again.";

  if (isRouteErrorResponse(error)) {
    errorMessage = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />

        {/* ✅ IMPORTANT: Polaris styles must be here too */}
        <Links />
        <Meta />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Page title="Something went wrong">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="p" variant="bodyMd">
                    The application encountered an unexpected error. This might
                    be due to a session timeout or a temporary connection issue.
                  </Text>

                  <Text as="p" tone="subdued">
                    Error Detail: {errorMessage}
                  </Text>

                  <Box paddingBlockStart="400">
                    <Button
                      variant="primary"
                      onClick={() => window.location.reload()}
                    >
                      Refresh Page
                    </Button>
                  </Box>
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