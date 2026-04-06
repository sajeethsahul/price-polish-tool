import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  // ✅ If no shop → go to login
  if (!shop) {
    return redirect("/auth/login");
  }

  // ✅ Let Shopify handle auth internally (NO redirect logic here)
  await authenticate.admin(request);

  // ✅ Once authenticated → go to app
  return redirect("/app" + url.search);
};

export default function Index() {
  return null;
}