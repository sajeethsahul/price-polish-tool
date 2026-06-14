import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // ================= SHOPIFY RELOAD HANDLER =================
  const reload = url.searchParams.get("shopify-reload");

  if (reload) {
    console.log("SESSION TOKEN RELOAD →", reload);

    // ✅ CRITICAL FIX: DO NOT REDIRECT
    return new Response(null, {
      status: 204, // 🔥 MUST be 204 (no content)
    });
  }

  // ================= AUTH =================
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) {
    console.log("[AUTH/BILLING REDIRECT]");
    console.log("REQUEST:", request.url);
    console.log("STATUS:", auth.status);
    console.log("LOCATION:", auth.headers.get("Location"));
    return auth;
  }

  // ================= SUCCESS =================
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
