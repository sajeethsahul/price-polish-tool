import prisma from "../db.server";

// ─── Shared types ──────────────────────────────────────────────────────────────

export type BillingStatusValue =
  | "active"
  | "trialing"
  | "cancelled"
  | "frozen"
  | "expired"
  | "none"
  | "unknown";

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

// ─── Normalization ─────────────────────────────────────────────────────────────

/**
 * Normalizes a raw Shopify subscription status string into a BillingStatusValue.
 * Handles GID-prefixed values, alternate spellings, and unknown inputs.
 */
export function normalizeBillingStatus(
  raw: string | null | undefined
): BillingStatusValue {
  const s = (raw ?? "unknown").toLowerCase().trim();

  if (s === "active" || s === "accepted" || s === "approved") return "active";
  if (s === "trialing" || s === "trial") return "trialing";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "frozen") return "frozen";
  if (s === "expired" || s === "declined" || s === "pending") return "expired";
  if (s === "none" || s === "") return "none";
  return "unknown";
}

/**
 * Returns true when billing is considered active — merchants may use the app freely.
 * Active: active, trialing
 * Inactive: cancelled, expired, frozen, none, unknown
 */
export function isBillingActive(status: BillingStatusValue): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * Extracts the normalized BillingStatusValue from a raw Shopify billing.check()
 * or billing.require() result object.
 */
export function normalizeBillingFromResult(
  result: Record<string, unknown>
): BillingStatusValue {
  const appSubscriptions = result?.appSubscriptions as
    | Array<{ status?: string | null }>
    | null
    | undefined;

  if (!appSubscriptions || appSubscriptions.length === 0) {
    return "none";
  }

  return normalizeBillingStatus(appSubscriptions[0]?.status);
}

// ─── Database cache helpers ─────────────────────────────────────────────────────

/**
 * Reads the Subscription row for a shop and returns the normalized BillingStatusValue.
 * Returns null if the row does not exist.
 */
export async function getSubscriptionStatus(
  shop: string
): Promise<{ status: BillingStatusValue } | null> {
  const row = await prisma.subscription.findUnique({
    where: { shop },
    select: { status: true },
  });

  if (!row) return null;

  return { status: normalizeBillingStatus(row.status) };
}
