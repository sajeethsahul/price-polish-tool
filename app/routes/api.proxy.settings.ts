import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

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
    console.error("[PROXY] ❌ MISSING SHOP PARAM");

    return new Response(
      JSON.stringify({ error: "Missing shop parameter" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
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

    // ================= FETCH LATEST APPLIED PRICES =================
    const polishedProducts = await prisma.priceHistory.findMany({
      where: { shop },
      select: {
        variantId: true,
        newPrice: true,
      },
      distinct: ["variantId"],
      orderBy: [
        { variantId: "asc" },
        { createdAt: "desc" },
      ],
    });

    console.log("[PROXY] DATA FETCHED", {
      shop,
      productsCount: polishedProducts.length,
    });

    // ================= RESPONSE =================
    const settings = {
      markup: rule?.liveMarkupPercent ?? 0,
      charm: rule?.liveCharmPricing ?? false,
      rounding: rule?.liveRoundingStep ?? 0,
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