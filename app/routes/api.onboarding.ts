import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  const { session } = auth;
  const shop = session.shop;

  const state = await prisma.appState.findUnique({
    where: { shop },
    select: {
      shop: true,
      isLive: true,
      onboardingFirstRuleAt: true,
      onboardingFirstPreviewAt: true,
      onboardingFirstApplyStartAt: true,
      onboardingFirstApplyAt: true,
      onboardingFirstScheduleAt: true,
      onboardingCelebratedAt: true,
      reviewRequestShownAt: true,
      reviewRequestDismissedAt: true,
    },
  });

  return Response.json({ state });
};

type OnboardingEvent =
  | "celebration.dismiss"
  | "review.dismiss"
  | "review.shown";

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  const { session } = auth;
  const shop = session.shop;

  const body = await request.json().catch(() => ({}));
  const event = typeof body?.event === "string" ? (body.event as OnboardingEvent) : null;

  if (!event) {
    return Response.json({ error: "Missing event" }, { status: 400 });
  }

  const now = new Date();

  if (event === "celebration.dismiss") {
    await prisma.appState.upsert({
      where: { shop },
      update: { onboardingCelebratedAt: now },
      create: { shop, isLive: false, onboardingCelebratedAt: now },
    });
    return Response.json({ ok: true });
  }

  if (event === "review.dismiss") {
    await prisma.appState.upsert({
      where: { shop },
      update: { reviewRequestDismissedAt: now },
      create: { shop, isLive: false, reviewRequestDismissedAt: now },
    });
    return Response.json({ ok: true });
  }

  if (event === "review.shown") {
    await prisma.appState.upsert({
      where: { shop },
      update: { reviewRequestShownAt: now },
      create: { shop, isLive: false, reviewRequestShownAt: now },
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown event" }, { status: 400 });
};

