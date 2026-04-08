import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BillingInterval } from "@shopify/shopify-api";
import { BILLING_PLANS } from "./config/billing";

// 🔥 ENV VALIDATION (STRICT)
const appUrl = process.env.SHOPIFY_APP_URL;
export const shopifyApiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET;
const scopes = process.env.SCOPES;

if (!appUrl) throw new Error("SHOPIFY_APP_URL is missing");
if (!shopifyApiKey) throw new Error("SHOPIFY_API_KEY is missing");
if (!apiSecret) throw new Error("SHOPIFY_API_SECRET is missing");

// 🔥 CRITICAL: Ensure valid URL format
if (!appUrl.startsWith("https://")) {
  throw new Error("SHOPIFY_APP_URL must start with https://");
}

// 🔍 Debug (keep temporarily)
console.log("✅ SHOPIFY_APP_URL:", appUrl);

// 🚀 SHOPIFY APP CONFIG
const shopify = shopifyApp({
  apiKey: shopifyApiKey,
  apiSecretKey: apiSecret,
  apiVersion: ApiVersion.October24,

  scopes: scopes ? scopes.split(",") : [],

  appUrl, // ✅ MUST be valid HTTPS URL
  authPathPrefix: "/auth",

  sessionStorage: new PrismaSessionStorage(prisma) as any,

  // ✅ MUST for multi-store testing
  distribution: AppDistribution.AppStore,

  isEmbeddedApp: true,

    billing: {
      basic: {
        lineItems: [
          {
            amount: BILLING_PLANS.BASIC.amount,
            currencyCode: BILLING_PLANS.BASIC.currencyCode,
            interval: BILLING_PLANS.BASIC.interval as any,
          },
        ],
        trialDays: BILLING_PLANS.BASIC.trialDays,
      },
    },

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