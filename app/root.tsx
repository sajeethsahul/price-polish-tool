import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Page, Card, BlockStack, Text, Button, AppProvider } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "react-router";

// ✅ POLARIS STYLES ARE REQUIRED IN HEAD
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

        {/* ENFORCE IFRAME (App Bridge Requirement) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (window.top === window.self) {
                const url = new URL(window.location.href);
                const shop = url.searchParams.get("shop");

                if (shop) {
                  const store = shop.replace(".myshopify.com", "");
                  window.location.replace(
                    "https://admin.shopify.com/store/" + store + "/apps/price-polish-tool"
                  );
                }
              }
            `,
          }}
        />

        <Meta />
        <Links />
      </head>      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

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
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Page title="Something went wrong">
            <BlockStack gap="400">
               <Card>
                  <BlockStack gap="400">
                    <Text as="p" variant="bodyMd">
                      The application encountered an unexpected error. This might be due to a session timeout or a temporary connection issue.
                    </Text>
                    <Text as="p" tone="subdued">
                      Error Detail: {errorMessage}
                    </Text>
                    <Box paddingBlockStart="400">
                       <Button variant="primary" onClick={() => window.location.reload()}>
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

import { Box } from "@shopify/polaris";