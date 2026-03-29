/**
 * Reusable CORS utility for Shopify API routes.
 * 
 * Target Origin: https://admin.shopify.com
 */

const ALLOWED_ORIGIN = "https://admin.shopify.com";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Shopify-Access-Token",
    "Access-Control-Allow-Credentials": "true",
};

/**
 * Adds CORS headers to a standard Response object.
 */
export function cors(response: Response): Response {
    const headers = new Headers(response.headers);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        headers.set(key, value);
    });

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

/**
 * Handles OPTIONS preflight requests.
 * Returns a 204 No Content response with CORS headers.
 */
export function handlePreflight(request: Request): Response | null {
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: new Headers(CORS_HEADERS),
        });
    }
    return null;
}
