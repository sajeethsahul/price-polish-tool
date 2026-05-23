import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { isWindowActive } from "../utils/window-lifecycle";

type ProxyPriceRow = {
  variantId: string;
  campaignId: string | null;
  newPrice: number;
  revertStatus: string | null;
};

type ProxyCampaignState = {
  id: string;
  status: string;
  source: string | null;
  runAt: Date | null;
  windowEndAt: Date | null;
};

function isClosedCampaignStatus(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  return normalized === "reverted" ||
    normalized === "unrecoverable" ||
    normalized === "auto-restored";
}

function isActiveWindowCampaign(campaign: ProxyCampaignState, now: Date) {
  const status = campaign.status.toLowerCase();
  const source = (campaign.source ?? "").toLowerCase();

  return source === "schedule-window" &&
    status === "active-window" &&
    isWindowActive(campaign, now);
}

function qualifiesForStorefrontInfluence(
  row: ProxyPriceRow,
  campaignById: Map<string, ProxyCampaignState>,
  now: Date
) {
  const revertStatus = (row.revertStatus ?? "").toLowerCase();
  if (revertStatus === "reverted" || revertStatus === "unrecoverable") {
    return false;
  }

  if (!row.campaignId) {
    return true;
  }

  const campaign = campaignById.get(row.campaignId);
  if (!campaign) {
    return false;
  }

  const source = (campaign.source ?? "").toLowerCase();
  const status = campaign.status.toLowerCase();

  if (source === "schedule-window" || status.includes("window")) {
    return isActiveWindowCampaign(campaign, now);
  }

  return !isClosedCampaignStatus(campaign.status);
}

// Handles: /api/proxy/settings
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let shop = url.searchParams.get("shop");

  console.log("[PROXY] HIT", {
    url: request.url,
  });

  // ================= FALLBACK SHOP DETECTION =================
  if (!shop) {
    const referer = request.headers.get("referer");

    if (referer) {
      const match = referer.match(/https:\/\/(.*?)\//);
      if (match) {
        shop = match[1];
      }
    }
  }

  // ================= VALIDATION =================
      if (!shop) {
      const shop = url.searchParams.get("shop");

        console.warn("[PROXY] Missing shop param — returning safe empty response");

        return new Response(JSON.stringify({
          markup: 0,
          charm: false,
          rounding: 0,
          manualIds: [],
          appliedPrices: []
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
  

  try {
    console.log("[PROXY] FETCH START", { shop });

    // ================= FETCH RULE =================
    const rule = await prisma.pricingRule.findUnique({
      where: { shop },
    });

    if (!rule) {
      console.warn("[PROXY] ⚠️ NO RULE FOUND", { shop });
    }

    // ================= FETCH ACTIVE STOREFRONT INFLUENCE =================
    const latestRows = await prisma.priceHistory.findMany({
      where: { shop },
      select: {
        variantId: true,
        campaignId: true,
        newPrice: true,
        revertStatus: true,
      },
      distinct: ["variantId"],
      orderBy: [
        { variantId: "asc" },
        { createdAt: "desc" },
      ],
    });

    const campaignIds = [
      ...new Set(
        latestRows
          .map((row) => row.campaignId)
          .filter((campaignId): campaignId is string => typeof campaignId === "string" && campaignId.length > 0)
      ),
    ];

    const campaigns = campaignIds.length > 0
      ? await (prisma.campaign as any).findMany({
          where: {
            shop,
            id: { in: campaignIds },
          },
          select: {
            id: true,
            status: true,
            source: true,
            runAt: true,
            windowEndAt: true,
          },
        }) as ProxyCampaignState[]
      : [];

    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const now = new Date();
    const polishedProducts = latestRows.filter((row) =>
      qualifiesForStorefrontInfluence(row, campaignById, now)
    );

    console.log("[PROXY] DATA FETCHED", {
      shop,
      productsCount: polishedProducts.length,
      excludedInactiveCount: latestRows.length - polishedProducts.length,
    });

    // ================= RESPONSE =================
    const liveMarkupPercent = rule?.liveMarkupPercent ?? 0;
    const liveCharmPricing = rule?.liveCharmPricing ?? false;
    const liveRoundingStep = rule?.liveRoundingStep ?? 0;
    const liveEndingOption = rule?.liveEndingOption ?? (liveCharmPricing ? "0.99" : (liveRoundingStep > 0 ? Number(liveRoundingStep).toFixed(2) : "none"));
    const liveRoundingPrecision = rule?.liveRoundingPrecision ?? "standard";
    const liveAdjustmentType = rule?.liveAdjustmentType ?? "percentage";
    const liveAdjustmentDirection = liveAdjustmentType === "percentage"
      ? (liveMarkupPercent < 0 ? "decrease" : "increase")
      : (rule?.liveAdjustmentDirection ?? "increase");
    const liveAdjustmentValue = liveAdjustmentType === "percentage"
      ? Math.abs(liveMarkupPercent)
      : (rule?.liveAdjustmentValue ?? 0);
    const liveMinPrice = rule?.liveMinPrice ?? null;
    const liveMaxPrice = rule?.liveMaxPrice ?? null;

    const settings = {
      markup: liveMarkupPercent,
      charm: liveCharmPricing,
      rounding: liveRoundingStep,
      adjustmentType: liveAdjustmentType,
      adjustmentDirection: liveAdjustmentDirection,
      adjustmentValue: liveAdjustmentValue,
      endingOption: liveEndingOption,
      roundingPrecision: liveRoundingPrecision,
      minPrice: liveMinPrice,
      maxPrice: liveMaxPrice,
      manualIds: polishedProducts.map((p) => p.variantId),
      appliedPrices: polishedProducts.map((p) => p.newPrice),
    };

    console.log("[PROXY] SUCCESS", {
      shop,
      products: polishedProducts.length,
      hasRule: !!rule,
    });

    return new Response(JSON.stringify(settings), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });

  } catch (error: any) {
    console.error("[PROXY] ❌ ERROR", {
      shop,
      message: error.message,
    });

    return new Response(
      JSON.stringify({ error: "Error fetching settings" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
