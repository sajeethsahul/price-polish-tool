import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
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

// ✅ POLARIS STYLES
export const links = () => [
  {
    rel: "stylesheet",
    href: "https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css",
  },
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
  useLoaderData<typeof loader>();

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

export function ErrorBoundary() {
  const error = useRouteError();

  console.error("ROOT ERROR:", error);

  let errorMessage = "An unknown error has occurred.";

  if (isRouteErrorResponse(error)) {
    errorMessage = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  }

  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={{}}>
          <Page title="Something went wrong">
            <Card>
              <BlockStack gap="400">
                <Text as="p">{errorMessage}</Text>
                <Box>
                  <Button onClick={() => window.location.reload()}>
                    Refresh
                  </Button>
                </Box>
              </BlockStack>
            </Card>
          </Page>
        </AppProvider>
        <Scripts />
      </body>
    </html>
  );
}