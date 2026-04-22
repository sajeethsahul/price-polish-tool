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
import { InfoIcon } from "@shopify/polaris-icons";
import { formatMoney, getCurrencySymbol, ZERO_DECIMAL_CURRENCIES } from "../utils/format";
import { useAppFetch } from "../utils/fetch";


const BATCH_SIZE = 50;
const PAGE_SIZE = 15;

interface PreviewItem {
  productId: string;
  title: string;
  image: string;
  variantId: string;
  oldPrice: string;
  newPrice: string;
  originalBasePrice: string;
  overriddenPrice?: string;
}

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
  const [metrics, setMetrics] = useState({ totalApplied: 0, lastUpdate: "", successRate: 100, isLive: false, hasActivePlan: true });
  const [applyMode, setApplyMode] = useState<"all" | "selected" | "filtered" | "collection">("all");
  const [collectionId, setCollectionId] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

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
      // UPDATED: Use backend's ruleExists flag as authoritative source for hasRules
      console.log(`[FETCH DEBUG] data.ruleExists=${data.ruleExists}, previews.length=${fetchedPreviews.length}`);
      setRuleExists(data.ruleExists === true);
      setActiveMarkup(data.markupPercent ?? 0);
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

  const handleApplyBatch = useCallback(async (itemsToUpdate: PreviewItem[]) => {
    if (!hasRules) {
      shopify.toast.show("Configure pricing rules first", { isError: true });
      return;
    }

    setIsProcessing(true);

    try {
      let scopedItems = itemsToUpdate;

      // 🔥 Apply Scope Filtering
      if (applyMode === "selected") {
        scopedItems = itemsToUpdate.filter(item =>
          selectedItems.has(item.variantId)
        );
      }

      if (scopedItems.length === 0) {
        shopify.toast.show("No products selected", { isError: true });
        return;
      }

      if (applyMode === "filtered") {
        scopedItems = previews; // already filtered list
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

      const response = await fetch("/api/staging-price", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: itemsWithFinalPrices,
          applyMode,
          collectionId,
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to apply pricing");
      }

      shopify.toast.show("Pricing applied successfully");
    } catch (error: any) {
      shopify.toast.show(error.message || "Apply failed", { isError: true });
    } finally {
      setIsProcessing(false);
    }
  }, [applyMode, selectedItems, hasRules, shopify]);

  const handleApplySingle = useCallback((item: PreviewItem) => {
    handleApplyBatch([item]);
  }, [handleApplyBatch]);

  const handleApplySelected = useCallback(() => {
    // ADDED: Block execution if no rules exist
    if (guardNoRules()) return;
    const itemsToUpdate = previews.filter(p => selectedItems.has(p.variantId));
    handleApplyBatch(itemsToUpdate);
  }, [previews, selectedItems, handleApplyBatch, guardNoRules]);

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
  }, [lastUpdate, shopify, handlePreview]);

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
      if (shopify) shopify.toast.show("Failed to update storefront", { isError: true });
      else console.error("BYPASS: Failed to update storefront");
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
        <BlockStack gap="500">

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
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Welcome to Price Polish! 🚀</Text>
                <Text as="p">Follow these simple steps to optimize your store pricing:</Text>
                <Box paddingInlineStart="400">
                  <BlockStack gap="200">
                    <Text as="p">1️⃣ <strong>Configure:</strong> Set your markup and rounding rules in the <Button variant="tertiary" onClick={() => navigate("/app/rules")}>Rules</Button> page.</Text>
                    <Text as="p">2️⃣ <strong>Preview:</strong> Come back here to see how your new prices will look.</Text>
                    <Text as="p">3️⃣ <strong>Apply:</strong> Review the changes and apply them safely (you can undo anytime).</Text>
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
            <BlockStack gap="200">
              <Text as="p">✔️ Safe to use — all changes can be undone anytime</Text>
              <Text as="p">✔️ Your original prices are preserved and stored securely</Text>
              <Text as="p">💡 <strong>Tip:</strong> The "Apply" button becomes disabled once your price is perfectly synced with your current Pricing Rules. Change your rules to reactivate it!</Text>
            </BlockStack>
          </Banner>

          {/* Live Mode Warning */}
          {metrics.isLive && (
            <Banner tone="warning">
              <BlockStack gap="200">
                <Text as="p">⚠️ <strong>Live Pricing is ON:</strong> Any prices you "Apply" here will permanently change your Shopify database. Because your Live Rules are active, the storefront extension will apply its rules <strong>on top</strong> of these new prices. If you want the "Applied" price to be the final price, please stop Live Pricing or adjust your rules.</Text>
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
          {previews.length > 0 && !loading && (
            <Box paddingBlockEnd="400">
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", border: "1px solid #bbf7d0", borderRadius: 12 }}>
                    <Card>
                      <BlockStack gap="100" align="start">
                        <Text as="p" variant="bodySm" tone="subdued">Potential Revenue Lift</Text>
                        <Text as="h2" variant="headingLg" tone="success">
                          {`+${formatMoney(previews.reduce((sum, p) => sum + ((parseFloat(p.overriddenPrice || p.newPrice)) - parseFloat(p.originalBasePrice)), 0), currencyCode)}`}
                        </Text>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ background: "linear-gradient(135deg, #eff6ff, #dbeafe)", border: "1px solid #bfdbfe", borderRadius: 12 }}>
                    <Card>
                      <BlockStack gap="100" align="start">
                        <Text as="p" variant="bodySm" tone="subdued">Success Rate</Text>
                        <Text as="h2" variant="headingLg">
                          {`${metrics.successRate.toFixed(1)}%`}
                        </Text>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ background: "linear-gradient(135deg, #faf5ff, #ede9fe)", border: "1px solid #ddd6fe", borderRadius: 12 }}>
                    <Card>
                      <BlockStack gap="100" align="start">
                        <Text as="p" variant="bodySm" tone="subdued">Total Optimizations</Text>
                        <Text as="h2" variant="headingLg">
                          {metrics.totalApplied}
                        </Text>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>
                <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                  <div style={{ background: "linear-gradient(135deg, #f9fafb, #f3f4f6)", border: "1px solid #e5e7eb", borderRadius: 12 }}>
                    <Card>
                      <BlockStack gap="100" align="start">
                        <Text as="p" variant="bodySm" tone="subdued">Last Update</Text>
                        <Text as="h2" variant="headingLg">
                          {metrics.lastUpdate ? timeAgo(metrics.lastUpdate) : "Never"}
                        </Text>
                      </BlockStack>
                    </Card>
                  </div>
                </Grid.Cell>
              </Grid>
            </Box>
          )}

          {/* UPDATED TASK 2: No Rules Warning Banner — shows when ruleExists is definitively false */}
          {!hasRules && ruleExists !== null && (
            <Box paddingBlockStart="200" paddingBlockEnd="500">
              <Banner tone="warning" title="No Pricing Rules Found">
                <Box paddingBlockStart="200" paddingBlockEnd="200">
                  <BlockStack gap="300">
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
          <Box paddingBlockEnd="400">
            <div style={{
              opacity: !hasRules ? 0.6 : 1,
              transition: "opacity 0.2s ease",
              pointerEvents: !hasRules ? "none" : "auto",  // ADDED: block clicks at wrapper level too
            }}>
              <Card>
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">Storefront Control Panel</Text>
                      <Tooltip content="This is a virtual overlay. It changes what customers see on your website instantly without changing your Shopify database.">
                        <span style={{ cursor: "pointer", display: "inline-flex" }}>
                          <Icon source={InfoIcon} tone="subdued" />
                        </span>
                      </Tooltip>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">Choose when your dynamic pricing rules are active on the storefront. No permanent admin changes.</Text>
                  </BlockStack>

                  <InlineStack gap="300" blockAlign="center">
                    {/* UPDATED TASK 3: Animated live status dot replaces static Badge */}
                    <InlineStack gap="200" blockAlign="center">
                      <span
                        className={`pp-live-dot ${metrics.isLive ? "pp-live-dot--active" : "pp-live-dot--inactive"}`}
                        aria-hidden="true"
                      />
                      <Text as="span" variant="bodySm" fontWeight="semibold" tone={metrics.isLive ? "success" : "critical"}>
                        {metrics.isLive ? "Live Pricing Active" : "Live Pricing Off"}
                      </Text>
                    </InlineStack>

                    {/* UPDATED TASK 2 + 4 + 5: Show only one of Go Live / Stop Live. Guard on click. */}
                    {metrics.isLive ? (
                      // UPDATED Task 5: Stop → critical (red)
                      <Button
                        onClick={handleStopLiveClick}
                        disabled={isProcessing || !hasRules}
                        tone="critical"
                        variant="primary"
                      >
                        Stop Live Prices
                      </Button>
                    ) : (
                      // UPDATED Task 5: Go Live → success (green)
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
                </InlineStack>
              </Card>
            </div>
          </Box>

          {/* Empty products state */}
          {!loading && previews.length === 0 && (
            <Card>
              <Box padding="500">
                <BlockStack gap="300" align="center">
                  <Text as="h2" variant="headingMd">No products to polish yet</Text>
                  <Text as="p" tone="subdued">
                    We couldn't find any products that match your current rules. Try adjusting your settings or refreshing the data.
                  </Text>
                  <Button variant="primary" tone="success" onClick={handlePreview}>Refresh Now</Button>
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
            <Box paddingBlockEnd="400">
              <InlineStack align="start" gap="300">
                {/* ================= LEFT SIDE (75%) ================= */}
                <div style={{ flex: 3 }}>
                  <BlockStack gap="300">
                    {/* 🔹 1. ACTION BAR CARD */}
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack gap="300" align="start">
                          {/* Refresh is always available regardless of rules */}
                          <div style={{ pointerEvents: "auto" }}>
                            <Button
                              onClick={handlePreview}
                              loading={loading}
                              disabled={loading || isProcessing}
                            >
                              Refresh Previews
                            </Button>
                          </div>

                          {/* UPDATED TASK 1: All action buttons disabled + guarded when no rules */}
                          <>
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

                            {previews.length === 0 ? (
                              <Tooltip content="Please refresh previews to generate the latest report.">
                                <span style={{ display: 'inline-block' }}>
                                  <Button variant="secondary" disabled>Download Impact Report</Button>
                                </span>
                              </Tooltip>
                            ) : (
                              <Button variant="secondary" onClick={handleDownloadReport}>
                                Download Impact Report
                              </Button>
                            )}

                            <Button
                              variant="primary"
                              tone="success"
                              onClick={handleApplySelected}
                              disabled={!hasActivePlan || isProcessing || selectedItems.size === 0 || !hasRules}
                            >
                              {`Apply Selected (${selectedItems.size})`}
                            </Button>

                            {lastUpdate && (
                              <Button
                                variant="primary"
                                onClick={handleUndo}
                                loading={isProcessing}
                                disabled={isProcessing || !lastUpdate.batchId}
                                tone="critical"
                              >
                                Undo Last Update
                              </Button>
                            )}
                          </>
                        </InlineStack>

                        {/* Processing progress */}
                        {isProcessing && (
                          <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                            <BlockStack gap="300" align="center">
                              <InlineStack gap="300" blockAlign="center" align="center">
                                <Spinner size="small" />
                                <Text as="p" variant="bodyMd" fontWeight="bold">Processing price updates...</Text>
                              </InlineStack>
                              <Text as="p" tone="subdued" variant="bodySm">Please do not close this window or navigate away.</Text>
                              <ProgressBar progress={progress === 0 ? 10 : progress} tone="primary" />
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                    </Card>

                    {/* 🔹 2. FILTER CARD */}
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingMd">Filters & Smart Segments</Text>

                        <InlineStack gap="200">
                          <Button pressed={activeFilter === "all"} onClick={() => setActiveFilter("all")}>All</Button>
                          <Button pressed={activeFilter === "increase"} onClick={() => setActiveFilter("increase")}>Price Increase</Button>
                          <Button pressed={activeFilter === "decrease"} onClick={() => setActiveFilter("decrease")}>Price Decrease</Button>
                          <Button pressed={activeFilter === "high_impact"} onClick={() => setActiveFilter("high_impact")}>High Impact (&gt;10%)</Button>
                        </InlineStack>

                        <InlineStack gap="300" wrap={false} align="start">
                          <div style={{ flex: 1, minWidth: "180px" }}>
                            <TextField  
                              label="Search Products"
                              value={searchQuery}
                              onChange={handleSearchChange}
                              autoComplete="off"
                              placeholder="Product title..."
                              maxLength={100}
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: "180px" }}>
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
                          <div style={{ flex: 1, minWidth: "180px" }}>
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
                          <div style={{ flex: 1, minWidth: "180px" }}>
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
                      <BlockStack gap="300">
                        <InlineStack align="space-between">
                          <InlineStack gap="300" blockAlign="center">
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
                        <BlockStack gap="200">
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
                              <Box key={p.variantId} padding="300" borderBlockEndWidth="025">
                                <Box background={isManual ? "bg-surface-caution" : undefined}>
                                  <InlineStack align="space-between" blockAlign="center">
                                    <InlineStack gap="300" blockAlign="center">
                                      <Checkbox
                                        label=""
                                        labelHidden
                                        checked={isSelected}
                                        onChange={() => toggleSelection(p.variantId)}
                                      />
                                      <Thumbnail source={p.image || ""} alt={p.title} size="small" />
                                      <BlockStack gap="100">
                                        <Text as="span"  variant="bodyMd" fontWeight="bold">{p.title}</Text>
                                        <InlineStack gap="200">
                                          {isChanged ? (
                                            <Badge tone={targetPrice > currentPrice ? "success" : "attention"}>
                                              {targetPrice > currentPrice ? "Profit Optimized" : "Price Reduced"}
                                            </Badge>
                                          ) : (
                                            <Badge tone="info">No change</Badge>
                                          )}
                                          {isPolished && <Badge tone="success">Currently Polished</Badge>}
                                          {isManual && <Badge tone="attention">Manual Override</Badge>}
                                          {Math.abs(diffFromOriginal) >= 10 && <Badge tone="warning">High Impact</Badge>}
                                        </InlineStack>
                                      </BlockStack>
                                    </InlineStack>

                                    <InlineStack gap="300" blockAlign="center">
                                      <InlineStack gap="200" blockAlign="center">
                                        <BlockStack gap="0">
                                          <Text as="span"  variant="bodySm" tone="subdued">Original: {formatMoney(parseFloat(p.originalBasePrice), currencyCode)}</Text>
                                          <Text as="span"  tone="subdued" textDecorationLine={isPolished || isChanged ? "line-through" : undefined}>
                                            Current: {formatMoney(parseFloat(p.oldPrice), currencyCode)}
                                          </Text>
                                        </BlockStack>
                                        <Box width="100px">
                                          <TextField 
                                            label=""
                                            labelHidden
                                            value={p.overriddenPrice !== undefined ? p.overriddenPrice : p.newPrice}
                                            onChange={(val) => handlePriceChange(p.variantId, val)}
                                            autoComplete="off"
                                            prefix={currencySymbol}
                                            size="slim"
                                            maxLength={15}
                                          />
                                        </Box>
                                        {(isPolished || isChanged) && (
                                          <Text as="span"  tone={targetPrice > originalPrice ? "success" : "caution"} fontWeight="bold">
                                            {`${targetPrice > originalPrice ? '+' : ''}${diffFromOriginal.toFixed(1)}%`}
                                          </Text>
                                        )}
                                        {isManual && (
                                          <Button size="slim" variant="tertiary" onClick={() => resetOverride(p.variantId)}>
                                            Reset
                                          </Button>
                                        )}
                                      </InlineStack>

                                      {isChanged ? (
                                        <Button
                                          size="slim"
                                          onClick={() => handleApplySingle(p)}
                                          loading={updatingItem === p.variantId}
                                          disabled={!hasActivePlan || !!updatingItem || isProcessing || (isManual && p.overriddenPrice === "") || !hasRules}
                                          tone="success"
                                        >
                                          Apply
                                        </Button>
                                      ) : (
                                        <Tooltip content="This price is already synced with your Shopify Admin. No update needed.">
                                          <span style={{ display: 'inline-block' }}>
                                            <Button
                                              size="slim"
                                              onClick={() => handleApplySingle(p)}
                                              loading={updatingItem === p.variantId}
                                              disabled={!hasActivePlan || !!updatingItem || isProcessing || (isManual && p.overriddenPrice === "") || !hasRules}
                                            >
                                              Apply
                                            </Button>
                                          </span>
                                        </Tooltip>
                                      )}
                                    </InlineStack>
                                  </InlineStack>
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
                          <Text as="p" tone="critical">
                            🔒 Start your free trial to apply pricing changes
                          </Text>
                        )}
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </div>

                {/* ================= RIGHT SIDE (25%) ================= */}
                <div style={{ flex: 1, maxWidth: "320px", position: "sticky", top: "20px" }}>
                  <Card>
                    <BlockStack gap="200">

                      <Text as="h3" variant="headingMd">
                        Pricing Actions
                      </Text>

                      <InlineStack gap="200" blockAlign="end" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <Select
                            label="Apply pricing to"
                            options={[
                              { label: "All products", value: "all" },
                              { label: "Selected products", value: "selected" },
                              { label: "Filtered results", value: "filtered" },
                              { label: "Collection", value: "collection" }
                            ]}
                            value={applyMode}
                            onChange={(value) => setApplyMode(value as any)}
                          />
                        </div>
                        <Button
                          variant="primary"
                          tone="success"
                          loading={isProcessing}
                          disabled={
                            !hasActivePlan ||
                            isProcessing ||
                            !hasRules ||
                            (applyMode === "all" && previews.length === 0) ||
                            (applyMode === "selected" && selectedItems.size === 0)
                          }
                          onClick={() => handleApplyBatch(previews)}
                        >
                          {`Apply (${applyMode === "all"
                            ? previews.length
                            : applyMode === "selected"
                              ? selectedItems.size
                              : previews.length
                            })`}
                        </Button>
                      </InlineStack>

                      {applyMode === "selected" && (
                        <Text as="p" tone="subdued">
                          {selectedItems.size} products selected
                        </Text>
                      )}

                      {applyMode === "collection" && (
                        <TextField
                          label="Collection ID"
                          value={collectionId}
                          onChange={setCollectionId}
                          autoComplete="off"
                          helpText="Enter Shopify Collection ID"
                        />
                      )}

                      <Divider />

                      <InlineStack gap="200" blockAlign="end" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Schedule Time"
                            type="datetime-local"
                            value={scheduleTime}
                            onChange={setScheduleTime}
                            autoComplete="off"
                          />
                        </div>
                        <Button
                          onClick={async () => {
                            if (!scheduleTime) {
                              shopify.toast.show("Select time", { isError: true });
                              return;
                            }

                            await fetch("/api/schedule-pricing", {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({ runAt: scheduleTime }),
                            });

                            shopify.toast.show("Scheduled successfully");
                          }}
                        >
                          Schedule
                        </Button>
                      </InlineStack>

                    </BlockStack>
                  </Card>
                </div>
              </InlineStack>
            </Box>
          </div>

        </BlockStack>
        </div>

        {/* ── TASK 4: Confirmation Modals ── */}

        {/* Apply All confirmation modal — unchanged handler */}
        <Modal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Confirm Bulk Update"
          primaryAction={{
            content: 'Apply Changes',
            onAction: () => handleApplyBatch(previews),
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
