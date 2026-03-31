/**
 * A reusable fetch wrapper for Shopify embedded apps.
 * - Handles relative paths
 * - Uses shopify.idToken() for safe authentication (App Bridge v4)
 * - Throws on non-OK responses for consistent error handling
 */
export function useAppFetch() {
  return async (url: string, options: RequestInit = {}) => {
    const requestId = crypto.randomUUID().split("-")[0];
    const isBypass = new URL(url, "http://dummy.com").searchParams.get("bypass") === "true";
    
    // 1. Prepare headers
    const headers = new Headers(options.headers);
    
    // 2. 🔥 SESSION TOKEN INJECTION (with window.app guard)
    if (
      typeof window !== "undefined" && 
      (window as any).app && 
      !isBypass
    ) {
      try {
        // App Bridge v4 uses .idToken() method
        const token = await (window as any).app.idToken();
        headers.set("Authorization", `Bearer ${token}`);
        console.log(`[API ${requestId}] Session token injected (v4)`);
      } catch (e) {
        console.warn(`[API ${requestId}] idToken failed:`, e);
      }
    }

    const maxRetries = 2;
    let attempt = 0;

    const executeRequest = async (): Promise<any> => {
      attempt++;
      
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
        console.log(`[API ${requestId}] STATUS: ${response.status}`);

        // 3. EXPLICIT 401 HANDLING
        if (response.status === 401) {
          console.warn(`[API ${requestId}] Session expired (401). Reloading app...`);
          if (typeof window !== "undefined") {
            window.location.reload();
          }
          throw new Error("Unauthorized (401). Reloading...");
        }

        // 4. TARGETED RETRY LOGIC (429/5xx)
        if ((response.status === 429 || response.status >= 500) && attempt <= maxRetries) {
          console.warn(`[API ${requestId}] Retryable status ${response.status}. Retrying in 500ms...`);
          await new Promise(r => setTimeout(r, 500));
          return executeRequest();
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[API ${requestId}] API ERROR:`, errorText);
          throw new Error(errorText || `Request failed with status ${response.status}`);
        }

        return response.json();
      } catch (err: any) {
        clearTimeout(timeoutId);
        
        if (err.name === "AbortError") {
          throw new Error("Request timed out after 8s");
        }
        
        if (attempt <= maxRetries && !(err instanceof TypeError) && err.message !== "Unauthorized (401). Reloading...") {
           await new Promise(r => setTimeout(r, 500));
           return executeRequest();
        }
        throw err;
      }
    };

    return executeRequest();
  };
}
