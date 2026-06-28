import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { authenticate, login } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/polaris";
import { AppLaunchSplash } from "../components/AppLaunchSplash";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const toTopLevelRedirect = (response: Response): Response => {
    const location = response.headers.get("Location");
    console.log("[REDIRECT TRACE]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", response.status);
    console.log("LOCATION:", location);

    if (!location) return response;
    if (!location.startsWith("https://admin.shopify.com")) return response;

    const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><script>window.top.location.href=${JSON.stringify(location)};</script></body></html>`;
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  };

  if (url.pathname.endsWith("/auth/login")) {
    const res = await login(request);
    if (res instanceof Response) {
      console.log("[AUTH/BILLING REDIRECT]");
      console.log("REQUEST:", request.url);
      console.log("STATUS:", res.status);
      console.log("LOCATION:", res.headers.get("Location"));
      return toTopLevelRedirect(res);
    }
    return res;
  }

  const auth = await authenticate.admin(request);
  if (auth instanceof Response) {
    console.log("[AUTH/BILLING REDIRECT]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", auth.status);
    console.log("LOCATION:", auth.headers.get("Location"));
    return toTopLevelRedirect(auth);
  }

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function AuthSplash() {
  return (
    <AppProvider i18n={{}}>
      <AppLaunchSplash />
    </AppProvider>
  );
}
