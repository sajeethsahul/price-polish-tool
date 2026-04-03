import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // 🔥 Shopify session exchange
  const auth = await authenticate.admin(request);

  // ================= CRITICAL FIX =================
  // Shopify sends this during session refresh
  const reload = url.searchParams.get("shopify-reload");

  if (reload) {
    console.log("SESSION TOKEN RELOAD →", reload);

    // ✅ MUST redirect browser (not return JSON)
    return new Response(null, {
      status: 302,
      headers: {
        Location: reload,
      },
    });
  }

  // ================= SAFETY =================
  // If Shopify returns redirect → return it (NOT throw)
  if ((auth as any)?.redirect) {
    return (auth as any).redirect;
  }

  // ================= SUCCESS =================
  // Return minimal safe response (NOT full auth object)
  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
};