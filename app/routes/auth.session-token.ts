import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // ================= SHOPIFY RELOAD HANDLER =================
  // 🔥 MUST be BEFORE authenticate (prevents infinite loop)
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

  // ================= AUTH =================
  const auth = await authenticate.admin(request);

  // ================= REDIRECT HANDLING =================
  // 🔥 NEVER throw → always return
  if ((auth as any)?.redirect) {
    return (auth as any).redirect;
  }

  // ================= SUCCESS =================
  // 🔥 KEEP RESPONSE MINIMAL (IMPORTANT)
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