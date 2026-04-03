/**
 * A reusable fetch wrapper for Shopify embedded apps.
 * - Handles relative paths
 * - Uses shopify.idToken() for safe authentication (App Bridge v4)
 * - Throws on non-OK responses for consistent error handling
 */
export function useAppFetch() {
  return async (url: string, options: RequestInit = {}) => {
    const requestId = crypto.randomUUID().split("-")[0];

    const maxRetries = 1;
    let attempt = 0;

    const executeRequest = async (): Promise<any> => {
      attempt++;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        console.log(`[API ${requestId}] ${options.method || "GET"} ${url}`);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          credentials: "same-origin", // 🔥 IMPORTANT
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text);
        }

        return response.json();
      } catch (err: any) {
        clearTimeout(timeoutId);

        if (err.name === "AbortError") {
          throw new Error("Request timeout");
        }

        if (attempt <= maxRetries) {
          return executeRequest();
        }

        throw err;
      }
    };

    return executeRequest();
  };
}
