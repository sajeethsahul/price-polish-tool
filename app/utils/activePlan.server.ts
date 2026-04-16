import { getSubscription } from "../services/billing.server";

// ✅ 1. For UI (returns boolean)
export async function hasActivePlan(shop: string): Promise<boolean> {
  const subscription = await getSubscription(shop);
  return subscription?.status === "active";
}

// ✅ 2. For API protection (throws error)
export async function requireActivePlan(shop: string) {
  const subscription = await getSubscription(shop);

  if (!subscription || subscription.status !== "active") {
    throw new Response("Unauthorized", { status: 403 });
  }

  return subscription;
}