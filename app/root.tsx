import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { isRouteErrorResponse, useRouteError } from "react-router";

import { AppProvider } from "@shopify/polaris";
import { I18nextProvider } from "react-i18next";

import globalStyles from "./styles/global.css?url";
import { AppLaunchSplash } from "./components/AppLaunchSplash";
import { t } from "./utils/i18n";
import i18n from "./utils/i18n.client";

export const links = () => [
  {
    rel: "stylesheet",
    href: "https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css",
  },
  {
    rel: "stylesheet",
    href: globalStyles,
  },
];

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />

          <link rel="preconnect" href="https://cdn.shopify.com/" />

          {/* ✅ CRITICAL FIX */}
          <script
            src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            defer
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
    </I18nextProvider>
  );
}

export function HydrateFallback() {
  return (
    <AppProvider i18n={{}}>
      <AppLaunchSplash />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  console.error("ROOT ERROR:", error);

  if (
    error &&
    typeof error === "object" &&
    (error as any).constructor?.name === "ErrorResponseImpl" &&
    typeof (error as any).data === "string" &&
    ((error as any).data.includes("shopifycloud/app-bridge.js") ||
      (error as any).data.includes("window.open("))
  ) {
    return (
      <div
        dangerouslySetInnerHTML={{ __html: (error as any).data }}
      />
    );
  }

  let message = "Unexpected error";

  if (isRouteErrorResponse(error)) {
    message = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    message = error.message;

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
        <h1>{t("common.error.appError")}</h1>
        <p>{message}</p>
      </body>
    </html>
  );
}
