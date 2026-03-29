import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// 🔥 ENV VALIDATION (STRICT)
const appUrl = process.env.SHOPIFY_APP_URL;
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;
const scopes = process.env.SCOPES;

if (!appUrl) throw new Error("SHOPIFY_APP_URL is missing");
if (!apiKey) throw new Error("SHOPIFY_API_KEY is missing");
if (!apiSecret) throw new Error("SHOPIFY_API_SECRET is missing");

// 🔥 CRITICAL: Ensure valid URL format
if (!appUrl.startsWith("https://")) {
  throw new Error("SHOPIFY_APP_URL must start with https://");
}

// 🔍 Debug (keep temporarily)
console.log("✅ SHOPIFY_APP_URL:", appUrl);

// 🚀 SHOPIFY APP CONFIG
const shopify = shopifyApp({
  apiKey,
  apiSecretKey: apiSecret,
  apiVersion: ApiVersion.October24,

  scopes: scopes ? scopes.split(",") : [],

  appUrl, // ✅ MUST be valid HTTPS URL
  authPathPrefix: "/auth",

  sessionStorage: new PrismaSessionStorage(prisma) as any,

  // ✅ MUST for multi-store testing
  distribution: AppDistribution.AppStore,

  isEmbeddedApp: true,

  // 🔥 REQUIRED for iframe (Render + Shopify)
  cookies: {
    sameSite: "none",
    secure: true,
  },

  future: {
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;

// ✅ REQUIRED EXPORTS
export const apiVersion = ApiVersion.October25;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;