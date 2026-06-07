import prisma from "../db.server";

export type BillingSyncStatus =
  | "active"
  | "trialing"
  | "cancelled"
  | "frozen"
  | "expired"
  | "none"
  | "unknown";

export type PersistBillingParams = {
  shop: string;
  /**
   * The resolved result from `billing.require(...)` or `billing.check(...)`.
   * Pass the object directly — this function extracts the subscription
   * information from it without making an additional Shopify API call.
   */
  billingResult: Record<string, unknown>;
  /** Plan name used in the billing request (e.g. "basic"). */
  expectedPlanName?: string;
  /** Whether this is a test charge (development / Shopify review). */
  isTest?: boolean;
};

function extractSubscriptionFields(result: Record<string, unknown>): {
  plan: string;
  status: BillingSyncStatus;
  chargeId: string | null;
} {
  const appSubscriptions = result?.appSubscriptions as
    | Array<{
        id?: string | null;
        status?: string | null;
        name?: string | null;
        test?: boolean | null;
      }>
    | null
    | undefined;

  if (!appSubscriptions || appSubscriptions.length === 0) {
    return { plan: "none", status: "none", chargeId: null };
  }

  const sub = appSubscriptions[0];
  const rawStatus = (sub?.status ?? "unknown").toLowerCase();
  const plan = sub?.name ?? "basic";

  let normalizedStatus: BillingSyncStatus = "unknown";
  if (
    rawStatus === "active" ||
    rawStatus === "accepted" ||
    rawStatus === "approved"
  ) {
    normalizedStatus = "active";
  } else if (rawStatus === "trialing" || rawStatus === "trial") {
    normalizedStatus = "trialing";
  } else if (rawStatus === "cancelled" || rawStatus === "canceled") {
    normalizedStatus = "cancelled";
  } else if (rawStatus === "frozen") {
    normalizedStatus = "frozen";
  } else if (
    rawStatus === "expired" ||
    rawStatus === "declined" ||
    rawStatus === "pending"
  ) {
    normalizedStatus = "expired";
  }

  const chargeId = sub?.id ? String(sub.id).split("/").pop() ?? null : null;

  return { plan, status: normalizedStatus, chargeId };
}

/**
 * Persists (upserts) a Subscription row from Shopify billing state.
 *
 * Architecture: Shopify is the source of truth; this function caches that
 * state locally for fast UI reads and diagnostics. Persistence failures are
 * always non-fatal — this function never throws or blocks access.
 *
 * @param params.shop          - The shop domain (e.g. "merchant.myshopify.com").
 * @param params.billingResult - The resolved return value from `billing.require()`
 *                               or `billing.check()` (or a compatible object).
 * @param params.expectedPlanName - Plan name used in the request (informational only).
 * @param params.isTest        - Whether this is a test charge.
 */
export async function persistBillingStateFromShopify(
  params: PersistBillingParams
): Promise<void> {
  const { shop, billingResult, expectedPlanName, isTest } = params;

  try {
    const { plan, status, chargeId } = extractSubscriptionFields(billingResult);

    await prisma.subscription.upsert({
      where: { shop },
      update: {
        plan,
        status,
        chargeId,
        // expectedPlanName and isTest are informational; store in meta if needed
        // but Subscription schema does not have those fields — store in activity log
        updatedAt: new Date(),
      },
      create: {
        shop,
        plan,
        status,
        chargeId,
      },
    });

    console.log(
      `[BILLING SYNC] shop=${shop} plan=${plan} status=${status} chargeId=${chargeId ?? "none"} expectedPlan=${expectedPlanName ?? "none"} isTest=${isTest ?? false}`
    );
  } catch (err) {
    console.error(
      `[BILLING SYNC ERROR] shop=${shop} error=${
        err instanceof Error ? err.message : String(err)
      }`
    );
    // Fail-safe: never propagate. Merchants must not lose access because
    // a billing snapshot write failed.
  }
}
