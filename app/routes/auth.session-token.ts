import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // ================= AUTH =================
  // 🔥 MUST authenticate FIRST (Shopify expects this)
  const auth = await authenticate.admin(request);

  // ================= REDIRECT HANDLING =================
  // 🔥 If Shopify returns redirect → return it (never throw)
  if ((auth as any)?.redirect) {
    return (auth as any).redirect;
  }

  // ================= SHOPIFY RELOAD HANDLER =================
  // 🔥 Handle AFTER auth to avoid broken session context
  const reload = url.searchParams.get("shopify-reload");

  if (reload) {
    console.log("SESSION TOKEN RELOAD →", reload);

    return new Response(null, {
      status: 302,
      headers: {
        Location: reload,
      },
    });
  }

  // ================= SUCCESS =================
  // 🔥 Minimal safe response (DO NOT return full auth)
  return new Response(
    JSON.stringify({ ok: true }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
};