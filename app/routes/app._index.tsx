import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useNavigate, useOutletContext } from "react-router";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Banner,
  Spinner,
  Divider,
  Thumbnail,
  Modal,
  ProgressBar,
  TextField,
  Pagination,
  Box,
  Checkbox,
  Select,
  Grid,
  Tooltip,
  Icon,
  SkeletonPage,
} from "@shopify/polaris";
import {
  InfoIcon,
  RefreshIcon,
  CalendarTimeIcon,
  ArrowDownIcon,
  UndoIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@shopify/polaris-icons";
import { formatMoney, getCurrencySymbol, ZERO_DECIMAL_CURRENCIES } from "../utils/format";
import { useAppFetch } from "../utils/fetch";
import { ScheduledHistoryModal } from "../components/ScheduledHistoryModal";
import {
  ImmediateApplyConfirmationModal,
  type ImmediateApplyImpactSummary,
} from "../components/ImmediateApplyConfirmationModal";
import type { OperationalSafeguardNotice, PricingPreviewItem } from "../types/pricing";
import { calculatePrice } from "../utils/pricing";


const BATCH_SIZE = 50;
const PAGE_SIZE = 15;
const CAMPAIGN_DETAIL_COMPARISON_GRID = "minmax(0, 1fr) 132px 132px minmax(96px, auto)";
const REVERT_PREVIEW_COMPARISON_GRID = "minmax(0, 1fr) 132px 132px";
const LARGE_OPERATION_THRESHOLD = 100;
const VERY_LARGE_OPERATION_THRESHOLD = 250;
const MOST_VISIBLE_SCOPE_RATIO = 0.8;
const SIGNIFICANT_MOVEMENT_THRESHOLD = 25;
const MAJOR_MOVEMENT_THRESHOLD = 40;

type PreviewItem = PricingPreviewItem;
type ImmediateApplyScope = "all" | "selected" | "single";

interface LastUpdateInfo {
  batchId: string;
  updatedAt: string;
  successCount: number;
  failedCount: number;
}

interface CampaignHistoryItem {
  campaignId: string;
  title: string;
  status: string;
  createdAt: string;
  productCount: number;
  source: string | null;
  latestBatchId: string | null;
  revertable: boolean;
  unrecoverableReason: string | null;
  revertedCount: number;
  failedCount: number;
  unrecoverableCount: number;
  totalTrackedCount: number;
}

interface CampaignRevertPreviewRow {
  variantId: string;
  productTitle: string;
  currentPrice: number | null;
  revertTargetPrice: number;
  status?: string;
  revertFailureReason?: string | null;
}

interface CampaignRevertPreviewData {
  campaignId: string | null;
  title: string;
  productCount: number;
  latestBatchId: string | null;
  revertCompletedAt?: string | null;
  rows: CampaignRevertPreviewRow[];
  revertedCount?: number;
  failedCount?: number;
  unrecoverableCount?: number;
  totalTrackedCount?: number;
  missingHistoricalRevertedFromCount?: number;
  terminal?: boolean;
  message?: string | null;
}

interface StorefrontControlMetrics {
  influencedVariantCount: number;
  stagedPendingCount: number;
  retryableRevertCount: number;
  unrecoverableCount: number;
  latestInfluenceAt: string;
  openCampaignCount: number;
  closedCampaignCount: number;
  canGoLive: boolean;
  goLiveMessage: string;
}

interface DashboardMetrics {
  totalApplied: number;
  lastUpdate: string;
  successRate: number;
  isLive: boolean;
  hasActivePlan: boolean;
  storefrontControl: StorefrontControlMetrics;
}

const DEFAULT_STOREFRONT_CONTROL_METRICS: StorefrontControlMetrics = {
  influencedVariantCount: 0,
  stagedPendingCount: 0,
  retryableRevertCount: 0,
  unrecoverableCount: 0,
  latestInfluenceAt: "",
  openCampaignCount: 0,
  closedCampaignCount: 0,
  canGoLive: false,
  goLiveMessage: "No staged prices are ready. Apply pricing before going live.",
};

const DEFAULT_DASHBOARD_METRICS: DashboardMetrics = {
  totalApplied: 0,
  lastUpdate: "",
  successRate: 100,
  isLive: false,
  hasActivePlan: true,
  storefrontControl: DEFAULT_STOREFRONT_CONTROL_METRICS,
};

type TimelineTone = "success" | "warning" | "critical" | "info" | "attention";

interface CampaignTimelineMilestone {
  key: string;
  label: string;
  tone: TimelineTone;
  badgeLabel?: string;
  timestamp?: string | null;
  description: string;
}

type CampaignHistoryStatusFilter = "all" | "active" | "partial" | "scheduled" | "closed";
type CampaignHistorySourceFilter = "all" | "manual" | "scheduled";
type RevertPreviewMovementFilter = "all" | "increase" | "decrease" | "large_movement";

const OPERATIONAL_PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 25];
const SELECT_OPTION_PREFIX = "\u2002";
const REVERT_PREVIEW_DEFAULT_PAGE_SIZE = 15;
const REVERT_PREVIEW_LARGE_MOVEMENT_THRESHOLD = 15;

function normalizeCampaignStatus(status: string) {
  return status.toLowerCase();
}

function isClosedCampaignStatus(status: string) {
  const normalized = normalizeCampaignStatus(status);
  return normalized === "reverted" || normalized === "unrecoverable";
}

function normalizeCampaignSource(source: string | null) {
  return (source ?? "").trim().toLowerCase();
}

// ─── Animated Loader ───────────────────────────────────────────────────────
const LOADER_MESSAGES = [
  "Counting your coins... 🪙",
  "Polishing prices to perfection ✨",
  "Bribing the pricing gods... 💸",
  "Calculating your empire's worth... 👑",
  "Making numbers look their best 💅",
  "Sharpening pencils & raising margins ✏️",
  "Teaching prices to stand tall 📈",
  "Asking Jeff Bezos for advice... 🚀",
  "Rounding up the usual suspects 🔍",
  "One moment — we're printing money 🖨️",
];

function DashboardLoader() {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setMsgIndex(i => (i + 1) % LOADER_MESSAGES.length);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "70vh",
      gap: "28px",
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <style>{`
        @keyframes pp-bounce {
          0%, 100% { transform: translateY(0) rotate(-5deg); }
          40%       { transform: translateY(-22px) rotate(8deg) scale(1.15); }
          60%       { transform: translateY(-14px) rotate(-3deg) scale(1.08); }
        }
        @keyframes pp-shadow-pulse {
          0%, 100% { transform: scaleX(1);   opacity: 0.35; }
          40%       { transform: scaleX(0.5); opacity: 0.12; }
        }
        @keyframes pp-shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position:  400px 0; }
        }
        @keyframes pp-fade-slide {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes pp-orbit {
          from { transform: rotate(0deg)   translateX(38px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(38px) rotate(-360deg); }
        }
        @keyframes pp-orbit2 {
          from { transform: rotate(180deg) translateX(38px) rotate(-180deg); }
          to   { transform: rotate(540deg) translateX(38px) rotate(-540deg); }
        }
      `}</style>

      <div style={{ position: "relative", width: 100, height: 100 }}>
        <div style={{
          position: "absolute",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: 52,
          animation: "pp-bounce 1.4s cubic-bezier(.36,.07,.19,.97) infinite",
          filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.18))",
          zIndex: 2,
          userSelect: "none",
        }}>💰</div>

        <div style={{
          position: "absolute",
          top: "50%", left: "50%",
          fontSize: 18,
          animation: "pp-orbit 2.2s linear infinite",
          transformOrigin: "0 0",
          userSelect: "none",
        }}>🪙</div>

        <div style={{
          position: "absolute",
          top: "50%", left: "50%",
          fontSize: 14,
          animation: "pp-orbit2 2.2s linear infinite",
          transformOrigin: "0 0",
          userSelect: "none",
        }}>✨</div>

        <div style={{
          position: "absolute",
          bottom: -4, left: "50%",
          transform: "translateX(-50%)",
          width: 38, height: 8,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.18)",
          animation: "pp-shadow-pulse 1.4s cubic-bezier(.36,.07,.19,.97) infinite",
        }} />
      </div>

      <div style={{
        fontSize: 22,
        fontWeight: 700,
        background: "linear-gradient(90deg, #4f46e5, #7c3aed, #2563eb)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        letterSpacing: "-0.3px",
      }}>Price Polish</div>

      <div
        key={msgIndex}
        style={{
          fontSize: 15,
          color: "#6b7280",
          fontWeight: 500,
          animation: "pp-fade-slide 0.4s ease both",
          textAlign: "center",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {LOADER_MESSAGES[msgIndex]}
      </div>

      <div style={{
        width: 240,
        height: 6,
        borderRadius: 99,
        background: "#e5e7eb",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          borderRadius: 99,
          background: "linear-gradient(90deg, #e5e7eb 25%, #a5b4fc 50%, #818cf8 60%, #e5e7eb 80%)",
          backgroundSize: "800px 100%",
          animation: "pp-shimmer 1.6s linear infinite",
        }} />
      </div>

      <div style={{ fontSize: 12, color: "#9ca3af", letterSpacing: "0.4px" }}>
        Fetching your pricing data...
      </div>
    </div>
  );
}
// ───────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { currencyCode = "USD", isBypass } = useOutletContext<{ currencyCode?: string, isBypass?: boolean }>() || {};

  if (isBypass) {
    return <DashboardContent isBypass={true} currencyCode={currencyCode} />;
  }

  return <DashboardWithBridge currencyCode={currencyCode} />;
}

function DashboardWithBridge({ currencyCode }: { currencyCode: string }) {
  const shopify = useAppBridge();
  return <DashboardContent shopify={shopify} currencyCode={currencyCode} />;
}

function DashboardContent({ shopify, isBypass, currencyCode }: { shopify?: any, isBypass?: boolean, currencyCode: string }) {
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  // ruleExists = null → not yet fetched; true/false comes from backend DB check
  const [ruleExists, setRuleExists] = useState<boolean | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<LastUpdateInfo | null>(null);
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);  // UPDATED
  const [showStopModal, setShowStopModal] = useState(false);      // UPDATED
  const [message, setMessage] = useState<{ type: "success" | "critical" | "warning"; text: string; details?: string } | null>(null);
  const [applyCampaignTitle, setApplyCampaignTitle] = useState("");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [campaignHistory, setCampaignHistory] = useState<CampaignHistoryItem[]>([]);
  const [campaignHistoryLoading, setCampaignHistoryLoading] = useState(false);
  const [campaignHistoryExpanded, setCampaignHistoryExpanded] = useState(true);
  const [hideClosedCampaigns, setHideClosedCampaigns] = useState(true);
  const [campaignHistoryStatusFilter, setCampaignHistoryStatusFilter] = useState<CampaignHistoryStatusFilter>("all");
  const [campaignHistorySourceFilter, setCampaignHistorySourceFilter] = useState<CampaignHistorySourceFilter>("all");
  const [campaignHistorySearchQuery, setCampaignHistorySearchQuery] = useState("");
  const [revertPreviewOpen, setRevertPreviewOpen] = useState(false);
  const [revertPreviewLoading, setRevertPreviewLoading] = useState(false);
  const [revertPreviewRetryFailedOnly, setRevertPreviewRetryFailedOnly] = useState(false);
  const [selectedCampaignForRevert, setSelectedCampaignForRevert] = useState<CampaignHistoryItem | null>(null);
  const [revertPreview, setRevertPreview] = useState<CampaignRevertPreviewData | null>(null);
  const [revertPreviewSearchQuery, setRevertPreviewSearchQuery] = useState("");
  const [revertPreviewMovementFilter, setRevertPreviewMovementFilter] =
    useState<RevertPreviewMovementFilter>("all");
  const [revertPreviewPageSize, setRevertPreviewPageSize] = useState(REVERT_PREVIEW_DEFAULT_PAGE_SIZE);
  const [revertPreviewPage, setRevertPreviewPage] = useState(1);
  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false);
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false);
  const [selectedCampaignForDetail, setSelectedCampaignForDetail] = useState<CampaignHistoryItem | null>(null);
  const [campaignDetail, setCampaignDetail] = useState<CampaignRevertPreviewData | null>(null);
  const [campaignDetailPageSize, setCampaignDetailPageSize] = useState(15);
  const [campaignDetailPage, setCampaignDetailPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "increase" | "decrease" | "high_impact">("all");
  const [sortOrder, setSortOrder] = useState<string>("name_asc");
  const [firstVisit, setFirstVisit] = useState(false);
  const [activeMarkup, setActiveMarkup] = useState(0);
  const [roundingStep, setRoundingStep] = useState(1);
  const [charmPricing, setCharmPricing] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics>(DEFAULT_DASHBOARD_METRICS);
  const collectionId = "";
  const [immediateApplyModalOpen, setImmediateApplyModalOpen] = useState(false);
  const [immediateApplyScope, setImmediateApplyScope] = useState<ImmediateApplyScope>("selected");
  const [immediateApplySingleItem, setImmediateApplySingleItem] = useState<PreviewItem | null>(null);
  const [scheduleHistoryModalOpen, setScheduleHistoryModalOpen] = useState(false);

  // Billing placeholders — do not modify
  const handleUpgrade = useCallback(() => {
    if (shopify) shopify.toast.show("Billing implementation coming soon!");
    else console.log("BYPASS: Upgrade triggered");
  }, [shopify]);

  const hasActivePlan = metrics.hasActivePlan;
  const storefrontControl = metrics.storefrontControl ?? DEFAULT_STOREFRONT_CONTROL_METRICS;

  // UPDATED: hasRules driven by backend DB check (ruleExists), NOT previews.length
  const hasRules = ruleExists === true;
  console.log(`[hasRules DEBUG] ruleExists=${ruleExists} → hasRules=${hasRules}, previews.length=${previews.length}`);

  const navigate = useNavigate();
  const appFetch = useAppFetch();
  const currencySymbol = getCurrencySymbol(currencyCode);

  // ADDED: Guard helper — shows toast and blocks execution when no rules exist
  const guardNoRules = useCallback(() => {
    if (!hasRules) {
      if (shopify) shopify.toast.show("Please configure pricing rules first", { isError: true });
      else console.warn("BYPASS: Please configure pricing rules first");
      return true; // blocked
    }
    return false; // allowed
  }, [hasRules, shopify]);

  const handlePreview = useCallback(async () => {
    console.log("DEBUG: Initializing handlePreview fetch...");
    setLoading(true);
    setMessage(null);
    setCurrentPage(1);
    setSelectedItems(new Set());

    try {
      const fetcher = await appFetch;
      console.log("[Campaign History UI] fetch started");

      const [data, metricsData, campaignHistoryData] = await Promise.all([
        fetcher("/api/preview-price"),
        fetcher("/api/metrics").catch(() => DEFAULT_DASHBOARD_METRICS),
        fetcher("/api/campaign-history").catch(() => ({ campaigns: [] })),
      ]);

      console.log("DEBUG: Data received from parallel fetch");

      const fetchedPreviews = data.previews ?? [];
      setPreviews(fetchedPreviews);
      console.log("[Operational Refresh] preview/grid refreshed", { count: fetchedPreviews.length });
      setLastUpdate(data.lastUpdate ?? null);
      // UPDATED: Use backend's ruleExists flag as authoritative source for hasRules
      console.log(`[FETCH DEBUG] data.ruleExists=${data.ruleExists}, previews.length=${fetchedPreviews.length}`);
      setRuleExists(data.ruleExists === true);
      setActiveMarkup(data.markupPercent ?? 0);
      setRoundingStep(data.roundingStep ?? 1);
      setCharmPricing(data.charmPricing ?? true);
      setMetrics(prev => ({
        ...prev,
        ...metricsData,
        hasActivePlan: metricsData.hasActivePlan !== undefined ? metricsData.hasActivePlan : true,
        storefrontControl: {
          ...DEFAULT_STOREFRONT_CONTROL_METRICS,
          ...(metricsData?.storefrontControl ?? {}),
        },
      }));
      const campaigns = Array.isArray(campaignHistoryData?.campaigns) ? campaignHistoryData.campaigns : [];
      setCampaignHistory(campaigns);
      console.log("[Campaign History UI] loaded count:", campaigns.length);
      console.log("[Campaign History UI] operational metrics rendered", { count: campaigns.length });
      console.log("[Operational Refresh] campaign history refreshed", { count: campaigns.length });

      if (fetchedPreviews.length === 0) {
        setFirstVisit(true);
      } else {
        setFirstVisit(false);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("An unknown error occurred.");
      console.error("DEBUG: Preview Error detail:", error);
      if (shopify) shopify.toast.show("Network error. Please try again.", { isError: true });
      else console.warn("BYPASS: Network error. Please try again.");
      setMessage({ type: "critical", text: "Failed to load preview data.", details: error.message });
    } finally {
      console.log("DEBUG: Finalizing handlePreview loading state.");
      setLoading(false);
    }
  }, [shopify]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const params = url.searchParams;

    const shop = params.get("shop");
    const host = params.get("host");
    const hasChargeId = params.has("charge_id");

    if (shop) {
      localStorage.setItem("shop", shop);
      console.log("[SHOP STORED]", shop);
    }

    if (hasChargeId) {
      console.log("[BILLING] Payment completed → cleaning URL safely");
      params.delete("charge_id");
      const newUrl = `${url.pathname}?${params.toString()}`;
      window.location.replace(newUrl);
      return;
    }

    console.log("DEBUG: Dashboard mounted → fetching preview");
    handlePreview();

  }, [handlePreview]);

  const handleApplyBatch = useCallback(async (
    itemsToUpdate: PreviewItem[],
    campaignTitle: string,
  ): Promise<boolean> => {
    if (!hasRules) {
      shopify.toast.show("Configure pricing rules first", { isError: true });
      return false;
    }

    setIsProcessing(true);

    try {
      // handleApplyBatch ONLY stages the items passed to it.
      // Callers determine the item list/scope.
      const scopedItems = itemsToUpdate;

      if (scopedItems.length === 0) {
        shopify.toast.show("No products to apply", { isError: true });
        return false;
      }

      const normalizedCampaignTitle = campaignTitle.trim();
      if (!normalizedCampaignTitle) {
        shopify.toast.show("Campaign title is required before applying pricing.", {
          isError: true,
        });
        return false;
      }

      const itemsWithFinalPrices = scopedItems.map(item => ({
        productId: item.productId,
        variantId: item.variantId,
        oldPrice: item.oldPrice,
        newPrice:
          item.overriddenPrice !== undefined
            ? item.overriddenPrice
            : item.newPrice,
        isManual: item.overriddenPrice !== undefined,
      }));

      console.log("Selected items:", selectedItems);
      console.log("Scoped items:", scopedItems);
      console.log("Sending payload:", itemsWithFinalPrices);
      const campaignId = crypto.randomUUID();
      console.log("[Apply] campaign title submitted:", normalizedCampaignTitle);

      const response = await fetch("/api/staging-price", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          products: itemsWithFinalPrices,
          campaignId,
          campaignTitle: normalizedCampaignTitle,
        })
      });

      const result = await response.json();
      const stagingCampaignId =
        typeof result?.campaignId === "string" && result.campaignId.length > 0
          ? result.campaignId
          : null;
      console.log("[Apply] staging campaignId received:", stagingCampaignId);

      if (!response.ok) {
        throw new Error(result.error || "Failed to apply pricing");
      }

      setActiveCampaignId(stagingCampaignId);

      // ── Auto-push when Live Pricing is Active ────────────────────────────
      if (metrics.isLive) {
        const manualVariantIds = itemsWithFinalPrices
          .filter((p) => p.isManual)
          .map((p) => p.variantId);
        console.log("[Apply] push-storefront called with campaignId:", stagingCampaignId);
        const pushRes = await fetch("/api/push-storefront", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clear: false,
            manualVariantIds,
            ...(stagingCampaignId ? { campaignId: stagingCampaignId } : {}),
          }),
        });

        const pushData = await pushRes.json();

        if (!pushRes.ok) {
          console.log("Prices staged but failed to push live : - push data :", pushData);
          throw new Error(
            pushData.error || "Prices staged but failed to push live"
          );
        }

        shopify.toast.show("Prices updated and live on storefront");
        console.log("Prices updated and live on storefront-Sajeeth");
      } else {
        shopify.toast.show("Pricing applied successfully");
        console.log("Prices updated and live on storefront-Sajeeth");
      }
      // ─────────────────────────────────────────────────────────────────────

      await handlePreview();

      return true;
    } catch (error: any) {
      shopify.toast.show(error.message || "Apply failed", { isError: true });
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [hasRules, shopify, metrics.isLive, handlePreview]);

  const selectedPreviewItems = useMemo(
    () => previews.filter((item) => selectedItems.has(String(item.variantId))),
    [previews, selectedItems]
  );

  const immediateApplyItems = useMemo(
    () =>
      immediateApplyScope === "all"
        ? previews
        : immediateApplyScope === "single"
          ? immediateApplySingleItem
            ? [immediateApplySingleItem]
            : []
          : selectedPreviewItems,
    [immediateApplyScope, previews, selectedPreviewItems, immediateApplySingleItem]
  );

  const immediateApplyScopeLabel =
    immediateApplyScope === "all"
      ? "products"
      : immediateApplyScope === "single"
        ? "product"
        : "selected products";

  const immediateApplyImpactSummary = useMemo<ImmediateApplyImpactSummary>(() => {
    const summary: ImmediateApplyImpactSummary = {
      increaseCount: 0,
      decreaseCount: 0,
      averageChangePercent: 0,
      largestMovementPercent: null,
      largestMovementDirection: null,
      singleItemDirection: null,
    };

    if (immediateApplyItems.length === 0) {
      return summary;
    }

    let totalPercentChange = 0;
    let validPercentCount = 0;

    for (const item of immediateApplyItems) {
      const oldPrice = Number.parseFloat(item.oldPrice);
      const proposedRaw = item.overriddenPrice !== undefined ? item.overriddenPrice : item.newPrice;
      const proposedPrice = Number.parseFloat(proposedRaw);

      if (!Number.isFinite(oldPrice) || !Number.isFinite(proposedPrice) || oldPrice <= 0) {
        continue;
      }

      const deltaPercent = ((proposedPrice - oldPrice) / oldPrice) * 100;
      totalPercentChange += deltaPercent;
      validPercentCount += 1;

      if (deltaPercent > 0) {
        summary.increaseCount += 1;
      } else if (deltaPercent < 0) {
        summary.decreaseCount += 1;
      }

      if (
        summary.largestMovementPercent === null ||
        Math.abs(deltaPercent) > Math.abs(summary.largestMovementPercent)
      ) {
        summary.largestMovementPercent = deltaPercent;
        summary.largestMovementDirection =
          deltaPercent > 0 ? "increase" : deltaPercent < 0 ? "decrease" : null;
      }
    }

    if (validPercentCount > 0) {
      summary.averageChangePercent = totalPercentChange / validPercentCount;
    }

    if (immediateApplyItems.length === 1) {
      summary.singleItemDirection =
        summary.largestMovementDirection === "increase"
          ? "increase"
          : summary.largestMovementDirection === "decrease"
            ? "decrease"
            : "no_change";
    }

    return summary;
  }, [immediateApplyItems]);

  const immediateApplySafeguardNotices = useMemo<OperationalSafeguardNotice[]>(() => {
    if (immediateApplyItems.length <= 1) {
      return [];
    }

    const notices: OperationalSafeguardNotice[] = [];
    const totalVisibleProducts = previews.length;
    const affectsMostVisible =
      totalVisibleProducts > 0 &&
      immediateApplyItems.length >= Math.max(25, Math.ceil(totalVisibleProducts * MOST_VISIBLE_SCOPE_RATIO));
    const largestMovement = Math.abs(immediateApplyImpactSummary.largestMovementPercent ?? 0);
    const isStorefrontWide =
      totalVisibleProducts > 0 && immediateApplyItems.length >= Math.ceil(totalVisibleProducts * 0.95);
    const isAllProductsScope = immediateApplyScope === "all";

    if (isAllProductsScope || immediateApplyItems.length >= LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "immediate-large-operation",
        severity: "informational",
        message: "A large number of products will update.",
      });
    }

    if (affectsMostVisible) {
      notices.push({
        id: "immediate-most-visible",
        severity: "informational",
        message: "This update affects most visible products.",
      });
    }

    if (largestMovement >= SIGNIFICANT_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "immediate-significant-movement",
        severity: "informational",
        message: "Some products have larger price changes.",
      });
    }

    if (immediateApplyItems.length >= VERY_LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "immediate-very-large-operation",
        severity: "warning",
        message: "A very large number of products will update.",
      });
    }

    if (isStorefrontWide) {
      notices.push({
        id: "immediate-storefront-wide",
        severity: "warning",
        message: "Most visible storefront products will update.",
      });
    }

    if (isAllProductsScope && largestMovement >= MAJOR_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "immediate-all-products-major-movement",
        severity: "warning",
        message: "This all-products update includes larger price changes.",
      });
    }

    return notices;
  }, [immediateApplyItems.length, immediateApplyImpactSummary.largestMovementPercent, immediateApplyScope, previews.length]);

  const openImmediateApplyModal = useCallback((scope: ImmediateApplyScope, item?: PreviewItem) => {
    setImmediateApplyScope(scope);
    if (scope === "single" && item) {
      setImmediateApplySingleItem(item);
    } else {
      setImmediateApplySingleItem(null);
    }
    setImmediateApplyModalOpen(true);
  }, []);

  const closeImmediateApplyModal = useCallback(() => {
    setImmediateApplyModalOpen(false);
    setImmediateApplySingleItem(null);
  }, []);

  const handleApplySingle = useCallback((item: PreviewItem) => {
    openImmediateApplyModal("single", item);
  }, [openImmediateApplyModal]);

  const resetRevertPreviewViewState = useCallback(() => {
    setRevertPreviewSearchQuery("");
    setRevertPreviewMovementFilter("all");
    setRevertPreviewPageSize(REVERT_PREVIEW_DEFAULT_PAGE_SIZE);
    setRevertPreviewPage(1);
  }, []);

  const campaignDetailRows = campaignDetail?.rows ?? [];
  const campaignDetailTotalPages = Math.max(1, Math.ceil(campaignDetailRows.length / campaignDetailPageSize));
  const campaignDetailPaginatedRows = useMemo(() => {
    const start = (campaignDetailPage - 1) * campaignDetailPageSize;
    return campaignDetailRows.slice(start, start + campaignDetailPageSize);
  }, [campaignDetailPage, campaignDetailPageSize, campaignDetailRows]);

  useEffect(() => {
    setCampaignDetailPage(1);
  }, [campaignDetail, campaignDetailPageSize]);

  useEffect(() => {
    if (campaignDetailPage > campaignDetailTotalPages) {
      setCampaignDetailPage(campaignDetailTotalPages);
    }
  }, [campaignDetailPage, campaignDetailTotalPages]);

  const revertSafeguardNotices = useMemo<OperationalSafeguardNotice[]>(() => {
    if (!revertPreview || revertPreview.terminal) return [];

    const notices: OperationalSafeguardNotice[] = [];
    const productCount = Number.isFinite(revertPreview.productCount) ? revertPreview.productCount : 0;
    const totalVisibleProducts = previews.length;
    const affectsMostVisible =
      totalVisibleProducts > 0 &&
      productCount >= Math.max(25, Math.ceil(totalVisibleProducts * MOST_VISIBLE_SCOPE_RATIO));
    const storefrontWide = totalVisibleProducts > 0 && productCount >= Math.ceil(totalVisibleProducts * 0.95);
    let largestMovement = 0;

    for (const row of revertPreview.rows) {
      if (row.currentPrice == null || row.currentPrice <= 0) continue;
      const deltaPercent = ((row.revertTargetPrice - row.currentPrice) / row.currentPrice) * 100;
      if (Number.isFinite(deltaPercent)) {
        largestMovement = Math.max(largestMovement, Math.abs(deltaPercent));
      }
    }

    if (productCount >= LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "revert-large-scope",
        severity: "informational",
        message: "Large revert operation detected.",
      });
    }

    if (affectsMostVisible) {
      notices.push({
        id: "revert-most-visible",
        severity: "informational",
        message: "This revert restores pricing across most visible products.",
      });
    }

    if (largestMovement >= SIGNIFICANT_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "revert-significant-movement",
        severity: "informational",
        message: "Some products contain significant pricing movement.",
      });
    }

    if (productCount >= VERY_LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "revert-very-large-scope",
        severity: "warning",
        message: "This revert restores pricing across a large campaign set.",
      });
    }

    if (storefrontWide && largestMovement >= MAJOR_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "revert-storefront-major-movement",
        severity: "warning",
        message: "Storefront-wide revert scope includes major pricing movement.",
      });
    }

    return notices;
  }, [previews.length, revertPreview]);

  const revertPreviewFilteredRows = useMemo(() => {
    if (!revertPreview) return [] as CampaignRevertPreviewRow[];

    const normalizedQuery = revertPreviewSearchQuery.trim().toLowerCase();

    return revertPreview.rows.filter((row) => {
      if (normalizedQuery && !row.productTitle.toLowerCase().includes(normalizedQuery)) {
        return false;
      }

      if (revertPreviewMovementFilter === "all") {
        return true;
      }

      if (row.currentPrice == null || row.currentPrice <= 0) {
        return revertPreviewMovementFilter === "large_movement" ? false : true;
      }

      const delta = row.revertTargetPrice - row.currentPrice;
      const deltaPercent = (delta / row.currentPrice) * 100;

      if (revertPreviewMovementFilter === "increase") {
        return delta > 0;
      }
      if (revertPreviewMovementFilter === "decrease") {
        return delta < 0;
      }
      if (revertPreviewMovementFilter === "large_movement") {
        return Math.abs(deltaPercent) >= REVERT_PREVIEW_LARGE_MOVEMENT_THRESHOLD;
      }
      return true;
    });
  }, [revertPreview, revertPreviewMovementFilter, revertPreviewSearchQuery]);

  const revertPreviewTotalPages = Math.max(
    1,
    Math.ceil(revertPreviewFilteredRows.length / revertPreviewPageSize)
  );
  const revertPreviewPaginatedRows = useMemo(() => {
    const start = (revertPreviewPage - 1) * revertPreviewPageSize;
    return revertPreviewFilteredRows.slice(start, start + revertPreviewPageSize);
  }, [revertPreviewFilteredRows, revertPreviewPage, revertPreviewPageSize]);

  useEffect(() => {
    setRevertPreviewPage(1);
  }, [revertPreviewSearchQuery, revertPreviewMovementFilter, revertPreviewPageSize]);

  useEffect(() => {
    if (revertPreviewPage > revertPreviewTotalPages) {
      setRevertPreviewPage(revertPreviewTotalPages);
    }
  }, [revertPreviewPage, revertPreviewTotalPages]);

  const filteredPreviews = useMemo(() => {
    console.log(`DEBUG: compute filteredPreviews. Source length: ${previews.length}`);
    let result = previews.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase());
      const currentNewPrice = p.overriddenPrice !== undefined ? parseFloat(p.overriddenPrice) || 0 : parseFloat(p.newPrice);
      const price = currentNewPrice;
      const matchesMin = minPrice === "" || price >= parseFloat(minPrice);
      const matchesMax = maxPrice === "" || price <= parseFloat(maxPrice);

      const oldP = parseFloat(p.oldPrice);
      const newP = currentNewPrice;
      const diffPercent = oldP !== 0 ? ((newP - oldP) / oldP) * 100 : 0;

      let matchesSmartFilter = true;
      if (activeFilter === "increase") matchesSmartFilter = newP > oldP;
      else if (activeFilter === "decrease") matchesSmartFilter = newP < oldP;
      else if (activeFilter === "high_impact") matchesSmartFilter = Math.abs(diffPercent) >= 10;

      return matchesSearch && matchesMin && matchesMax && matchesSmartFilter;
    });

    result.sort((a, b) => {
      const oldA = parseFloat(a.oldPrice);
      const newA = a.overriddenPrice !== undefined ? parseFloat(a.overriddenPrice) || 0 : parseFloat(a.newPrice);
      const diffA = oldA !== 0 ? ((newA - oldA) / oldA) * 100 : 0;

      const oldB = parseFloat(b.oldPrice);
      const newB = b.overriddenPrice !== undefined ? parseFloat(b.overriddenPrice) || 0 : parseFloat(b.newPrice);
      const diffB = oldB !== 0 ? ((newB - oldB) / oldB) * 100 : 0;

      switch (sortOrder) {
        case "name_asc": return a.title.localeCompare(b.title);
        case "name_desc": return b.title.localeCompare(a.title);
        case "price_asc": return newA - newB;
        case "price_desc": return newB - newA;
        case "change_asc": return diffA - diffB;
        case "change_desc": return diffB - diffA;
        default: return 0;
      }
    });

    return result;
  }, [previews, searchQuery, minPrice, maxPrice, activeFilter, sortOrder]);

  const handleUndo = useCallback(async () => {
    if (!lastUpdate?.batchId) return;
    console.log(`DEBUG: Initializing handleUndo for batch: ${lastUpdate.batchId}...`);
    setIsProcessing(true);
    setMessage(null);

    try {
      const res = await fetch("/api/undo-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: lastUpdate.batchId }),
      });

      console.log(`DEBUG: /api/undo-price status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/undo-price data received:", !!data);

      if (res.ok) {
        if (shopify) shopify.toast.show(`Restored ${data.restoredCount} products`);
        else console.log(`BYPASS: Restored ${data.restoredCount} products`);
        await handlePreview();
        setSelectedItems(new Set());
      } else {
        throw new Error(data.error || "Failed to undo changes.");
      }
    } catch (err) {
      console.error("DEBUG: Undo Error detail:", err);
      if (shopify) shopify.toast.show("Failed to undo changes", { isError: true });
      else console.error("BYPASS: Failed to undo changes");
    } finally {
      console.log("DEBUG: Finalizing handleUndo processing state.");
      setIsProcessing(false);
    }
  }, [lastUpdate, shopify, handlePreview]);

  const openCampaignDetailView = useCallback(async (campaign: CampaignHistoryItem) => {
    console.log("[Campaign History UI] campaign detail view opened", {
      campaignId: campaign.campaignId,
      title: campaign.title,
    });
    setCampaignDetailPageSize(15);
    setCampaignDetailPage(1);
    setSelectedCampaignForDetail(campaign);
    setCampaignDetailOpen(true);
    setCampaignDetailLoading(true);
    setCampaignDetail(null);
    try {
      const res = await fetch("/api/campaign-revert-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.campaignId,
          ...(campaign.latestBatchId ? { batchId: campaign.latestBatchId } : {}),
          includeAllStatuses: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load campaign details.");
      }
      setCampaignDetail(data);
      console.log("[Campaign History UI] informational campaign detail loaded", {
        campaignId: campaign.campaignId,
        count: Array.isArray(data?.rows) ? data.rows.length : 0,
      });
    } catch (err) {
      console.error("DEBUG: Campaign detail view error:", err);
      if (shopify) shopify.toast.show("Failed to load campaign details", { isError: true });
      else console.error("BYPASS: Failed to load campaign details");
      setCampaignDetailOpen(false);
      setSelectedCampaignForDetail(null);
      setCampaignDetailPageSize(15);
      setCampaignDetailPage(1);
    } finally {
      setCampaignDetailLoading(false);
    }
  }, [shopify]);

  const openCampaignRevertPreview = useCallback(async (campaign: CampaignHistoryItem, retryFailedOnly = false) => {
    if (!campaign.revertable) return;
    console.log("[Campaign Revert] preview opened", { campaignId: campaign.campaignId, title: campaign.title });
    resetRevertPreviewViewState();
    setSelectedCampaignForRevert(campaign);
    setRevertPreviewRetryFailedOnly(retryFailedOnly);
    setRevertPreviewOpen(true);
    setRevertPreviewLoading(true);
    setRevertPreview(null);
    try {
      const res = await fetch("/api/campaign-revert-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign.campaignId,
          ...(campaign.latestBatchId ? { batchId: campaign.latestBatchId } : {}),
          ...(retryFailedOnly ? { retryFailedOnly: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load revert preview.");
      }
      setRevertPreview(data);
      if (data?.terminal === true) {
        console.log("[Campaign Revert] unrecoverable informational modal shown", {
          campaignId: campaign.campaignId,
          message: data?.message ?? null,
        });
      }
    } catch (err) {
      console.error("DEBUG: Campaign Revert Preview Error detail:", err);
      if (shopify) shopify.toast.show("Failed to load revert preview", { isError: true });
      else console.error("BYPASS: Failed to load revert preview");
      setRevertPreviewOpen(false);
      setSelectedCampaignForRevert(null);
      resetRevertPreviewViewState();
    } finally {
      setRevertPreviewLoading(false);
    }
  }, [resetRevertPreviewViewState, shopify]);

  const confirmCampaignRevert = useCallback(async () => {
    if (!selectedCampaignForRevert) return;
    console.log("[Campaign Revert] confirmed", {
      campaignId: selectedCampaignForRevert.campaignId,
      title: selectedCampaignForRevert.title,
    });
    setIsProcessing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/undo-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaignForRevert.campaignId,
          ...(selectedCampaignForRevert.latestBatchId ? { batchId: selectedCampaignForRevert.latestBatchId } : {}),
          ...(revertPreviewRetryFailedOnly ? { retryFailedOnly: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to revert campaign.");
      }
      const terminalReason = selectedCampaignForRevert?.unrecoverableReason;
      if (data?.terminal === true) {
        const terminalMessage = terminalReason
          ? `This campaign can no longer be reverted because ${terminalReason.toLowerCase()}.`
          : (data?.message || "This campaign can no longer be reverted.");
        if (shopify) shopify.toast.show(terminalMessage, { isError: true });
        else console.warn(`BYPASS: ${terminalMessage}`);
      } else if (data?.message) {
        const operationalMessage = terminalReason
          ? `${data.message} Reason: ${terminalReason}.`
          : data.message;
        if (shopify) shopify.toast.show(operationalMessage);
        else console.log(`BYPASS: ${operationalMessage}`);
      } else if (data?.restoredCount > 0) {
        if (shopify) shopify.toast.show(`Restored ${data.restoredCount} products`);
        else console.log(`BYPASS: Restored ${data.restoredCount} products`);
      } else {
        const noRetryMessage = terminalReason
          ? `No retryable revert actions remain because ${terminalReason.toLowerCase()}.`
          : "No retryable revert actions remain.";
        if (shopify) shopify.toast.show(noRetryMessage, { isError: true });
        else console.warn(`BYPASS: ${noRetryMessage}`);
      }
      setRevertPreviewOpen(false);
      setSelectedCampaignForRevert(null);
      setRevertPreview(null);
      setRevertPreviewRetryFailedOnly(false);
      resetRevertPreviewViewState();
      await handlePreview();
    } catch (err) {
      console.error("DEBUG: Campaign Revert Error detail:", err);
      if (shopify) shopify.toast.show("Failed to revert campaign", { isError: true });
      else console.error("BYPASS: Failed to revert campaign");
    } finally {
      setIsProcessing(false);
    }
  }, [handlePreview, resetRevertPreviewViewState, revertPreviewRetryFailedOnly, selectedCampaignForRevert, shopify]);

  const handleRefreshCampaignHistory = useCallback(async () => {
    setCampaignHistoryLoading(true);
    console.log("[Campaign History UI] manual refresh started");
    try {
      const fetcher = await appFetch;
      const campaignHistoryData = await fetcher("/api/campaign-history");
      const campaigns = Array.isArray(campaignHistoryData?.campaigns) ? campaignHistoryData.campaigns : [];
      setCampaignHistory(campaigns);
      console.log("[Campaign History UI] manual refresh completed", { count: campaigns.length });
      console.log("[Campaign History UI] operational metrics rendered", { count: campaigns.length });
    } catch (error) {
      console.error("DEBUG: Campaign History manual refresh failed:", error);
      if (shopify) shopify.toast.show("Failed to refresh campaign history", { isError: true });
      else console.error("BYPASS: Failed to refresh campaign history");
    } finally {
      setCampaignHistoryLoading(false);
    }
  }, [appFetch, shopify]);

  const handlePriceChange = useCallback((variantId: string, value: string) => {
    if (value.length > 15) return;
    if (value !== "" && !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;

    setPreviews((prev) =>
      prev.map((item) =>
        item.variantId === variantId
          ? { ...item, overriddenPrice: value }
          : item
      )
    );
  }, []);

  const handleDownloadReport = useCallback(() => {
    if (previews.length === 0) return;

    let csv = "Product Title,Variant ID,Original Price,Markup Added,Rounding Adjustment,Final Optimized,Net Profit Gain\n";
    let totalProfit = 0;

    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.includes(currencyCode);
    const dec = isZeroDecimal ? 0 : 2;

    previews.forEach(p => {
      const base = parseFloat(p.originalBasePrice);
      const final = parseFloat(p.overriddenPrice !== undefined ? p.overriddenPrice : p.newPrice);
      const markupAdded = base * (activeMarkup / 100);
      const roundingAdj = final - (base + markupAdded);
      const netGain = final - base;
      totalProfit += netGain;
      const titleSafe = p.title.replace(/"/g, '""');
      csv += `"${titleSafe}","${p.variantId}",${base.toFixed(dec)},${markupAdded.toFixed(dec)},${roundingAdj.toFixed(dec)},${final.toFixed(dec)},${netGain.toFixed(dec)}\n`;
    });

    csv += `,,,,,,,\n`;
    csv += `TOTAL STOREFRONT VALUE INCREASE,,,,,,${totalProfit.toFixed(dec)}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().split('T')[0];

    link.href = url;
    link.setAttribute("download", `PricePolish_Impact_Report_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [previews, activeMarkup]);

  const resetOverride = useCallback((variantId: string) => {
    setPreviews((prev) =>
      prev.map((item) =>
        item.variantId === variantId
          ? { ...item, overriddenPrice: undefined }
          : item
      )
    );
  }, []);

  // UPDATED: Wrapped with guardNoRules — does NOT change existing handler logic
  const handleGoLiveClick = useCallback(() => {
    if (guardNoRules()) return;
    setShowGoLiveModal(true);
  }, [guardNoRules]);

  // UPDATED: Wrapped with guardNoRules — does NOT change existing handler logic
  const handleStopLiveClick = useCallback(() => {
    if (guardNoRules()) return;
    setShowStopModal(true);
  }, [guardNoRules]);

  const handlePushStorefront = useCallback(async (clear = false) => {
    console.log(`DEBUG: Initializing handlePushStorefront (clear=${clear})...`);
    setIsProcessing(true);
    setShowGoLiveModal(false);
    setShowStopModal(false);

    try {
      const pushBody = {
        clear,
        ...(!clear && activeCampaignId ? { campaignId: activeCampaignId } : {}),
      };
      if (!clear) {
        console.log("[Apply] push-storefront called with campaignId:", activeCampaignId);
      }
      const res = await fetch("/api/push-storefront", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pushBody)
      });

      console.log(`DEBUG: /api/push-storefront status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/push-storefront data received:", !!data);

      if (res.ok) {
        if (shopify) shopify.toast.show(clear ? "Storefront prices restored successfully" : "Prices are now live on your storefront");
        else console.log(`BYPASS: ${clear ? "Storefront prices restored successfully" : "Prices are now live on your storefront"}`);
        setMetrics(prev => ({ ...prev, isLive: !clear }));
        await handlePreview();
      } else {
        throw new Error(data.error || "Failed to push rules.");
      }
    } catch (err) {
      console.error("DEBUG: PushStorefront Error detail:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to update storefront pricing state.";
      if (shopify) shopify.toast.show(errorMessage, { isError: true });
      else console.error("BYPASS:", errorMessage);
    } finally {
      console.log("DEBUG: Finalizing handlePushStorefront processing state.");
      setIsProcessing(false);
    }
  }, [shopify, activeCampaignId, handlePreview]);

  const campaignStatusTone = useCallback((status: string) => {
    const normalized = status.toLowerCase();
    if (normalized === "unrecoverable") return "critical" as const;
    if (normalized === "active" || normalized === "done") return "success" as const;
    if (normalized === "reverted") return "info" as const;
    if (normalized === "scheduled" || normalized === "pending") return "warning" as const;
    return "attention" as const;
  }, []);

  const detailStatusTone = useCallback((status?: string | null) => {
    const normalized = (status ?? "pending").toLowerCase();
    if (normalized === "reverted") return "success" as const;
    if (normalized === "failed") return "warning" as const;
    if (normalized === "unrecoverable") return "critical" as const;
    return "attention" as const;
  }, []);

  const detailStatusLabel = useCallback((status?: string | null) => {
    const normalized = (status ?? "pending").toLowerCase();
    if (normalized === "reverted") return "Reverted";
    if (normalized === "failed") return "Failed";
    if (normalized === "unrecoverable") return "Unrecoverable";
    return "Pending";
  }, []);

  const formatTimelineTimestamp = useCallback((value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
  }, []);

  const campaignOperationalTimeline = useMemo<CampaignTimelineMilestone[]>(() => {
    if (!selectedCampaignForDetail) return [];

    const normalizedStatus = normalizeCampaignStatus(selectedCampaignForDetail.status);
    const failedCount = campaignDetail?.failedCount ?? selectedCampaignForDetail.failedCount ?? 0;
    const revertCompletedTimestamp =
      normalizedStatus === "reverted"
        ? formatTimelineTimestamp(campaignDetail?.revertCompletedAt ?? null)
        : null;

    const milestones: CampaignTimelineMilestone[] = [
      {
        key: "created",
        label: "Created",
        tone: "info",
        badgeLabel: "Recorded",
        timestamp: formatTimelineTimestamp(selectedCampaignForDetail.createdAt),
        description: "Campaign record created and ready for lifecycle actions.",
      },
    ];

    if (normalizedStatus === "scheduled" || normalizedStatus === "pending") {
      milestones.push({
        key: "scheduled",
        label: "Scheduled",
        tone: "warning",
        badgeLabel: "Queued",
        description: "Campaign is queued for execution.",
      });
    }

    if (["active", "partial", "reverted", "unrecoverable"].includes(normalizedStatus)) {
      milestones.push({
        key: "applied",
        label: "Applied",
        tone: "success",
        badgeLabel: "Completed",
        description: "Pricing updates were applied to tracked items.",
      });
    }

    if (normalizedStatus === "partial" || failedCount > 0) {
      milestones.push({
        key: "partial-failure",
        label: "Partial Failure",
        tone: "warning",
        badgeLabel: "Attention",
        description: "Some items failed to complete rollback operations.",
      });
    }

    if (normalizedStatus === "reverted") {
      milestones.push({
        key: "reverted",
        label: "Reverted",
        tone: "success",
        badgeLabel: "Completed",
        timestamp: revertCompletedTimestamp,
        description: "Pricing successfully restored to original storefront values.",
      });
    }

    if (normalizedStatus === "unrecoverable") {
      milestones.push({
        key: "unrecoverable",
        label: "Unrecoverable",
        tone: "critical",
        badgeLabel: "Terminal",
        description:
          selectedCampaignForDetail.unrecoverableReason ??
          "Rollback is terminal for one or more items and cannot be retried.",
      });
    }

    return milestones;
  }, [campaignDetail, formatTimelineTimestamp, selectedCampaignForDetail]);

  const compactVariantIdentifier = useCallback((variantId: string) => {
    const normalized = variantId.trim();
    if (normalized.length === 0) return "Variant: -";
    if (normalized.startsWith("gid://")) {
      return `gid://...${normalized.slice(-6)}`;
    }
    if (normalized.length > 16) {
      return `Variant: ...${normalized.slice(-8)}`;
    }
    return `Variant: ${normalized}`;
  }, []);

  const campaignHistoryCounts = useMemo(() => {
    return campaignHistory.reduce(
      (acc, campaign) => {
        const status = normalizeCampaignStatus(campaign.status);
        if (status === "active") {
          acc.active += 1;
        } else if (status === "partial") {
          acc.partial += 1;
        } else if (status === "scheduled" || status === "pending") {
          acc.scheduled += 1;
        } else if (isClosedCampaignStatus(status)) {
          acc.closed += 1;
        }
        return acc;
      },
      { active: 0, partial: 0, scheduled: 0, closed: 0 }
    );
  }, [campaignHistory]);

  const handleCampaignHistoryStatusFilterChange = useCallback((value: string) => {
    const nextValue = value as CampaignHistoryStatusFilter;
    setCampaignHistoryStatusFilter(nextValue);
    console.log("[Campaign History UI] campaign history filter changed", {
      statusFilter: nextValue,
    });
  }, []);

  const handleCampaignHistorySourceFilterChange = useCallback((value: string) => {
    const nextValue = value as CampaignHistorySourceFilter;
    setCampaignHistorySourceFilter(nextValue);
    console.log("[Campaign History UI] campaign history filter changed", {
      sourceFilter: nextValue,
    });
  }, []);

  const handleCampaignHistorySearchChange = useCallback((value: string) => {
    if (value.length > 120) return;
    setCampaignHistorySearchQuery(value);
    console.log("[Campaign History UI] campaign history search applied", {
      query: value.trim(),
    });
  }, []);

  const filteredCampaignHistory = useMemo(() => {
    const normalizedQuery = campaignHistorySearchQuery.trim().toLowerCase();

    return campaignHistory.filter((campaign) => {
      const status = normalizeCampaignStatus(campaign.status);
      const source = normalizeCampaignSource(campaign.source);
      const title = campaign.title.toLowerCase();
      const campaignId = campaign.campaignId.toLowerCase();

      const matchesStatus = (() => {
        if (campaignHistoryStatusFilter === "all") return true;
        if (campaignHistoryStatusFilter === "active") return status === "active";
        if (campaignHistoryStatusFilter === "partial") return status === "partial";
        if (campaignHistoryStatusFilter === "scheduled") return status === "scheduled" || status === "pending";
        return isClosedCampaignStatus(status);
      })();

      const matchesSource =
        campaignHistorySourceFilter === "all" || source === campaignHistorySourceFilter;

      const matchesSearch =
        normalizedQuery.length === 0 ||
        title.includes(normalizedQuery) ||
        campaignId.includes(normalizedQuery);

      return matchesStatus && matchesSource && matchesSearch;
    });
  }, [campaignHistory, campaignHistoryStatusFilter, campaignHistorySourceFilter, campaignHistorySearchQuery]);

  const visibleCampaignHistory = useMemo(() => {
    if (!hideClosedCampaigns) return filteredCampaignHistory;
    const visible = filteredCampaignHistory.filter((campaign) => !isClosedCampaignStatus(campaign.status));
    console.log("[Campaign History UI] closed campaigns hidden", {
      hiddenCount: filteredCampaignHistory.length - visible.length,
      total: filteredCampaignHistory.length,
    });
    return visible;
  }, [filteredCampaignHistory, hideClosedCampaigns]);

  const campaignHistorySummary = useMemo(() => {
    return visibleCampaignHistory.reduce(
      (acc, campaign) => {
        const status = normalizeCampaignStatus(campaign.status);
        if (status === "active") {
          acc.active += 1;
        } else if (status === "partial") {
          acc.partial += 1;
        } else if (isClosedCampaignStatus(status)) {
          acc.closed += 1;
        }
        return acc;
      },
      { active: 0, partial: 0, closed: 0 }
    );
  }, [visibleCampaignHistory]);

  const campaignHistoryStatusOptions = useMemo(
    () => [
      { label: "All", value: "all" },
      { label: `Active (${campaignHistoryCounts.active})`, value: "active" },
      { label: `Partial (${campaignHistoryCounts.partial})`, value: "partial" },
      { label: "Scheduled", value: "scheduled" },
      { label: "Closed", value: "closed" },
    ],
    [campaignHistoryCounts.active, campaignHistoryCounts.partial]
  );

  const campaignHistorySourceOptions = useMemo(
    () => [
      { label: "All Sources", value: "all" },
      { label: "Manual", value: "manual" },
      { label: "Scheduled", value: "scheduled" },
    ],
    []
  );

  const campaignHistoryEmptyStateMessage = useMemo(() => {
    if (campaignHistory.length === 0) return "No campaigns recorded yet.";

    if (filteredCampaignHistory.length === 0) {
      if (campaignHistoryStatusFilter === "active") return "No active campaigns found.";
      if (campaignHistoryStatusFilter === "partial") return "No partial campaigns found.";
      if (campaignHistoryStatusFilter === "scheduled") return "No scheduled campaigns found.";
      if (campaignHistoryStatusFilter === "closed") return "No closed campaigns found.";
      return "No campaigns match the current filters.";
    }

    if (hideClosedCampaigns && visibleCampaignHistory.length === 0) {
      return "All matching campaigns are closed. Turn off Hide Closed Campaigns to view them.";
    }

    return "No campaigns match the current filters.";
  }, [
    campaignHistory.length,
    filteredCampaignHistory.length,
    campaignHistoryStatusFilter,
    hideClosedCampaigns,
    visibleCampaignHistory.length,
  ]);

  const toggleCampaignHistoryExpanded = useCallback(() => {
    setCampaignHistoryExpanded((prev) => {
      const next = !prev;
      console.log(next ? "campaign history expanded" : "campaign history collapsed");
      return next;
    });
  }, []);

  const toggleSelection = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    const visibleIds = paginatedPreviews.map(p => p.variantId);
    setSelectedItems(prev => {
      const next = new Set(prev);
      visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  const insights = useMemo(() => {
    let totalOld = 0;
    let totalNew = 0;
    let count = 0;

    previews.forEach(p => {
      const oldP = parseFloat(p.oldPrice);
      const newP = p.overriddenPrice !== undefined ? parseFloat(p.overriddenPrice) || 0 : parseFloat(p.newPrice);
      if (oldP !== newP) {
        totalOld += oldP;
        totalNew += newP;
        count++;
      }
    });

    const lift = totalNew - totalOld;
    const liftPercent = totalOld !== 0 ? (lift / totalOld) * 100 : 0;
    return { lift, liftPercent, count };
  }, [previews]);

  console.log(`DEBUG: Render Cycle - previews.length: ${previews.length}, loading: ${loading}`);



  const handleMinPriceChange = useCallback((value: string) => {
    if (value.length > 15) return;
    if (value !== "" && !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;
    setMinPrice(value);
  }, []);

  const handleMaxPriceChange = useCallback((value: string) => {
    if (value.length > 15) return;
    if (value !== "" && !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;
    setMaxPrice(value);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    if (value.length > 100) return;
    setSearchQuery(value);
  }, []);

  const totalPages = Math.ceil(filteredPreviews.length / PAGE_SIZE);
  const paginatedPreviews = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPreviews.slice(start, start + PAGE_SIZE);
  }, [filteredPreviews, currentPage]);

  const totalBatches = useMemo(() => Math.ceil(previews.length / BATCH_SIZE), [previews]);

  const timeAgo = (dateStr: string) => {
    const diff = new Date().getTime() - new Date(dateStr).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    const remainingMinutes = minutes % 60;
    const pad = (num: number) => num.toString().padStart(2, '0');
    return `${days}d ${pad(remainingHours)}:${pad(remainingMinutes)} ago`;
  };

  const SHOW_DEBUG_TOOLS = false;

  // UPDATED: Loading guard — prevents flicker of "No Pricing Rules Found" before data arrives
  // ruleExists === null means first fetch hasn't completed yet
  if (loading && ruleExists === null) {
    return <DashboardLoader />;
  }

  return (
    <div style={{ backgroundColor: "#f9fafb", minHeight: "100vh" }}>
      {/* ADDED: Global styles including pulse animation for live indicator */}
      <style>{`
        :root {
          --pp-primary: #008060;
          --pp-success: #16a34a;
          --pp-danger: #dc2626;
          --pp-warning: #f59e0b;
          --pp-text: #111827;
          --pp-bg: #f9fafb;
          --pp-card: #ffffff;
          --pp-border: #e5e7eb;
        }
        
        .Polaris-Page { background-color: var(--pp-bg); }
        .Polaris-Card { border: 1px solid var(--pp-border) !important; background-color: var(--pp-card) !important; color: var(--pp-text) !important; }
        .Polaris-Text--headingLg { color: var(--pp-text); font-weight: 700; }
        
        .Polaris-Button--toneSuccess.Polaris-Button--variantPrimary { background: var(--pp-success) !important; }
        .Polaris-Button--toneCritical.Polaris-Button--variantPrimary { background: var(--pp-danger) !important; }

        /* ADDED: Live status pulse animation */
        @keyframes pp-live-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%       { transform: scale(1.5); opacity: 0.5; }
        }

        .pp-live-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .pp-live-dot--active {
          background-color: #16a34a;
          animation: pp-live-pulse 1.6s ease-in-out infinite;
        }

        .pp-live-dot--inactive {
          background-color: #dc2626;
        }
      `}</style>

      <Page title="Price Polish Dashboard" fullWidth>
        <div style={{ maxWidth: "1200px", margin: "0 auto", width: "100%" }}>
          <BlockStack gap="400">

            {/* Debug Tools */}
            {SHOW_DEBUG_TOOLS && (
              <>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">System Health & Diagnostics</Text>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack gap="300" align="space-between">
                        <Text as="span" variant="bodyMd">Is Embedded in Iframe:</Text>
                        <Badge tone={typeof window !== "undefined" && window.top !== window.self ? "success" : "critical"}>
                          {typeof window !== "undefined" && window.top !== window.self ? "YES (Safe)" : "NO (Warning: App Domain Context)"}
                        </Badge>
                      </InlineStack>
                      <InlineStack gap="300" align="space-between">
                        <Text as="span" variant="bodyMd">App Bridge Handshake:</Text>
                        <Badge tone={currencyCode ? "success" : "attention"}>
                          {currencyCode ? "Connected" : "Initializing..."}
                        </Badge>
                      </InlineStack>
                      <InlineStack gap="300" align="space-between">
                        <Text as="span" variant="bodyMd">Detected Shop Context:</Text>
                        <Text as="span" variant="bodyMd">
                          {typeof window !== "undefined" ? window.location.search.split("shop=")[1]?.split("&")[0] || "Unknown" : "Server"}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                    <Banner tone="info">
                      <p>If <strong>Is Embedded</strong> is NO, the app is running on its own domain instead of <code>admin.shopify.com</code>. This will cause App Bridge origin mismatches.</p>
                    </Banner>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">System Status (Debug)</Text>
                    <InlineStack gap="300">
                      <Text as="p">Previews: <strong>{previews.length}</strong></Text>
                      <Text as="p">Filtered: <strong>{filteredPreviews.length}</strong></Text>
                      <Text as="p">Loading: <strong>{loading ? "YES" : "NO"}</strong></Text>
                      <Text as="p">Currency: <strong>{currencyCode}</strong></Text>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </>
            )}

            {/* First Visit Welcome */}
            {firstVisit && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Welcome to Price Polish</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Follow these steps to optimize store pricing:</Text>
                  <Box paddingInlineStart="400">
                    <BlockStack gap="150">
                      <Text as="p" variant="bodySm"><strong>1. Configure:</strong> Set markup and rounding on the <Button variant="tertiary" onClick={() => navigate("/app/rules")}>Rules</Button> page.</Text>
                      <Text as="p" variant="bodySm"><strong>2. Preview:</strong> Return here to review calculated prices.</Text>
                      <Text as="p" variant="bodySm"><strong>3. Apply:</strong> Push changes when ready; you can undo recent bulk updates.</Text>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>
            )}

            {/* Billing Upsell */}
            {!hasActivePlan && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">Start Your 7-Day Free Trial</Text>
                  <Text as="p">Apply smart pricing, increase profits, and manage bulk updates safely.</Text>
                  <InlineStack gap="200">
                    <Badge tone="success">Bulk Pricing</Badge>
                    <Badge tone="success">Undo Anytime</Badge>
                    <Badge tone="success">Live Store Sync</Badge>
                  </InlineStack>
                  {/* UPDATED: variant="primary" — Task 5 hierarchy */}
                  <Button variant="primary" tone="success" onClick={handleUpgrade}>Start Free Trial</Button>
                  <Text as="p" variant="bodySm" tone="subdued">No charge today • Cancel anytime</Text>
                </BlockStack>
              </Card>
            )}

            {/* Safety Info Banner */}
            <Banner tone="info">
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd">
                  Safe to use — all pricing changes can be reviewed and undone anytime.
                </Text>

                <Text as="p" variant="bodyMd">
                  Your original storefront prices are preserved securely for rollback and recovery.
                </Text>

                <Text as="p" variant="bodySm" tone="subdued">
                  Scheduled pricing updates run automatically at the selected time without requiring manual action.
                </Text>
              </BlockStack>
            </Banner>

            {/* Live Mode Warning */}
            {metrics.isLive && (
              <Banner tone="warning">
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd">
                    <strong>Live Pricing is on.</strong> Applied prices update your Shopify catalog. With live rules active, the storefront may layer rules on top of those prices. Stop Live Pricing or adjust rules if you need the applied amount to be final.
                  </Text>
                </BlockStack>
              </Banner>
            )}

            {/* Error / Success Message */}
            {message && (
              <Banner
                title={message.text}
                tone={message.type}
                onDismiss={() => setMessage(null)}
              >
                {message.details && <p>{message.details}</p>}
              </Banner>
            )}

            {/* SAAS Metrics Grid */}
            {/* Keep metrics visible during preview refresh to avoid layout jump */}
            {previews.length > 0 && (
              <Box paddingBlockEnd="300">
                <Grid>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <Card>
                      <Box padding="300" background="bg-surface-success" borderRadius="200">
                        <BlockStack gap="100" align="start">
                          <Text as="p" variant="bodySm" tone="subdued">Potential Revenue Lift</Text>
                          <Text as="p" variant="headingLg" tone="success">
                            {`+${formatMoney(previews.reduce((sum, p) => sum + ((parseFloat(p.overriddenPrice || p.newPrice)) - parseFloat(p.originalBasePrice)), 0), currencyCode)}`}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <Card>
                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100" align="start">
                          <Text as="p" variant="bodySm" tone="subdued">Success Rate</Text>
                          <Text as="p" variant="headingLg">
                            {`${metrics.successRate.toFixed(1)}%`}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <Card>
                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100" align="start">
                          <Text as="p" variant="bodySm" tone="subdued">Total Optimizations</Text>
                          <Text as="p" variant="headingLg">
                            {metrics.totalApplied}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>
                  </Grid.Cell>
                  <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                    <Card>
                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100" align="start">
                          <Text as="p" variant="bodySm" tone="subdued">Last Update</Text>
                          <Text as="p" variant="headingLg">
                            {metrics.lastUpdate ? timeAgo(metrics.lastUpdate) : "Never"}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>
                  </Grid.Cell>
                </Grid>
              </Box>
            )}

            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <Text as="h3" variant="headingMd">Campaign History</Text>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Operational history from campaign runs
                    </Text>
                    <Button
                      size="slim"
                      variant="tertiary"
                      icon={RefreshIcon}
                      loading={campaignHistoryLoading}
                      disabled={campaignHistoryLoading}
                      onClick={() => { void handleRefreshCampaignHistory(); }}
                    >
                      Refresh
                    </Button>
                    <Button
                      size="slim"
                      variant="tertiary"
                      icon={campaignHistoryExpanded ? ChevronUpIcon : ChevronDownIcon}
                      onClick={toggleCampaignHistoryExpanded}
                      accessibilityLabel={campaignHistoryExpanded ? "Collapse campaign history panel" : "Expand campaign history panel"}
                    >
                      {campaignHistoryExpanded ? "Collapse" : "Expand"}
                    </Button>
                  </InlineStack>
                </InlineStack>
                <div
                  style={{
                    overflow: "hidden",
                    maxHeight: campaignHistoryExpanded ? 1200 : 0,
                    opacity: campaignHistoryExpanded ? 1 : 0,
                    transition: "max-height 220ms ease, opacity 160ms ease",
                  }}
                >
                  <BlockStack gap="300">
                    <InlineStack gap="300" wrap align="start">
                      <div style={{ flex: "1 1 200px", minWidth: "180px" }}>
                        <Select
                          label="Status"
                          options={campaignHistoryStatusOptions}
                          value={campaignHistoryStatusFilter}
                          onChange={handleCampaignHistoryStatusFilterChange}
                        />
                      </div>
                      <div style={{ flex: "1 1 180px", minWidth: "160px" }}>
                        <Select
                          label="Source"
                          options={campaignHistorySourceOptions}
                          value={campaignHistorySourceFilter}
                          onChange={handleCampaignHistorySourceFilterChange}
                        />
                      </div>
                      <div style={{ flex: "2 1 260px", minWidth: "220px" }}>
                        <TextField
                          label="Search Campaigns"
                          value={campaignHistorySearchQuery}
                          onChange={handleCampaignHistorySearchChange}
                          autoComplete="off"
                          placeholder="Campaign title or campaign ID"
                          maxLength={120}
                        />
                      </div>
                    </InlineStack>
                    <Checkbox
                      label="Hide Closed Campaigns"
                      checked={hideClosedCampaigns}
                      onChange={(checked) => {
                        setHideClosedCampaigns(checked);
                        console.log(
                          checked
                            ? "[Campaign History UI] closed campaigns hidden"
                            : "[Campaign History UI] closed campaigns shown"
                        );
                      }}
                    />

                    <Text as="p" variant="bodySm" tone="subdued">
                      Showing {visibleCampaignHistory.length} of {filteredCampaignHistory.length} matching campaigns
                    </Text>

                    {visibleCampaignHistory.length === 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {campaignHistoryEmptyStateMessage}
                      </Text>
                    ) : (
                      <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
                        <BlockStack gap="200">
                          {visibleCampaignHistory.map((campaign) => (
                            <Box
                              key={campaign.campaignId}
                              padding="300"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                                <div style={{ flex: "2 1 420px", minWidth: 260 }}>
                                  <BlockStack gap="200">
                                    <InlineStack gap="200" blockAlign="center" wrap>
                                      <Text as="p" variant="bodyMd" fontWeight="medium">
                                        {campaign.title}
                                      </Text>
                                      <Badge tone={campaignStatusTone(campaign.status)}>
                                        {campaign.status.toLowerCase() === "unrecoverable" ? "Unrecoverable" : campaign.status}
                                      </Badge>
                                    </InlineStack>
                                    <InlineStack gap="400" wrap>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        Source: {campaign.source || "unknown"}
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        Products: {campaign.productCount}
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        Created: {new Date(campaign.createdAt).toLocaleString()}
                                      </Text>
                                    </InlineStack>
                                  </BlockStack>
                                </div>

                                <div style={{ flex: "1 1 360px", minWidth: 260 }}>
                                  <Box padding="200" background="bg-surface" borderRadius="200">
                                    <BlockStack gap="150">
                                      <InlineStack gap="150" wrap>
                                        <Badge tone="success">{`Reverted: ${campaign.revertedCount ?? 0}`}</Badge>
                                        <Badge tone="warning">{`Failed: ${campaign.failedCount ?? 0}`}</Badge>
                                      </InlineStack>
                                      <InlineStack gap="150" wrap>
                                        <Badge tone="critical">{`Unrecoverable: ${campaign.unrecoverableCount ?? 0}`}</Badge>
                                        <Badge tone="info">{`Tracked: ${campaign.totalTrackedCount ?? 0}`}</Badge>
                                      </InlineStack>
                                    </BlockStack>
                                  </Box>
                                  {campaign.unrecoverableReason && (
                                    <Box paddingBlockStart="100">
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        Reason: {campaign.unrecoverableReason}
                                      </Text>
                                    </Box>
                                  )}
                                </div>

                                <div style={{ flex: "0 1 auto", marginInlineStart: "auto" }}>
                                  <BlockStack gap="150" align="end">
                                    <Button
                                      size="slim"
                                      variant="tertiary"
                                      onClick={() => { void openCampaignDetailView(campaign); }}
                                    >
                                      View
                                    </Button>
                                    {campaign.status.toLowerCase() === "partial" && campaign.revertable && (
                                      <Button
                                        size="slim"
                                        variant="secondary"
                                        disabled={isProcessing}
                                        loading={isProcessing}
                                        onClick={() => openCampaignRevertPreview(campaign, true)}
                                      >
                                        Retry Failed Reverts
                                      </Button>
                                    )}
                                    {campaign.revertable && (
                                      <Button
                                        size="slim"
                                        tone="critical"
                                        disabled={isProcessing}
                                        loading={isProcessing}
                                        onClick={() => openCampaignRevertPreview(campaign)}
                                      >
                                        Revert
                                      </Button>
                                    )}
                                  </BlockStack>
                                </div>
                              </InlineStack>
                            </Box>
                          ))}
                        </BlockStack>
                      </div>
                    )}
                  </BlockStack>
                </div>

                {!campaignHistoryExpanded && (
                  <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                    <InlineStack gap="300" wrap>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Active: {campaignHistorySummary.active}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Partial: {campaignHistorySummary.partial}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Closed: {campaignHistorySummary.closed}
                      </Text>
                    </InlineStack>
                  </Box>
                )}
              </BlockStack>
            </Card>

            {/* UPDATED TASK 2: No Rules Warning Banner — shows when ruleExists is definitively false */}
            {!hasRules && ruleExists !== null && (
              <Box paddingBlockStart="100" paddingBlockEnd="400">
                <Banner tone="warning" title="No Pricing Rules Found">
                  <Box paddingBlockStart="100" paddingBlockEnd="100">
                    <BlockStack gap="200">
                      <p>
                        You must configure at least one pricing rule before applying changes or going live.
                      </p>
                      <InlineStack>
                        {/* UPDATED Task 5: Configure Rules → primary (default) */}
                        <Button variant="primary" tone="success" size="large" onClick={() => navigate("/app/rules")}>
                          Configure Pricing Rules
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </Banner>
              </Box>
            )}

            {/* ── TASK 3: Storefront Control Panel with Live Status Indicator ── */}
            {/* UPDATED Task 6: Opacity dimming when no rules */}
            <Box paddingBlockEnd="300">
              <div style={{
                opacity: !hasRules ? 0.6 : 1,
                transition: "opacity 0.2s ease",
                pointerEvents: !hasRules ? "none" : "auto",  // ADDED: block clicks at wrapper level too
              }}>
                <Card padding="0">
                  <Box
                    padding="400"
                    background="bg-surface-secondary"
                    borderWidth="025"
                    borderColor="border"
                    borderRadius="300"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                        <div style={{ flex: "1 1 460px" }}>
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="headingMd">Storefront Control Panel</Text>
                              <Tooltip content="Virtual overlay: changes what customers see on your storefront without altering catalog prices until you apply updates elsewhere.">
                                <span style={{ cursor: "pointer", display: "inline-flex" }}>
                                  <Icon source={InfoIcon} tone="subdued" />
                                </span>
                              </Tooltip>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Manage storefront pricing visibility for shoppers. Admin catalog prices remain unchanged until updates are applied in this app.
                            </Text>
                          </BlockStack>
                        </div>

                        <InlineStack gap="200" blockAlign="center" wrap>
                          <InlineStack gap="150" blockAlign="center" wrap={false}>
                            <span
                              className={`pp-live-dot ${metrics.isLive ? "pp-live-dot--active" : "pp-live-dot--inactive"}`}
                              aria-hidden="true"
                            />
                            <Text as="span" variant="headingSm" fontWeight="semibold">
                              {metrics.isLive ? "Live pricing is active" : "Live pricing is paused"}
                            </Text>
                          </InlineStack>
                          <Badge tone={metrics.isLive ? "success" : "attention"}>
                            {metrics.isLive ? "Storefront active" : "Storefront paused"}
                          </Badge>
                        </InlineStack>
                      </InlineStack>

                      <InlineStack gap="200" blockAlign="center" wrap>
                        {metrics.isLive ? (
                          <Button
                            onClick={handleStopLiveClick}
                            disabled={isProcessing || !hasRules}
                            tone="critical"
                            variant="secondary"
                          >
                            Pause Live Pricing
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            onClick={handleGoLiveClick}
                            loading={isProcessing}
                            disabled={isProcessing || !hasRules || !storefrontControl.canGoLive}
                          >
                            Publish Pricing
                          </Button>
                        )}
                        <Text as="span" variant="bodySm" tone="subdued">
                          {storefrontControl.goLiveMessage}
                        </Text>
                      </InlineStack>

                      <BlockStack gap="150">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Operational attention
                        </Text>
                        <InlineStack gap="200" wrap>
                          <Badge tone={storefrontControl.stagedPendingCount > 0 ? "warning" : "info"}>
                            {`Ready to publish: ${storefrontControl.stagedPendingCount}`}
                          </Badge>
                          <Badge tone={storefrontControl.retryableRevertCount > 0 ? "attention" : "success"}>
                            {`Recoverable issues: ${storefrontControl.retryableRevertCount}`}
                          </Badge>
                          <Badge tone={storefrontControl.unrecoverableCount > 0 ? "critical" : "success"}>
                            {`Attention needed: ${storefrontControl.unrecoverableCount}`}
                          </Badge>
                        </InlineStack>
                      </BlockStack>

                      <BlockStack gap="150">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Operational details
                        </Text>
                        <InlineStack gap="200" wrap>
                          <Badge tone={storefrontControl.influencedVariantCount > 0 ? "info" : "success"}>
                            {`Active pricing rules: ${storefrontControl.influencedVariantCount}`}
                          </Badge>
                          {(storefrontControl.openCampaignCount > 0 || storefrontControl.closedCampaignCount > 0) && (
                            <Badge tone="info">
                              {`Open campaigns: ${storefrontControl.openCampaignCount} • Closed campaigns: ${storefrontControl.closedCampaignCount}`}
                            </Badge>
                          )}
                          {storefrontControl.latestInfluenceAt && (
                            <Badge tone="info">
                              {`Last storefront update: ${timeAgo(storefrontControl.latestInfluenceAt)}`}
                            </Badge>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  </Box>
                </Card>
              </div>
            </Box>

            {/* Empty products state */}
            {!loading && previews.length === 0 && (
              <Card>
                <Box padding="500">
                  <BlockStack gap="200" align="center">
                    <Text as="h2" variant="headingMd">No preview products yet</Text>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      Refresh previews after configuring rules, or check that this app can access products in your catalog.
                    </Text>
                    <Button variant="primary" tone="success" onClick={handlePreview}>Refresh previews</Button>
                  </BlockStack>
                </Box>
              </Card>
            )}

            {/* ── TASK 1 + 6: Apply / Batch panel — opacity-dimmed and disabled when no rules ── */}
            {/* UPDATED: pointer-events blocked at wrapper level as an extra safety layer */}
            <div style={{
              opacity: !hasRules ? 0.6 : 1,
              transition: "opacity 0.2s ease",
              pointerEvents: !hasRules ? "none" : "auto",
            }}>
              <Box paddingBlockEnd="300">
                <BlockStack gap="200">
                      {/* 🔹 1. ACTION BAR CARD */}
                      <Card>
                        <BlockStack gap="200">
                          <InlineStack gap="400" align="start" blockAlign="center" wrap>
                            {/* Operations: refresh + apply */}
                            <InlineStack gap="200" align="start" blockAlign="center" wrap>
                              <div style={{ pointerEvents: "auto" }}>
                                <Button
                                  variant="plain"
                                  icon={RefreshIcon}
                                  onClick={handlePreview}
                                  loading={loading}
                                  disabled={loading || isProcessing}
                                >
                                  Refresh Previews
                                </Button>
                              </div>
                            </InlineStack>

                            {/* Workflow: immediate and scheduled operations */}
                            <InlineStack gap="200" align="start" blockAlign="center" wrap>
                              <Button
                                variant="primary"
                                tone="success"
                                onClick={() => openImmediateApplyModal("selected")}
                                disabled={
                                  !hasActivePlan ||
                                  isProcessing ||
                                  !hasRules ||
                                  selectedPreviewItems.length === 0
                                }
                              >
                                {`Apply Selected (${selectedPreviewItems.length})`}
                              </Button>
                              <Button
                                variant="primary"
                                onClick={() => openImmediateApplyModal("all")}
                                disabled={!hasActivePlan || isProcessing || previews.length === 0 || !hasRules}
                              >
                                {`Apply All (${previews.length})`}
                              </Button>

                              <Button
                                variant="secondary"
                                icon={CalendarTimeIcon}
                                onClick={() => setScheduleHistoryModalOpen(true)}
                              >
                                Schedule Center
                              </Button>
                            </InlineStack>

                            {/* Utility: report + undo */}
                            <InlineStack gap="200" align="start" blockAlign="center" wrap>
                              {previews.length === 0 ? (
                                <Tooltip content="Please refresh previews to generate the latest report.">
                                  <span style={{ display: "inline-block" }}>
                                    <Button variant="plain" icon={ArrowDownIcon} disabled>
                                      Download Impact Report
                                    </Button>
                                  </span>
                                </Tooltip>
                              ) : (
                                <Button
                                  variant="plain"
                                  icon={ArrowDownIcon}
                                  onClick={handleDownloadReport}
                                >
                                  Download Impact Report
                                </Button>
                              )}

                              {lastUpdate && (
                                <Button
                                  variant="secondary"
                                  tone="critical"
                                  icon={UndoIcon}
                                  onClick={handleUndo}
                                  loading={isProcessing}
                                  disabled={isProcessing || !lastUpdate.batchId}
                                >
                                  Undo Last Update
                                </Button>
                              )}
                            </InlineStack>
                          </InlineStack>

                          {/* Processing progress */}
                          {isProcessing && (
                            <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                              <BlockStack gap="200" align="center">
                                <InlineStack gap="300" blockAlign="center" align="center">
                                  <Spinner size="small" />
                                  <Text as="p" variant="bodyMd" fontWeight="medium">Processing price updates…</Text>
                                </InlineStack>
                                <Text as="p" tone="subdued" variant="bodySm">Keep this page open until processing finishes.</Text>
                                <ProgressBar progress={progress === 0 ? 10 : progress} tone="primary" />
                              </BlockStack>
                            </Box>
                          )}
                        </BlockStack>
                      </Card>

                      {/* 🔹 2. FILTER CARD */}
                      <Card>
                        <BlockStack gap="200">
                          <Text as="h3" variant="headingMd">Filters & Smart Segments</Text>

                          <InlineStack gap="200" wrap>
                            <Button pressed={activeFilter === "all"} onClick={() => setActiveFilter("all")}>All</Button>
                            <Button pressed={activeFilter === "increase"} onClick={() => setActiveFilter("increase")}>Price Increase</Button>
                            <Button pressed={activeFilter === "decrease"} onClick={() => setActiveFilter("decrease")}>Price Decrease</Button>
                            <Button pressed={activeFilter === "high_impact"} onClick={() => setActiveFilter("high_impact")}>High Impact (&gt;10%)</Button>
                          </InlineStack>

                          <InlineStack gap="300" wrap align="start">
                            <div style={{ flex: "1 1 160px", minWidth: "160px" }}>
                              <TextField
                                label="Search Products"
                                value={searchQuery}
                                onChange={handleSearchChange}
                                autoComplete="off"
                                placeholder="Product title..."
                                maxLength={100}
                              />
                            </div>
                            <div style={{ flex: "1 1 160px", minWidth: "160px" }}>
                              <Select
                                label="Sort by"
                                options={[
                                  { label: "Name (A-Z)", value: "name_asc" },
                                  { label: "Name (Z-A)", value: "name_desc" },
                                  { label: "Price (Low to High)", value: "price_asc" },
                                  { label: "Price (High to Low)", value: "price_desc" },
                                  { label: "% Change (Asc)", value: "change_asc" },
                                  { label: "% Change (Desc)", value: "change_desc" },
                                ]}
                                value={sortOrder}
                                onChange={setSortOrder}
                              />
                            </div>
                            <div style={{ flex: "1 1 160px", minWidth: "160px" }}>
                              <TextField
                                label="Min Price"
                                type="text"
                                inputMode="decimal"
                                value={minPrice}
                                onChange={handleMinPriceChange}
                                autoComplete="off"
                                prefix={currencySymbol}
                                maxLength={15}
                              />
                            </div>
                            <div style={{ flex: "1 1 160px", minWidth: "160px" }}>
                              <TextField
                                label="Max Price"
                                type="text"
                                inputMode="decimal"
                                value={maxPrice}
                                onChange={handleMaxPriceChange}
                                autoComplete="off"
                                prefix={currencySymbol}
                                maxLength={15}
                              />
                            </div>
                          </InlineStack>
                        </BlockStack>
                      </Card>

                      {/* 🔹 3. PRODUCT GRID CARD */}
                      <Card>
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                            <InlineStack gap="300" blockAlign="center" wrap>
                              <Text as="h3" variant="headingMd">Products</Text>
                              <Button size="slim" onClick={selectAllVisible}>Select All on Page</Button>
                              <Button size="slim" onClick={() => setSelectedItems(new Set())}>Clear Selection</Button>
                            </InlineStack>
                            <Pagination
                              hasPrevious={currentPage > 1}
                              onPrevious={() => setCurrentPage(prev => prev - 1)}
                              hasNext={currentPage < totalPages}
                              onNext={() => setCurrentPage(prev => prev + 1)}
                              label={`Page ${currentPage} of ${totalPages || 1}`}
                            />
                          </InlineStack>

                          {/* Product rows */}
                          <BlockStack gap="0">
                            {previews.length > 0 && filteredPreviews.length === 0 && (
                              <Box paddingBlockEnd="400">
                                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                                  <BlockStack gap="100">
                                    <Text as="p" variant="bodyMd" fontWeight="medium">
                                      No products match your filters
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      Adjust search, price range, or smart segment filters. Clear filters to see all preview products again.
                                    </Text>
                                  </BlockStack>
                                </Box>
                              </Box>
                            )}
                            {paginatedPreviews.map((p) => {
                              const currentPrice = parseFloat(p.oldPrice);
                              const originalPrice = parseFloat(p.originalBasePrice);
                              const isManual = p.overriddenPrice !== undefined;
                              const targetPrice = isManual ? parseFloat(p.overriddenPrice!) || 0 : parseFloat(p.newPrice);
                              const isPolished = currentPrice !== originalPrice;
                              const isChanged = currentPrice !== targetPrice;
                              const diffFromOriginal = originalPrice !== 0 ? ((targetPrice - originalPrice) / originalPrice) * 100 : 0;
                              const isSelected = selectedItems.has(p.variantId);

                              return (
                                <Box
                                  key={p.variantId}
                                  paddingBlockStart="400"
                                  paddingBlockEnd="400"
                                  paddingInline="300"
                                  borderBlockEndWidth="025"
                                  borderColor="border-secondary"
                                >
                                  <Box
                                    background={isManual ? "bg-surface-caution" : undefined}
                                    padding="200"
                                    borderRadius="200"
                                  >

                                    <div style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "flex-start",
                                      gap: "16px",
                                      width: "100%",
                                      flexWrap: "wrap",
                                    }}
                                    >
                                      {/* LEFT SIDE */}
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "12px",
                                          minWidth: 0,
                                          flex: 1, overflowX: "hidden"
                                        }}
                                      >
                                        <Checkbox
                                          label=""
                                          labelHidden
                                          checked={isSelected}
                                          onChange={() => toggleSelection(p.variantId)}
                                        />

                                        <Thumbnail source={p.image || ""} alt={p.title} size="small" />

                                        <BlockStack gap="100">
                                          <Text as="span" variant="bodyMd" fontWeight="medium">
                                            {p.title}
                                          </Text>

                                          <div
                                            style={{
                                              display: "flex",
                                              gap: "6px",
                                              flexWrap: "wrap",
                                              opacity: 0.92,
                                            }}
                                          >
                                            {isChanged ? (
                                              <Badge tone={targetPrice > currentPrice ? "success" : "attention"}>
                                                {targetPrice > currentPrice
                                                  ? "Profit Optimized"
                                                  : "Price Reduced"}
                                              </Badge>
                                            ) : (
                                              <Badge tone="info">No change</Badge>
                                            )}

                                            {isPolished && (
                                              <Badge tone="success">Polished</Badge>
                                            )}

                                            {isManual && (
                                              <Badge tone="attention">Manual override</Badge>
                                            )}

                                            {Math.abs(diffFromOriginal) >= 10 && (
                                              <Badge tone="warning">High impact</Badge>
                                            )}
                                          </div>
                                        </BlockStack>
                                      </div>

                                      {/* RIGHT SIDE */}
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "12px",
                                          flexShrink: 0,
                                          flexWrap: "wrap",
                                          justifyContent: "flex-end",
                                          fontVariantNumeric: "tabular-nums",
                                        }}
                                      >
                                        <BlockStack gap="100" inlineAlign="end">
                                          <Text as="span" variant="bodySm" tone="subdued">
                                            Original:{" "}
                                            {formatMoney(parseFloat(p.originalBasePrice), currencyCode)}
                                          </Text>

                                          <Text
                                            as="span"
                                            variant="bodySm"
                                            tone="subdued"
                                            textDecorationLine={
                                              isPolished || isChanged ? "line-through" : undefined
                                            }
                                          >
                                            Current: {formatMoney(parseFloat(p.oldPrice), currencyCode)}
                                          </Text>
                                        </BlockStack>

                                        <Box width="92px" minWidth="88px">
                                          <TextField
                                            label=""
                                            labelHidden
                                            value={
                                              p.overriddenPrice !== undefined
                                                ? p.overriddenPrice
                                                : p.newPrice
                                            }
                                            onChange={(val) => handlePriceChange(p.variantId, val)}
                                            autoComplete="off"
                                            prefix={currencySymbol}
                                            size="slim"
                                            maxLength={15}
                                          />
                                        </Box>

                                        {(isPolished || isChanged) && (
                                          <Text
                                            as="span"
                                            variant="bodySm"
                                            tone={targetPrice > originalPrice ? "success" : "caution"}
                                            fontWeight="medium"
                                          >
                                            {`${targetPrice > originalPrice ? "+" : ""}${diffFromOriginal.toFixed(
                                              1
                                            )}%`}
                                          </Text>
                                        )}

                                        {isManual && (
                                          <Button
                                            size="slim"
                                            variant="tertiary"
                                            onClick={() => resetOverride(p.variantId)}
                                          >
                                            Reset
                                          </Button>
                                        )}

                                        {isChanged ? (
                                          <Button
                                            size="slim"
                                            onClick={() => handleApplySingle(p)}
                                            loading={updatingItem === p.variantId}
                                            disabled={
                                              !hasActivePlan ||
                                              !!updatingItem ||
                                              isProcessing ||
                                              (isManual && p.overriddenPrice === "") ||
                                              !hasRules
                                            }
                                            tone="success"
                                          >
                                            Apply
                                          </Button>
                                        ) : (
                                          <Tooltip content="This price is already synced with your Shopify Admin. No update needed.">
                                            <span style={{ display: "inline-block" }}>
                                              <Button
                                                size="slim"
                                                onClick={() => handleApplySingle(p)}
                                                loading={updatingItem === p.variantId}
                                                disabled={
                                                  !hasActivePlan ||
                                                  !!updatingItem ||
                                                  isProcessing ||
                                                  (isManual && p.overriddenPrice === "") ||
                                                  !hasRules
                                                }
                                              >
                                                Apply
                                              </Button>
                                            </span>
                                          </Tooltip>
                                        )}
                                      </div>
                                    </div>


                                  </Box>
                                </Box>

                              );
                            })}
                          </BlockStack>


                          <InlineStack align="center">
                            <Pagination
                              hasPrevious={currentPage > 1}
                              onPrevious={() => setCurrentPage(prev => prev - 1)}
                              hasNext={currentPage < totalPages}
                              onNext={() => setCurrentPage(prev => prev + 1)}
                              label={`Page ${currentPage} of ${totalPages || 1}`}
                            />
                          </InlineStack>

                          {!hasActivePlan && (
                            <Text as="p" variant="bodySm" tone="critical">
                              Start your free trial to apply pricing changes from this dashboard.
                            </Text>
                          )}
                        </BlockStack>
                      </Card>
                </BlockStack>
              </Box>
            </div>

          </BlockStack>
        </div>

        {/* ── TASK 4: Confirmation Modals ── */}

        {shopify && (
          <ImmediateApplyConfirmationModal
            open={immediateApplyModalOpen}
            onClose={closeImmediateApplyModal}
            scopeLabel={immediateApplyScopeLabel}
            itemCount={immediateApplyItems.length}
            impactSummary={immediateApplyImpactSummary}
            safeguardNotices={immediateApplySafeguardNotices}
            isProcessing={isProcessing}
            initialCampaignTitle={applyCampaignTitle}
            onConfirm={async (campaignTitle) => {
              const ok = await handleApplyBatch(immediateApplyItems, campaignTitle);
              if (ok) {
                setApplyCampaignTitle(campaignTitle);
              }
              return ok;
            }}
          />
        )}

        {shopify && (
          <ScheduledHistoryModal
            open={scheduleHistoryModalOpen}
            onClose={() => setScheduleHistoryModalOpen(false)}
            currencyCode={currencyCode}
            previews={previews}
            filteredPreviews={filteredPreviews}
            selectedItems={selectedItems}
            collectionId={collectionId}
            hasActivePlan={hasActivePlan}
            hasRules={hasRules}
            shopify={shopify}
          />
        )}

        <Modal
          open={campaignDetailOpen}
          onClose={() => {
            setCampaignDetailOpen(false);
            setCampaignDetail(null);
            setSelectedCampaignForDetail(null);
            setCampaignDetailPageSize(15);
            setCampaignDetailPage(1);
          }}
          title={`Campaign Details${selectedCampaignForDetail ? `: ${selectedCampaignForDetail.title}` : ""}`}
          secondaryActions={[{
            content: "Close",
            onAction: () => {
              setCampaignDetailOpen(false);
              setCampaignDetail(null);
              setSelectedCampaignForDetail(null);
              setCampaignDetailPageSize(15);
              setCampaignDetailPage(1);
            },
          }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {campaignDetailLoading ? (
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="small" />
                </InlineStack>
              ) : campaignDetail ? (
                <>
                  <InlineStack gap="300" wrap>
                    <Text as="p" variant="bodySm">
                      <strong>Campaign:</strong> {campaignDetail.title}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>Tracked items:</strong> {campaignDetail.totalTrackedCount ?? campaignDetail.rows.length}
                    </Text>
                  </InlineStack>

                  <InlineStack gap="200" wrap>
                    <Badge tone="success">{`Reverted: ${campaignDetail.revertedCount ?? 0}`}</Badge>
                    <Badge tone="warning">{`Failed: ${campaignDetail.failedCount ?? 0}`}</Badge>
                    <Badge tone="critical">{`Unrecoverable: ${campaignDetail.unrecoverableCount ?? 0}`}</Badge>
                  </InlineStack>

                  {campaignOperationalTimeline.length > 0 && (
                    <Box padding="300" background="bg-surface" borderRadius="200">
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          Operational timeline
                        </Text>
                        <div
                          style={{
                            borderLeft: "2px solid var(--p-color-border-secondary)",
                            paddingLeft: 12,
                          }}
                        >
                          <BlockStack gap="200">
                            {campaignOperationalTimeline.map((milestone, index) => (
                              <div
                                key={milestone.key}
                                style={{
                                  position: "relative",
                                  paddingLeft: 10,
                                  paddingBottom: index === campaignOperationalTimeline.length - 1 ? 0 : 2,
                                }}
                              >
                                <span
                                  aria-hidden
                                  style={{
                                    position: "absolute",
                                    left: -18,
                                    top: 5,
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background:
                                      milestone.tone === "critical"
                                        ? "var(--p-color-bg-fill-critical)"
                                        : milestone.tone === "warning"
                                          ? "var(--p-color-bg-fill-warning)"
                                          : milestone.tone === "success"
                                            ? "var(--p-color-bg-fill-success)"
                                            : "var(--p-color-bg-fill-info)",
                                  }}
                                />
                                <InlineStack align="space-between" blockAlign="start" wrap={false}>
                                  <InlineStack gap="200" blockAlign="center">
                                    <Text as="p" variant="bodySm" fontWeight="medium">
                                      {milestone.label}
                                    </Text>
                                    <Badge tone={milestone.tone}>
                                      {milestone.badgeLabel ?? "Milestone"}
                                    </Badge>
                                  </InlineStack>
                                  {milestone.timestamp ? (
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {milestone.timestamp}
                                    </Text>
                                  ) : null}
                                </InlineStack>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {milestone.description}
                                </Text>
                              </div>
                            ))}
                          </BlockStack>
                        </div>
                      </BlockStack>
                    </Box>
                  )}

                  <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="end">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`Showing ${
                            campaignDetailPaginatedRows.length === 0
                              ? 0
                              : (campaignDetailPage - 1) * campaignDetailPageSize + 1
                          }-${
                            (campaignDetailPage - 1) * campaignDetailPageSize +
                            campaignDetailPaginatedRows.length
                          } of ${campaignDetailRows.length} tracked items`}
                        </Text>
                        <div style={{ minWidth: 140 }}>
                          <Select
                            label="Rows per page"
                            options={OPERATIONAL_PAGE_SIZE_OPTIONS.map((size) => ({
                              label: `${SELECT_OPTION_PREFIX}${size}`,
                              value: String(size),
                            }))}
                            value={String(campaignDetailPageSize)}
                            onChange={(value) => setCampaignDetailPageSize(Number(value))}
                          />
                        </div>
                      </InlineStack>
                      <BlockStack gap="150">
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: CAMPAIGN_DETAIL_COMPARISON_GRID,
                            gap: "12px",
                            alignItems: "center",
                            paddingInline: "2px",
                          }}
                        >
                          <Text as="p" variant="bodySm" fontWeight="medium">Product</Text>
                          <div style={{ fontVariantNumeric: "tabular-nums" }}>
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="medium"
                              alignment="end"
                            >
                              Reverted From
                            </Text>
                          </div>
                          <div style={{ fontVariantNumeric: "tabular-nums" }}>
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="medium"
                              alignment="end"
                            >
                              Restored To
                            </Text>
                          </div>
                          <InlineStack align="start">
                            <Text as="p" variant="bodySm" fontWeight="medium">Status</Text>
                          </InlineStack>
                        </div>
                        {campaignDetailPaginatedRows.map((row) => (
                          <div
                            key={`${row.variantId}-${row.revertTargetPrice}-${row.status ?? "pending"}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: CAMPAIGN_DETAIL_COMPARISON_GRID,
                              gap: "12px",
                              alignItems: "start",
                              padding: "12px 2px",
                              borderTop: "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <BlockStack gap="0">
                                <div style={{ overflowWrap: "anywhere" }}>
                                  <Text as="p" variant="bodySm">
                                    {row.productTitle}
                                  </Text>
                                </div>
                                <div style={{ overflowWrap: "anywhere" }}>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {compactVariantIdentifier(row.variantId)}
                                  </Text>
                                </div>
                                {row.revertFailureReason && (
                                  <div style={{ overflowWrap: "anywhere" }}>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {row.revertFailureReason}
                                    </Text>
                                  </div>
                                )}
                              </BlockStack>
                            </div>
                            <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                              <Text
                                as="p"
                                variant="bodySm"
                                alignment="end"
                                tone="subdued"
                              >
                                {row.currentPrice == null ? "-" : formatMoney(row.currentPrice, currencyCode)}
                              </Text>
                            </div>
                            <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                              <Text
                                as="p"
                                variant="bodySm"
                                fontWeight="medium"
                                alignment="end"
                                tone="success"
                              >
                                {formatMoney(row.revertTargetPrice, currencyCode)}
                              </Text>
                            </div>
                            <InlineStack align="start" blockAlign="center">
                              <Badge tone={detailStatusTone(row.status)}>
                                {detailStatusLabel(row.status)}
                              </Badge>
                            </InlineStack>
                          </div>
                        ))}
                        {(campaignDetail.missingHistoricalRevertedFromCount ?? 0) > 0 && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Some historical pre-revert values are unavailable. Restored values remain accurate.
                          </Text>
                        )}
                        <InlineStack align="end">
                          <Pagination
                            hasPrevious={campaignDetailPage > 1}
                            onPrevious={() => setCampaignDetailPage((prev) => Math.max(1, prev - 1))}
                            hasNext={campaignDetailPage < campaignDetailTotalPages}
                            onNext={() =>
                              setCampaignDetailPage((prev) =>
                                Math.min(campaignDetailTotalPages, prev + 1)
                              )
                            }
                            label={`Page ${campaignDetailPage} of ${campaignDetailTotalPages}`}
                          />
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  </Box>
                </>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  No campaign detail data available.
                </Text>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

        <Modal
          open={revertPreviewOpen}
          onClose={() => {
            if (isProcessing) return;
            setRevertPreviewOpen(false);
            setSelectedCampaignForRevert(null);
            setRevertPreview(null);
            setRevertPreviewRetryFailedOnly(false);
            resetRevertPreviewViewState();
          }}
          title={`${revertPreviewRetryFailedOnly ? "Retry Failed Reverts" : "Revert Campaign"}${selectedCampaignForRevert ? `: ${selectedCampaignForRevert.title}` : ""}`}
          primaryAction={
            revertPreview?.terminal
              ? undefined
              : {
                content: revertPreviewRetryFailedOnly ? "Confirm Retry" : "Confirm Revert",
                onAction: () => { void confirmCampaignRevert(); },
                destructive: true,
                loading: isProcessing,
                disabled: isProcessing || revertPreviewLoading || !selectedCampaignForRevert,
              }
          }
          secondaryActions={[{
            content: "Cancel",
            onAction: () => {
              setRevertPreviewOpen(false);
              setSelectedCampaignForRevert(null);
              setRevertPreview(null);
              setRevertPreviewRetryFailedOnly(false);
              resetRevertPreviewViewState();
            },
          }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {revertPreviewLoading ? (
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="small" />
                </InlineStack>
              ) : revertPreview ? (
                <>
                  {revertPreview.message && (
                    <Banner tone={revertPreview.terminal ? "warning" : "info"}>
                      <p>{revertPreview.message}</p>
                    </Banner>
                  )}
                  <Text as="p" variant="bodySm" tone="subdued">
                    Review the current storefront prices against revert target prices before confirming.
                  </Text>
                  <InlineStack gap="300" wrap>
                    <Text as="p" variant="bodySm">
                      <strong>Campaign:</strong> {revertPreview.title}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>Affected products:</strong> {revertPreview.productCount}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" wrap>
                    <Badge
                      tone={
                        revertPreview.productCount >= VERY_LARGE_OPERATION_THRESHOLD
                          ? "warning"
                          : "info"
                      }
                    >
                      {`Affected products: ${revertPreview.productCount}`}
                    </Badge>
                    <Badge tone="success">
                      {`Revert rows in preview: ${revertPreview.rows.length}`}
                    </Badge>
                  </InlineStack>
                  {revertSafeguardNotices.length > 0 && (
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                      borderColor="border"
                      borderWidth="025"
                    >
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="center" wrap>
                          <Text as="p" variant="bodySm" fontWeight="medium">
                            Operational safeguards
                          </Text>
                          <InlineStack gap="100" wrap>
                            <Badge tone="warning">
                              {`${revertSafeguardNotices.filter((notice) => notice.severity === "warning").length} Warning${
                                revertSafeguardNotices.filter((notice) => notice.severity === "warning").length === 1
                                  ? ""
                                  : "s"
                              }`}
                            </Badge>
                            <Badge tone="info">
                              {`${revertSafeguardNotices.filter((notice) => notice.severity === "informational").length} Info`}
                            </Badge>
                          </InlineStack>
                        </InlineStack>
                        <BlockStack gap="150">
                          {revertSafeguardNotices.map((notice) => (
                            <InlineStack key={notice.id} gap="200" blockAlign="center">
                              <Badge tone={notice.severity === "warning" ? "warning" : "info"}>
                                {notice.severity === "warning" ? "Warning" : "Info"}
                              </Badge>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {notice.message}
                              </Text>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  )}
                  {selectedCampaignForRevert?.unrecoverableReason && (
                    <Banner tone="warning">
                      <p>{selectedCampaignForRevert.unrecoverableReason}</p>
                    </Banner>
                  )}
                  <Box
                    padding="200"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderColor="border"
                    borderWidth="025"
                  >
                    <InlineStack gap="200" wrap align="space-between" blockAlign="end">
                      <div style={{ minWidth: 220, flex: "1 1 320px" }}>
                        <TextField
                          label="Search product"
                          value={revertPreviewSearchQuery}
                          onChange={setRevertPreviewSearchQuery}
                          placeholder="Search by product title"
                          autoComplete="off"
                          disabled={isProcessing}
                        />
                      </div>
                      <div style={{ minWidth: 210 }}>
                        <Select
                          label="Movement filter"
                          options={[
                            { label: `${SELECT_OPTION_PREFIX}All products`, value: "all" },
                            { label: `${SELECT_OPTION_PREFIX}Price increases`, value: "increase" },
                            { label: `${SELECT_OPTION_PREFIX}Price decreases`, value: "decrease" },
                            { label: `${SELECT_OPTION_PREFIX}Large movements`, value: "large_movement" },
                          ]}
                          value={revertPreviewMovementFilter}
                          onChange={(value) =>
                            setRevertPreviewMovementFilter(value as RevertPreviewMovementFilter)
                          }
                          disabled={isProcessing}
                        />
                      </div>
                      <div style={{ minWidth: 130 }}>
                        <Select
                          label="Rows per page"
                          options={OPERATIONAL_PAGE_SIZE_OPTIONS.map((size) => ({
                            label: `${SELECT_OPTION_PREFIX}${size}`,
                            value: String(size),
                          }))}
                          value={String(revertPreviewPageSize)}
                          onChange={(value) => setRevertPreviewPageSize(Number(value))}
                          disabled={isProcessing}
                        />
                      </div>
                    </InlineStack>
                  </Box>
                  <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="150">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: REVERT_PREVIEW_COMPARISON_GRID,
                          gap: "12px",
                          alignItems: "center",
                          paddingInline: "2px",
                        }}
                      >
                        <Text as="p" variant="bodySm" fontWeight="medium">Product</Text>
                        <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                            Current
                          </Text>
                        </div>
                        <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                            Revert Target
                          </Text>
                        </div>
                      </div>
                      {revertPreviewPaginatedRows.map((row) => (
                        <div
                          key={`${row.variantId}-${row.revertTargetPrice}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: REVERT_PREVIEW_COMPARISON_GRID,
                            gap: "12px",
                            alignItems: "start",
                            padding: "12px 2px",
                            borderTop: "1px solid var(--p-color-border-secondary)",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <BlockStack gap="0">
                              <div style={{ overflowWrap: "anywhere" }}>
                                <Text as="p" variant="bodySm">{row.productTitle}</Text>
                              </div>
                              <div style={{ overflowWrap: "anywhere" }}>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {compactVariantIdentifier(row.variantId)}
                                </Text>
                              </div>
                            </BlockStack>
                          </div>
                          <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            <Text as="p" variant="bodySm" alignment="end" tone="subdued">
                              {row.currentPrice == null ? "-" : formatMoney(row.currentPrice, currencyCode)}
                            </Text>
                          </div>
                          <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                              {formatMoney(row.revertTargetPrice, currencyCode)}
                            </Text>
                          </div>
                        </div>
                      ))}
                      {revertPreviewFilteredRows.length === 0 ? (
                        <Text as="p" variant="bodySm" tone="subdued">
                          No products match the current revert preview filters.
                        </Text>
                      ) : null}
                      {revertPreview.rows.some((row) => Boolean(row.revertFailureReason)) && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Some items include recovery notes from previous Shopify failures.
                        </Text>
                      )}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`Showing ${
                            revertPreviewFilteredRows.length === 0
                              ? 0
                              : (revertPreviewPage - 1) * revertPreviewPageSize + 1
                          }-${
                            Math.min(
                              revertPreviewPage * revertPreviewPageSize,
                              revertPreviewFilteredRows.length
                            )
                          } of ${revertPreviewFilteredRows.length} matching products`}
                        </Text>
                        <Pagination
                          hasPrevious={revertPreviewPage > 1}
                          onPrevious={() => setRevertPreviewPage((prev) => Math.max(1, prev - 1))}
                          hasNext={revertPreviewPage < revertPreviewTotalPages}
                          onNext={() =>
                            setRevertPreviewPage((prev) =>
                              Math.min(revertPreviewTotalPages, prev + 1)
                            )
                          }
                          label={`Page ${revertPreviewPage} of ${revertPreviewTotalPages}`}
                        />
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  No preview data available.
                </Text>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* UPDATED TASK 4: Go Live confirmation modal */}
        <Modal
          open={showGoLiveModal}
          onClose={() => setShowGoLiveModal(false)}
          title="Go Live with Pricing Rules?"
          primaryAction={{
            content: 'Go Live',
            // UPDATED: wraps existing handler — no logic change
            onAction: () => handlePushStorefront(false),
            loading: isProcessing,
            disabled: isProcessing
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setShowGoLiveModal(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">Prices will be applied to your storefront.</Text>
              <Box paddingInlineStart="400">
                <BlockStack gap="200">
                  <Text as="p">✔️ This will affect all product prices</Text>
                  <Text as="p">✔️ You can stop anytime</Text>
                </BlockStack>
              </Box>
              <Text as="p">Do you want to continue?</Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* UPDATED TASK 4: Stop Live confirmation modal — destructive primary */}
        <Modal
          open={showStopModal}
          onClose={() => setShowStopModal(false)}
          title="Stop Live Pricing?"
          primaryAction={{
            content: 'Stop Live',
            // UPDATED: wraps existing handler — no logic change
            onAction: () => handlePushStorefront(true),
            loading: isProcessing,
            disabled: isProcessing,
            destructive: true
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setShowStopModal(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">This will disable dynamic pricing on your storefront.</Text>
              <Box paddingInlineStart="400">
                <BlockStack gap="200">
                  <Text as="p">✔️ This will remove all live pricing changes</Text>
                  <Text as="p">✔️ Your saved rules will NOT be deleted</Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>

      </Page>
    </div>
  );
}
