import { useAppBridge } from "@shopify/app-bridge-react";

export function useSafeAppBridge() {
    try {
        if (typeof window === "undefined") return null;

        // 🔥 CRITICAL CHECK
        if (!(window as any).shopify) return null;

        return useAppBridge();
    } catch {
        return null;
    }
}