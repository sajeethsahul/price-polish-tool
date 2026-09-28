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
      onboardingCompletedAt: true,
      onboardingCelebratedAt: true,
      reviewRequestShownAt: true,
      reviewRequestDismissedAt: true,
      revertReviewPromptShownAt: true,
      revertReviewPromptDismissedAt: true,
    },
  });

  return Response.json({ state });
};

type OnboardingEvent =
  | "celebration.dismiss"
  | "onboarding.started"
  | "review.dismiss"
  | "review.shown"
  | "revert-review.shown"
  | "revert-review.dismiss";

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;

  const { session } = auth;
  const shop = session.shop;

  let body: Record<string, unknown> = {};
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    body = await request.json().catch(() => ({}));
  } else {
    const form = await request.formData().catch(() => null);
    if (form) {
      body = Object.fromEntries(form.entries());
    } else {
      body = await request.json().catch(() => ({}));
    }
  }

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

  if (event === "onboarding.started") {
    await prisma.activityLog.create({
      data: {
        shop,
        action: "ONBOARDING_STARTED",
        meta: {},
      },
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

  // Post-revert review prompt lifecycle. shownAt is written ONCE (first
  // display) and never overwritten, so "show only once ever" plus the
  // 90-day dismissal cooldown can both be derived from the pair.
  if (event === "revert-review.shown") {
    const existing = await prisma.appState.findUnique({
      where: { shop },
      select: { revertReviewPromptShownAt: true },
    });
    if (!existing?.revertReviewPromptShownAt) {
      await prisma.appState.upsert({
        where: { shop },
        update: { revertReviewPromptShownAt: now },
        create: { shop, isLive: false, revertReviewPromptShownAt: now },
      });
    }
    return Response.json({ ok: true });
  }

  if (event === "revert-review.dismiss") {
    await prisma.appState.upsert({
      where: { shop },
      update: { revertReviewPromptDismissedAt: now },
      create: { shop, isLive: false, revertReviewPromptDismissedAt: now },
    });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown event" }, { status: 400 });
};
