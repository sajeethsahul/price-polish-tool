import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  // If no shop → go to login
  if (!shop) {
    return redirect("/auth/login");
  }

  // If shop exists → trigger OAuth
  await authenticate.admin(request);

  return null;
};