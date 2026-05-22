import { useCallback } from "react";

/**
 * A reusable fetch wrapper for Shopify embedded apps.
 * - Handles relative paths
 * - Uses shopify.idToken() for safe authentication (App Bridge v4)
 * - Throws on non-OK responses for consistent error handling
 */
export function useAppFetch() {
  return useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);

    if (
      typeof window !== "undefined" &&
      (window as any).app
    ) {
      try {
        const token = await (window as any).app.idToken();
        headers.set("Authorization", `Bearer ${token}`);
      } catch (e) {
        console.warn("Token fetch failed");
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
        credentials: "same-origin",
      });

      clearTimeout(timeout);

      // 🔥 ALWAYS PARSE HERE
      const text = await response.text();

      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Invalid JSON response");
      }

      if (!response.ok) {
        throw new Error(data?.error || "Request failed");
      }

      return data; // ✅ ALWAYS JSON

    } catch (err: any) {
      clearTimeout(timeout);

      if (err.name === "AbortError") {
        throw new Error("Request timeout");
      }

      throw err;
    }
  }, []);
}
