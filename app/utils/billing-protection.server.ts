import { getSubscriptionStatus, isBillingActive } from "./billing-status.server";

export type BillingInactiveResponse = {
  success: false;
  code: "BILLING_INACTIVE";
  message: "An active subscription is required to perform this action.";
};

export type BillingUnknownResponse = {
  success: false;
  code: "BILLING_UNKNOWN";
  message: "Billing status could not be verified. Please refresh the app and try again.";
};

/**
 * Mutation protection guard.
 *
 * Architecture:
 *   Shopify Billing  →  Source of Truth
 *   Subscription    →  Reconciled Cache (written on every app entry, Phase 12B.3)
 *
 * This helper does NOT call Shopify billing.check() — it reads the cached row.
 * The cache is always fresh for any merchant who has opened the app recently.
 *
 * Blocking behavior:
 *   - Subscription row absent  → 403 BILLING_UNKNOWN + warning log
 *   - Subscription.status inactive → 403 BILLING_INACTIVE + warning log
 *
 * Returns null if billing is active (caller proceeds).
 * Returns a 403-serializable error object otherwise.
 */
export async function requireActiveBilling(
  shop: string
): Promise<BillingInactiveResponse | BillingUnknownResponse | null> {
  const row = await getSubscriptionStatus(shop);

  if (!row) {
    console.warn(
      `[BILLING PROTECTION] BLOCKED — shop=${shop} reason=Subscription row not found`
    );
    return {
      success: false,
      code: "BILLING_UNKNOWN",
      message: "Billing status could not be verified. Please refresh the app and try again.",
    };
  }

  if (isBillingActive(row.status)) {
    return null;
  }

  console.warn(
    `[BILLING PROTECTION] BLOCKED — shop=${shop} status=${row.status}`
  );

  return {
    success: false,
    code: "BILLING_INACTIVE",
    message: "An active subscription is required to perform this action.",
  };
}
