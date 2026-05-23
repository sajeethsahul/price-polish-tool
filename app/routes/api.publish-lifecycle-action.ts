import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  return cors(new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await authenticate.admin(request);
  if (!auth?.session) throw new Response("Unauthorized", { status: 401 });

  const shop = auth.session.shop;
  const body = await request.json().catch(() => ({}));
  const campaignId =
    typeof body?.campaignId === "string" && body.campaignId.length > 0
      ? body.campaignId
      : null;

  if (!campaignId || body?.action !== "cancel-publish") {
    return cors(new Response(JSON.stringify({ error: "Choose a valid publish action." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }));
  }

  const campaign = await (prisma.campaign as any).findFirst({
    where: {
      id: campaignId,
      shop,
      source: "schedule",
    },
    select: {
      id: true,
      status: true,
      runAt: true,
    },
  });

  if (!campaign) {
    return cors(new Response(JSON.stringify({ error: "Scheduled publish was not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }));
  }

  if (campaign.status !== "scheduled-publish" || new Date(campaign.runAt).getTime() <= Date.now()) {
    return cors(new Response(JSON.stringify({
      error: "This publish has already started and can no longer be cancelled.",
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    }));
  }

  const job = await (prisma.scheduledJob as any).findFirst({
    where: {
      shop,
      campaignId,
      mode: "one-time",
      status: "pending",
    },
    select: { id: true },
  });

  await prisma.$transaction([
    (prisma.scheduledJob as any).updateMany({
      where: {
        shop,
        campaignId,
        mode: "one-time",
        status: "pending",
      },
      data: { status: "cancelled" },
    }),
    (prisma.campaign as any).updateMany({
      where: { id: campaignId, shop },
      data: { status: "cancelled-publish" },
    }),
    prisma.stagedPrice.deleteMany({ where: { shop, campaignId } }),
    prisma.activityLog.create({
      data: {
        shop,
        action: "PUBLISH_CANCELLED",
        meta: { campaignId, jobId: job?.id ?? null },
      },
    }),
  ]);

  return cors(new Response(JSON.stringify({
    success: true,
    status: "cancelled-publish",
    message: "Scheduled publish cancelled before it started.",
  }), {
    headers: { "Content-Type": "application/json" },
  }));
};
