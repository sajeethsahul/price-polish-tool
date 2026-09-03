export const BILLING_PLANS = {
  FREE: {
    name: "free" as const,
    amount: 0,
    currencyCode: "USD",
    interval: "Every30Days",
    trialDays: 0,
    limits: {
      campaignsPerMonth: 2,
      productsPerCampaign: 50,
    },
  },
  BASIC: {
    name: "basic" as const,
    amount: 9.99,
    currencyCode: "USD",
    interval: "Every30Days",
    trialDays: 14,
    limits: {
      campaignsPerMonth: null, // unlimited
      productsPerCampaign: 1000,
    },
  },
};
