import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import type { EntryContext } from "react-router";
import { isbot } from "isbot";


export const streamTimeout = 5000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  // ✅ SAFE REQUEST FIX
  let safeRequest = request;

  try {
    new URL(request.url);
  } catch {
    const fallbackUrl = `${process.env.SHOPIFY_APP_URL}/app`;
    safeRequest = new Request(fallbackUrl, request);
  }





  const userAgent = request.headers.get("user-agent");

  const callbackName = isbot(userAgent ?? "")
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={safeRequest.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          
          // 🔥 MANDATORY SHOPIFY CSP
          responseHeaders.set(
            "Content-Security-Policy",
            [
              // ✅ Allow Shopify Admin to embed this app in an iframe
              "frame-ancestors https://admin.shopify.com https://admin.shopify.com/store/* https://*.myshopify.com https://*.shopify.com",
              // ✅ Allow App Bridge CDN script + inline scripts React needs
              "script-src 'self' 'unsafe-inline' https://cdn.shopify.com",
              // ✅ Allow fetch/GraphQL calls to Shopify APIs + your own app
              `connect-src 'self' https://*.shopify.com https://*.myshopify.com ${process.env.SHOPIFY_APP_URL ?? ""}`,
              // ✅ Allow images from Shopify CDN
              "img-src 'self' data: https://cdn.shopify.com",
              // ✅ Allow styles from Shopify CDN (Polaris)
              "style-src 'self' 'unsafe-inline' https://cdn.shopify.com https://unpkg.com",
            ].join("; ")
          );

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },

        onShellError(error) {
          reject(error);
        },

        onError(error) {
          console.error(error);
        },
      }
    );

    setTimeout(abort, streamTimeout + 1000);
  });
}