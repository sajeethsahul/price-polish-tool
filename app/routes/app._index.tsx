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
  SettingsIcon,
  CalendarTimeIcon,
  ArrowDownIcon,
  UndoIcon,
} from "@shopify/polaris-icons";
import { formatMoney, getCurrencySymbol, ZERO_DECIMAL_CURRENCIES } from "../utils/format";
import { useAppFetch } from "../utils/fetch";
import {
  PricingActionsModal,
  type ApplyMode,
  type PricingActionsPreviewItem,
} from "../components/PricingActionsModal";
import { ScheduledHistoryModal } from "../components/ScheduledHistoryModal";
import { calculatePrice } from "../utils/pricing";


const BATCH_SIZE = 50;
const PAGE_SIZE = 15;

type PreviewItem = PricingActionsPreviewItem;

interface LastUpdateInfo {
  batchId: string;
  updatedAt: string;
  successCount: number;
  failedCount: number;
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);  // UPDATED
  const [showStopModal, setShowStopModal] = useState(false);      // UPDATED
  const [message, setMessage] = useState<{ type: "success" | "critical" | "warning"; text: string; details?: string } | null>(null);
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
  const [metrics, setMetrics] = useState({ totalApplied: 0, lastUpdate: "", successRate: 100, isLive: false, hasActivePlan: true });
  const [applyMode, setApplyMode] = useState<ApplyMode>("");
  const [collectionId, setCollectionId] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [pricingActionsModalOpen, setPricingActionsModalOpen] = useState(false);
  const [scheduleHistoryModalOpen, setScheduleHistoryModalOpen] = useState(false);

  // Billing placeholders — do not modify
  const handleUpgrade = useCallback(() => {
    if (shopify) shopify.toast.show("Billing implementation coming soon!");
    else console.log("BYPASS: Upgrade triggered");
  }, [shopify]);

  const hasActivePlan = metrics.hasActivePlan;

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

      const [data, metricsData] = await Promise.all([
        fetcher("/api/preview-price"),
        fetcher("/api/metrics").catch(() => ({ totalApplied: 0, lastUpdate: "", successRate: 100, isLive: false, hasActivePlan: true }))
      ]);

      console.log("DEBUG: Data received from parallel fetch");

      const fetchedPreviews = data.previews ?? [];
      setPreviews(fetchedPreviews);
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
        hasActivePlan: metricsData.hasActivePlan !== undefined ? metricsData.hasActivePlan : true
      }));

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
  ): Promise<boolean> => {
    if (!hasRules) {
      shopify.toast.show("Configure pricing rules first", { isError: true });
      return false;
    }

    setIsProcessing(true);

    try {
      // handleApplyBatch ONLY stages the items passed to it.
      // It does NOT filter based on applyMode.
      // Callers (row Apply, Apply Selected, Apply All) determine the item list.
      const scopedItems = itemsToUpdate;

      if (scopedItems.length === 0) {
        shopify.toast.show("No products to apply", { isError: true });
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

      const response = await fetch("/api/staging-price", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          products: itemsWithFinalPrices,
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to apply pricing");
      }

      // ── Auto-push when Live Pricing is Active ────────────────────────────
      if (metrics.isLive) {
        const manualVariantIds = itemsWithFinalPrices
          .filter((p) => p.isManual)
          .map((p) => p.variantId);
        const pushRes = await fetch("/api/push-storefront", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear: false, manualVariantIds }),
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

      setPreviews((prev) =>
        prev.map((item) => {
          const applied = itemsWithFinalPrices.find(
            (p) => p.variantId === item.variantId
          );
          if (!applied) return item;
          const appliedPriceNum = Number(applied.newPrice);
          const nextRulePrice = calculatePrice(
            appliedPriceNum,
            activeMarkup,
            roundingStep,
            charmPricing
          );
          return {
            ...item,
            oldPrice: String(applied.newPrice),
            newPrice: applied.isManual ? nextRulePrice.toFixed(2) : String(applied.newPrice),
            overriddenPrice: undefined,
          };
        })
      );

      setIsModalOpen(false);

      return true;
    } catch (error: any) {
      shopify.toast.show(error.message || "Apply failed", { isError: true });
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [hasRules, shopify, metrics.isLive]);

  const handleApplySingle = useCallback((item: PreviewItem) => {
    // Row-level apply — directly passes the single item to handleApplyBatch.
    handleApplyBatch([item]);
  }, [handleApplyBatch]);

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

  const handleApplySelected = useCallback(() => {
    // Apply Selected ONLY uses the current checkbox selection state.
    // It does NOT depend on applyMode (which is for scheduling scope only).
    if (guardNoRules()) return;

    const selectedPreviews = previews.filter(p =>
      selectedItems.has(p.variantId)
    );

    if (selectedPreviews.length === 0) {
      shopify.toast.show("No products selected", { isError: true });
      return;
    }

    handleApplyBatch(selectedPreviews);
  }, [previews, selectedItems, handleApplyBatch, guardNoRules, shopify]);

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
        setLastUpdate(null);
        if (shopify) shopify.toast.show(`Restored ${data.restoredCount} products`);
        else console.log(`BYPASS: Restored ${data.restoredCount} products`);
        handlePreview();
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
  }, [applyMode, lastUpdate, shopify, handlePreview]);

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
      const res = await fetch("/api/push-storefront", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear })
      });

      console.log(`DEBUG: /api/push-storefront status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/push-storefront data received:", !!data);

      if (res.ok) {
        if (shopify) shopify.toast.show(clear ? "Storefront prices restored successfully" : "Prices are now live on your storefront");
        else console.log(`BYPASS: ${clear ? "Storefront prices restored successfully" : "Prices are now live on your storefront"}`);
        setMetrics(prev => ({ ...prev, isLive: !clear }));
      } else {
        throw new Error(data.error || "Failed to push rules.");
      }
    } catch (err) {
      console.error("DEBUG: PushStorefront Error detail:", err);
      if (shopify) shopify.toast.show("No active storefront pricing changes found to restore.", { isError: true });
      else console.error("BYPASS:No active storefront pricing changes found to restore.");
    } finally {
      console.log("DEBUG: Finalizing handlePushStorefront processing state.");
      setIsProcessing(false);
    }
  }, [shopify]);

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
                    <InlineStack align="space-between" blockAlign="start" gap="400" wrap>
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
                          Turn live pricing on or off for the storefront. Catalog prices in Admin are unchanged until you apply updates from this app.
                        </Text>
                      </BlockStack>

                      <BlockStack gap="300" inlineAlign="end">
                        <Box paddingInlineEnd="0">
                          <BlockStack gap="100" inlineAlign="end">
                            <Text as="span" variant="bodySm" tone="subdued">
                              Storefront status
                            </Text>
                            <InlineStack gap="200" blockAlign="center" wrap={false}>
                              <span
                                className={`pp-live-dot ${metrics.isLive ? "pp-live-dot--active" : "pp-live-dot--inactive"}`}
                                aria-hidden="true"
                              />
                              <Text as="span" variant="bodyMd" fontWeight="medium" tone={metrics.isLive ? "success" : "critical"}>
                                {metrics.isLive ? "Live pricing active" : "Live pricing off"}
                              </Text>
                            </InlineStack>
                          </BlockStack>
                        </Box>

                        <InlineStack gap="200" wrap={false}>
                          {metrics.isLive ? (
                            <Button
                              onClick={handleStopLiveClick}
                              disabled={isProcessing || !hasRules}
                              tone="critical"
                              variant="primary"
                            >
                              Stop Live Prices
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              tone="success"
                              onClick={handleGoLiveClick}
                              loading={isProcessing}
                              disabled={isProcessing || !hasRules}
                            >
                              Go Live on Storefront
                            </Button>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </InlineStack>
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

                              <Button
                                variant="primary"
                                tone="success"
                                onClick={() => {
                                  if (guardNoRules()) return;
                                  setIsModalOpen(true);
                                }}
                                disabled={!hasActivePlan || isProcessing || previews.length === 0 || !hasRules}
                              >
                                {`Apply All (${previews.length})`}
                              </Button>

                              <Button
                                variant="secondary"
                                onClick={handleApplySelected}
                                disabled={!hasActivePlan || isProcessing || selectedItems.size === 0 || !hasRules}
                              >
                                {`Apply Selected (${selectedItems.size})`}
                              </Button>
                            </InlineStack>

                            {/* Workflow: modals */}
                            <InlineStack gap="200" align="start" blockAlign="center" wrap>
                              <Button
                                variant="secondary"
                                icon={SettingsIcon}
                                onClick={() => setPricingActionsModalOpen(true)}
                              >
                                Pricing Actions
                              </Button>

                              <Button
                                variant="secondary"
                                icon={CalendarTimeIcon}
                                onClick={() => setScheduleHistoryModalOpen(true)}
                              >
                                Schedule History
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
          <PricingActionsModal
            open={pricingActionsModalOpen}
            onClose={() => setPricingActionsModalOpen(false)}
            applyMode={applyMode}
            onApplyModeChange={setApplyMode}
            scheduleTitle={scheduleTitle}
            onScheduleTitleChange={setScheduleTitle}
            scheduleTime={scheduleTime}
            onScheduleTimeChange={setScheduleTime}
            previews={previews}
            selectedItems={selectedItems}
            isProcessing={isProcessing}
            hasActivePlan={hasActivePlan}
            hasRules={hasRules}
            collectionId={collectionId}
            onApplyBatch={handleApplyBatch}
            shopify={shopify}
          />
        )}

        <ScheduledHistoryModal
          open={scheduleHistoryModalOpen}
          onClose={() => setScheduleHistoryModalOpen(false)}
          currencyCode={currencyCode}
        />

        {/* Apply All confirmation modal — unchanged handler */}
        <Modal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Confirm Bulk Update"
          primaryAction={{
            content: 'Apply Changes',
            onAction: () => { void handleApplyBatch(previews); },
            loading: isProcessing,
            disabled: isProcessing
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setIsModalOpen(false) }]}
        >
          <Modal.Section>
            <Text as="p">
              You are about to update prices for <strong>{previews.length}</strong> products.
              This action can be undone later using the "Undo Last Update" button.
            </Text>
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
