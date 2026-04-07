import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

// Handles: /api/proxy/settings
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  console.log("🔁 PROXY HIT:", request.url);

  // ================= VALIDATION =================
  if (!shop) {
    console.error("❌ PROXY ERROR: Missing shop parameter");
    return new Response("Missing shop parameter", { status: 400 });
  }

  try {
    // ================= FETCH RULE =================
    const rule = await prisma.pricingRule.findUnique({
      where: { shop },
    });

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

    // ================= RESPONSE =================
    const settings = {
      markup: rule?.liveMarkupPercent ?? 0,
      charm: rule?.liveCharmPricing ?? false,
      rounding: rule?.liveRoundingStep ?? 0,
      manualIds: polishedProducts.map((p) => p.variantId),
      appliedPrices: polishedProducts.map((p) => p.newPrice),
    };

    console.log("✅ PROXY SUCCESS:", {
      shop,
      products: polishedProducts.length,
    });

    return new Response(JSON.stringify(settings), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error) {
    console.error("❌ PROXY ERROR: Failed to fetch settings:", error);

    return new Response("Error fetching settings", {
      status: 500,
    });
  }
};