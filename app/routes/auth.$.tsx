import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { authenticate, login } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.pathname.endsWith("/auth/login")) {
    return login(request);
  }

  await authenticate.admin(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};