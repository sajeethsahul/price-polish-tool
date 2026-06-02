import prisma from "../db.server";

type PersistBillingStateArgs = {
  admin: { graphql: (query: string, options?: any) => Promise<Response> };
  shop: string;
  expectedPlanName: string;
  isTest: boolean;
};

type ActiveSubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  createdAt: string;
};

function normalizeStatus(status: unknown) {
  const value = typeof status === "string" ? status.toLowerCase() : "";
  if (!value) return "inactive";
  return value;
}

export async function persistBillingStateFromShopify({
  admin,
  shop,
  expectedPlanName,
  isTest,
}: PersistBillingStateArgs) {
  const response = await admin.graphql(`
    query BillingPersistenceActiveSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          createdAt
        }
      }
    }
  `);

  const payload = await response.json().catch(() => null) as any;
  if (!payload?.data?.currentAppInstallation) {
    console.warn("[BILLING] Unable to retrieve active subscriptions");
    return;
  }
  const subs = (payload?.data?.currentAppInstallation?.activeSubscriptions ?? []) as ActiveSubscription[];

  const matching =
    subs.find((s) => (s?.name ?? "").toLowerCase() === expectedPlanName.toLowerCase()) ?? subs[0];

  if (!matching) {
    await prisma.subscription.upsert({
      where: { shop },
      update: {
        status: "inactive",
        plan: expectedPlanName,
        subscriptionId: null,
        activatedAt: null,
        isTest,
      },
      create: {
        shop,
        status: "inactive",
        plan: expectedPlanName,
        subscriptionId: null,
        activatedAt: null,
        isTest,
      },
    });
    return;
  }

  const activatedAt = matching.createdAt ? new Date(matching.createdAt) : null;

  await prisma.subscription.upsert({
    where: { shop },
    update: {
      status: normalizeStatus(matching.status),
      plan: matching.name || expectedPlanName,
      subscriptionId: matching.id,
      activatedAt,
      isTest: Boolean(matching.test) || isTest,
    },
    create: {
      shop,
      status: normalizeStatus(matching.status),
      plan: matching.name || expectedPlanName,
      subscriptionId: matching.id,
      activatedAt,
      isTest: Boolean(matching.test) || isTest,
    },
  });
}