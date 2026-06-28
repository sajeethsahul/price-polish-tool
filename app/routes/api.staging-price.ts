import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { stagePrices } from "../utils/staging.server";
import { requireActiveBilling } from "../utils/billing-protection.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const billingError = await requireActiveBilling(shop);
  if (billingError) return new Response(JSON.stringify(billingError), { status: 403 });

  const body = await request.json();

  const products = body?.products || [];
  const campaignId =
    typeof body?.campaignId === "string" && body.campaignId.length > 0
      ? body.campaignId
      : undefined;
  const campaignTitle =
    typeof body?.campaignTitle === "string" && body.campaignTitle.trim().length > 0
      ? body.campaignTitle.trim()
      : "Manual Apply Campaign";

  const result = await stagePrices(session.shop, products, campaignId);

  if (!result.success) {
    return new Response(
      JSON.stringify({ error: result.message }),
      { status: 400 }
    );
  }

  const appState = await prisma.appState.findUnique({
    where: { shop: session.shop },
  });
  const now = new Date();

  await prisma.appState.upsert({
    where: { shop: session.shop },
    update: {
      onboardingFirstApplyStartAt: appState?.onboardingFirstApplyStartAt ? undefined : now,
    },
    create: {
      shop: session.shop,
      isLive: appState?.isLive ?? false,
      onboardingFirstApplyStartAt: now,
    },
  });

  if (campaignId) {
    await prisma.campaign.upsert({
      where: { id: campaignId },
      update: { title: campaignTitle },
      create: {
        id: campaignId,
        shop: session.shop,
        title: campaignTitle,
        status: "draft",
        source: "apply",
      },
    });
    console.log("[Apply] campaign title persisted", { campaignId, campaignTitle });
  }

  if (!appState?.onboardingFirstApplyAt) {
    await prisma.appState.upsert({
      where: { shop: session.shop },
      update: { onboardingFirstApplyAt: now },
      create: { shop: session.shop, isLive: appState?.isLive ?? false, onboardingFirstApplyAt: now },
    });
  }

  if (!appState?.isLive) {
    return new Response(
      JSON.stringify({
        success: true,
        stagedOnly: true,
        stagedCount: result.successCount,
        failedCount: result.failedCount,
        ...(campaignId ? { campaignId } : {}),
        message: result.message,
      })
    );
  }

  return new Response(JSON.stringify({
    success: true,
    stagedCount: result.successCount,
    failedCount: result.failedCount,
    ...(campaignId ? { campaignId } : {}),
  }));
};
