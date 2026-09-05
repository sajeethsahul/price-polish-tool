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

// Public routes that must render without any Shopify authentication or
// App Bridge (e.g. legal pages opened directly in a browser tab).
const PUBLIC_ROUTES = ["/privacy"];

export async function loader({ request }: LoaderFunctionArgs) {
  // Public pages skip the Shopify auth flow entirely — anyone can access them.
  if (PUBLIC_ROUTES.includes(new URL(request.url).pathname)) {
    return json({ locale: "en", public: true });
  }

  try {
    const { session } = await shopify.authenticate.admin(request);

    const raw: string = (session as any).locale ?? "en";

    // pt-BR must be checked before base split
    if (raw.toLowerCase() === "pt-br") {
      setLocale("pt-BR");
      return json({ locale: "pt-BR", public: false });
    }

    // Normalize BCP-47 to base language code
    // "fr-CA" → "fr", "de-AT" → "de", "es-MX" → "es"
    const base = raw.toLowerCase().split("-")[0];

    // Only these 4 are supported — everything else gets English ( German/Spanish/French/Italy/Dutch/Portuguese)
    const SUPPORTED = ["es", "fr", "de","it","nl"];
    const localeId = SUPPORTED.includes(base) ? base : "en.default";

    setLocale(localeId);

    // Return the clean code to the client (not "en.default")
    const locale = localeId === "en.default" ? "en" : localeId;
    return json({ locale, public: false });
   // return json({ locale: "it" });
  } catch {
    setLocale("en.default");
    return json({ locale: "en", public: false });
  }
}

export default function App() {
  const { locale, public: isPublicRoute } = useLoaderData<typeof loader>();

  if (isPublicRoute) {
    // Standalone public page — no App Bridge, no embedded app chrome.
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <Meta />
          <Links />
        </head>
        <body>
          <Outlet />
          <Scripts />
        </body>
      </html>
    );
  }

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
