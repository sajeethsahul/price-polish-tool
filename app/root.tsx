import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { isRouteErrorResponse, useRouteError } from "react-router";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "react-router";

import { AppProvider } from "@shopify/polaris";

import globalStyles from "./styles/global.css?url";
import { AppLaunchSplash } from "./components/AppLaunchSplash";
import { t, setLocale } from "./utils/i18n";
import shopify from "./shopify.server";

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

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await  shopify.authenticate.admin(request);

    // Shopify sends BCP-47 locale e.g. "en", "es", "de", "fr", "ja"
    // session.locale may be undefined for older installs — fall back to "en"
    const locale: string = (session as any).locale ?? "en";

    // Switch the active dictionary for this request
    setLocale("es");

    return json({ locale:"es" });
  } catch {
    // Not an authenticated request (e.g. auth redirect) — use default locale
    setLocale("en");
    return json({ locale: "en" });
  }
}

export default function App() {
  const { locale } = useLoaderData<typeof loader>();

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />

        <link rel="preconnect" href="https://cdn.shopify.com/" />

        {/* Inject locale into window BEFORE any other scripts so the
            client-side i18n module can pick it up on initialisation. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__LOCALE__ = "${locale}";`,
          }}
        />

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
