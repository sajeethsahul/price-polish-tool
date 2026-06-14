import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

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

  // ✅ If no shop → go to login
  if (!shop) {
    console.log("[REDIRECT TRACE]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", 302);
    console.log("LOCATION:", "/auth/login");
    return redirect("/auth/login");
  }

  // ✅ Let Shopify handle auth internally (NO redirect logic here)
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) {
    console.log("[AUTH/BILLING REDIRECT]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", auth.status);
    console.log("LOCATION:", auth.headers.get("Location"));
    return toTopLevelRedirect(auth);
  }

  // ✅ Once authenticated → go to app
  console.log("[REDIRECT TRACE]");
  console.log("REQUEST:", request.url);
  console.log("STATUS:", 302);
  console.log("LOCATION:", "/app" + url.search);
  return redirect("/app" + url.search);
};

export default function Index() {
  return null;
}
