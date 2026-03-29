import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// ✅ Validate ENV properly
const appUrl = process.env.SHOPIFY_APP_URL;
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;

if (!appUrl) {
  throw new Error("SHOPIFY_APP_URL is missing");
}

if (!apiKey) {
  throw new Error("SHOPIFY_API_KEY is missing");
}

if (!apiSecret) {
  throw new Error("SHOPIFY_API_SECRET is missing");
}

// ✅ Debug log (keep for now)
console.log("APP URL:", appUrl);

// ✅ Shopify App Config
const shopify = shopifyApp({
  apiKey: apiKey,
  apiSecretKey: apiSecret,
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(",") || [],
  appUrl: appUrl,
  authPathPrefix: "/auth",

  sessionStorage: new PrismaSessionStorage(prisma) as any,

  distribution: AppDistribution.AppStore,

  isEmbeddedApp: true,

  // ✅ Required for iframe cookies (Render + Shopify)
  cookies: {
    sameSite: "none",
    secure: true,
  },

  // ✅ Prevent URL parsing issues (important fix)
  customShopDomains: [],

  future: {
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;

// ✅ Exports
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders =
  shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;