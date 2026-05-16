import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { stagePrices } from "../utils/staging.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = await request.json();

  const products = body?.products || [];
  const campaignId =
    typeof body?.campaignId === "string" && body.campaignId.length > 0
      ? body.campaignId
      : undefined;

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