import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { cors, handlePreflight } from "../utils/cors";

/**
 * Internal feedback intake for the post-revert review prompt.
 *
 * Stores 1–3-star feedback in the existing ActivityLog table (action
 * "REVERT_REVIEW_FEEDBACK", meta carries rating + comment + shop) so it lands
 * wherever support already triages activity. When SLACK_FEEDBACK_WEBHOOK_URL
 * is configured, the same payload is also posted to that Slack webhook.
 * Never links 1–3-star feedback to the public App Store listing.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await authenticate.admin(request);
  if (!auth?.session) {
    return cors(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const shop = auth.session.shop;

  const body = (await request.json().catch(() => null)) as {
    rating?: unknown;
    comment?: unknown;
  } | null;

  const rating = Number(body?.rating);
  const comment =
    typeof body?.comment === "string" ? body.comment.trim().slice(0, 2000) : "";

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return cors(
      new Response(JSON.stringify({ error: "Invalid rating" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const meta = { rating, comment, source: "revert_review_prompt" };

  try {
    await prisma.activityLog.create({
      data: { shop, action: "REVERT_REVIEW_FEEDBACK", meta },
    });
  } catch (error) {
    console.error("[FEEDBACK] failed to persist", { shop, error });
    return cors(
      new Response(JSON.stringify({ ok: false }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (webhookUrl) {
    // Fire-and-forget: intake is DB-backed, Slack is best-effort only.
    void fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Low-rating feedback from ${shop} (revert review prompt)\nRating: ${rating}/5\nComment: ${comment || "(none)"}`,
      }),
    }).catch((error) => console.error("[FEEDBACK] Slack post failed", error));
  }

  return cors(
    new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
};
