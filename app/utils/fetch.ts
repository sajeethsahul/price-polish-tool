import { useAppBridge } from "@shopify/app-bridge-react";

/**
 * A reusable fetch wrapper for Shopify embedded apps.
 * - Handles relative paths
 * - Prepared for future Authorization header usage
 * - Throws on non-OK responses for consistent error handling
 */
export function useAppFetch() {
  let shopify: any;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    shopify = useAppBridge();
  } catch (e) {
    shopify = null;
  }

  return async (url: string, options: RequestInit = {}) => {
    const requestId = crypto.randomUUID().split("-")[0];
    const isBypass = new URL(url, "http://dummy.com").searchParams.get("bypass") === "true";
    
    // 1. Prepare headers
    const headers = new Headers(options.headers);
    
    // 2. 🔥 HARD SAFETY GUARD: Session Token Injection (Browser-only)
    if (
      typeof window !== "undefined" && 
      shopify?.idToken && 
      !isBypass
    ) {
      try {
        // App Bridge v4 recommended way
        const token = await shopify.idToken();
        headers.set("Authorization", `Bearer ${token}`);
      } catch (e) {
        console.warn(`[API ${requestId}] IdToken fetch failed:`, e);
      }
    }

    const maxRetries = 2;
    let attempt = 0;

    const executeRequest = async (): Promise<any> => {
      attempt++;
      
      // 3. API TIMEOUT (8s)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        console.log(`[API ${requestId}] ${options.method || "GET"} ${url} (Attempt ${attempt})`);
        
        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // 4. TARGETED RETRY LOGIC (429/5xx)
        if ((response.status === 429 || response.status >= 500) && attempt <= maxRetries) {
          console.warn(`[API ${requestId}] Retryable status ${response.status}. Retrying in 500ms...`);
          await new Promise(r => setTimeout(r, 500));
          return executeRequest();
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        return response.json();
      } catch (err: any) {
        clearTimeout(timeoutId);
        
        if (err.name === "AbortError") {
          throw new Error("Request timed out after 8s");
        }
        
        if (attempt <= maxRetries && !(err instanceof TypeError)) {
           // Retry on network errors too (optional but safe for SaaS)
           await new Promise(r => setTimeout(r, 500));
           return executeRequest();
        }
        throw err;
      }
    };

    return executeRequest();
  };
}
