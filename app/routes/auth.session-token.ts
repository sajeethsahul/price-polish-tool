import { authenticate } from "../shopify.server";
import { type LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);

  // ✅ CRITICAL: Handle Shopify's background reload
  const url = new URL(request.url);
  const reload = url.searchParams.get("shopify-reload");

  if (reload) {
    return new Response(null, {
      status: 302,
      headers: { Location: reload },
    });
  }

  // Return the auth object (session token exchange success)
  return auth;
};
