import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * A reusable fetch wrapper for Shopify embedded apps.
 * - Handles relative paths
 * - Prepared for future Authorization header usage
 * - Throws on non-OK responses for consistent error handling
 */
export async function useAppFetch() {
  // Access shopify instance if available (to get session token in the future)
  // Note: This must be called inside a component that has App Bridge context.
  let shopify: any;
  try {
    shopify = useAppBridge();
  } catch (e) {
    // Fail silently or handle bypass mode safely
    shopify = null;
  }

  return async (url: string, options: RequestInit = {}) => {
    // 1. Prepare headers
    const headers = new Headers(options.headers);
    
    // 2. Future-proofing: Get session token if possible
    // In many Shopify apps, you'd use getSessionToken(shopify) here.
    // For now, we prepare the structure as requested.
    if (shopify && !headers.has("Authorization")) {
      // const token = await getSessionToken(shopify);
      // headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }

    return response.json();
  };
}
