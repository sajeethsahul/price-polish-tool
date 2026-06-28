import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordShopUninstall } from "../utils/shop-lifecycle.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await recordShopUninstall({ shop });

  await db.appState.updateMany({
    where: { shop },
    data: {
      onboardingCompletedAt: null,
      onboardingFirstRuleAt: null,
      onboardingFirstPreviewAt: null,
      onboardingFirstApplyStartAt: null,
      onboardingFirstApplyAt: null,
      onboardingFirstScheduleAt: null,
      onboardingCelebratedAt: null,
      reviewRequestShownAt: null,
      reviewRequestDismissedAt: null,
    },
  });
  console.log("[ONBOARDING RESET]", {
    shop,
    reason: "APP_UNINSTALLED",
  });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
