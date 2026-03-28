import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { login } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return login(request);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};