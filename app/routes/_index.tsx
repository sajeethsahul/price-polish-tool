import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // 🔥 Let Shopify handle auth properly
  const auth = await authenticate.admin(request);

  // ✅ CRITICAL: handle redirect from Shopify
  if (auth?.redirect) {
    return auth.redirect;
  }

  // ✅ If already authenticated → go to app
  return redirect("/app" + url.search);
};

export default function Index() {
  return null;
}