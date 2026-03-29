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
} from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";
import { formatMoney, getCurrencySymbol, ZERO_DECIMAL_CURRENCIES } from "../utils/format";

const BATCH_SIZE = 50;
const PAGE_SIZE = 15;

interface PreviewItem {
  productId: string;
  title: string;
  image: string;
  variantId: string;
  oldPrice: string; // This is the current price in Shopify
  newPrice: string; // This is the rule-calculated price
  originalBasePrice: string; // NEW: The true original price before any polish
  overriddenPrice?: string;
}

interface LastUpdateInfo {
  batchId: string;
  updatedAt: string;
  successCount: number;
  failedCount: number;
}

export default function Dashboard() {
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<LastUpdateInfo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
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
  const [metrics, setMetrics] = useState({ totalApplied: 0, lastUpdate: "", successRate: 100, isLive: false });
  
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const { currencyCode = "USD" } = useOutletContext<{ currencyCode?: string }>() || {};
  const currencySymbol = getCurrencySymbol(currencyCode);

  const handlePreview = useCallback(async () => {
    console.log("DEBUG: Initializing handlePreview fetch...");
    setLoading(true);
    setMessage(null);
    setCurrentPage(1);
    setSelectedItems(new Set());
    
    // Safety check for origin
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    
    try {
      const res = await fetch(origin + "/api/preview-price");
      console.log(`DEBUG: /api/preview-price status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/preview-price data received:", !!data);
      
      if (res.ok) {
        console.log(`DEBUG: Previews received. Length: ${data.previews?.length ?? 0}`);
        setPreviews(data.previews ?? []);
        setActiveMarkup(data.markupPercent ?? 0);
        
        if ((data.previews ?? []).length === 0) {
          setFirstVisit(true);
          setMessage({ 
            type: "warning", 
            text: "No products found or no rules configured.", 
            details: "Please ensure you have products in your store and pricing rules are set up correctly." 
          });
        } else {
          setFirstVisit(false);
          // Fetch metrics after preview
          const metricsRes = await fetch(origin + "/api/metrics");
          console.log(`DEBUG: /api/metrics status: ${metricsRes.status}`);
          
          if (metricsRes.ok) {
            const metricsData = await metricsRes.json();
            console.log("DEBUG: Metrics data received:", !!metricsData);
            setMetrics(metricsData);
          }
        }
      } else {
        throw new Error(data.error || "Failed to load preview data.");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("An unknown error occurred.");
      console.error("DEBUG: Preview Error detail:", error);
      shopify.toast.show("Network error. Please try again.", { isError: true });
      setMessage({ type: "critical", text: "Failed to load preview data.", details: error.message });
    } finally {
      console.log("DEBUG: Finalizing handlePreview loading state.");
      setLoading(false);
    }
  }, [shopify]);

  // Initial Load
  useEffect(() => {
    handlePreview();
  }, [handlePreview]);

  const handleApplyBatch = useCallback(async (itemsToUpdate: PreviewItem[]) => {
    console.log(`DEBUG: Initializing handleApplyBatch for ${itemsToUpdate.length} items...`);
    setIsProcessing(true);
    setIsModalOpen(false);
    setMessage(null);
    setProgress(0);

    const itemsWithFinalPrices = itemsToUpdate.map(item => ({
      variantId: item.variantId,
      oldPrice: item.oldPrice,
      newPrice: item.overriddenPrice !== undefined ? item.overriddenPrice : item.newPrice,
      isManual: item.overriddenPrice !== undefined // Send flag to backend
    }));

    // Safety check for origin
    const origin = typeof window !== "undefined" ? window.location.origin : "";

    try {
      const res = await fetch(origin + "/api/bulk-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsWithFinalPrices }),
      });
      
      console.log(`DEBUG: /api/bulk-price status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/bulk-price data received:", !!data);
      
      if (res.ok) {
        setLastUpdate({
          batchId: data.batchId,
          updatedAt: data.updatedAt,
          successCount: data.successCount,
          failedCount: data.failedCount,
        });
        setProgress(100);

        if (data.failedCount === 0) {
          shopify.toast.show("Applied successfully! Remember to 'Go Live' to see changes on your storefront.");
          handlePreview(); // Auto-refresh the list
          setSelectedItems(new Set());
        } else {
          shopify.toast.show("Some products failed to update", { isError: true });
        }
      } else {
        throw new Error(data.error || "Failed to apply prices.");
      }
    } catch (err) {
      console.error("DEBUG: ApplyBatch Error detail:", err);
      shopify.toast.show("System error during update", { isError: true });
    } finally {
      console.log("DEBUG: Finalizing handleApplyBatch processing state.");
      setIsProcessing(false);
      setProgress(0);
    }
  }, [shopify, handlePreview]);

  const handleApplySingle = useCallback((item: PreviewItem) => {
    handleApplyBatch([item]);
  }, [handleApplyBatch]);

  const handleApplySelected = useCallback(() => {
    const itemsToUpdate = previews.filter(p => selectedItems.has(p.variantId));
    handleApplyBatch(itemsToUpdate);
  }, [previews, selectedItems, handleApplyBatch]);

  const handleUndo = useCallback(async () => {
    if (!lastUpdate?.batchId) return;
    console.log(`DEBUG: Initializing handleUndo for batch: ${lastUpdate.batchId}...`);
    setIsProcessing(true);
    setMessage(null);
    
    // Safety check for origin
    const origin = typeof window !== "undefined" ? window.location.origin : "";

    try {
      const res = await fetch(origin + "/api/undo-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: lastUpdate.batchId }),
      });
      
      console.log(`DEBUG: /api/undo-price status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/undo-price data received:", !!data);

      if (res.ok) {
        setLastUpdate(null);
        shopify.toast.show(`Restored ${data.restoredCount} products`);
        handlePreview(); // Auto-refresh the list
        setSelectedItems(new Set());
      } else {
        throw new Error(data.error || "Failed to undo changes.");
      }
    } catch (err) {
      console.error("DEBUG: Undo Error detail:", err);
      shopify.toast.show("Failed to undo changes", { isError: true });
    } finally {
      console.log("DEBUG: Finalizing handleUndo processing state.");
      setIsProcessing(false);
    }
  }, [lastUpdate, shopify, handlePreview]);

  const handlePriceChange = useCallback((variantId: string, value: string) => {
    // Prevent typing excessively long strings
    if (value.length > 15) return;
    // Max 6 numbers before decimal, max 2 decimals
    if (value !== "" && !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;
    
    setPreviews((prev) =>
      prev.map((item) =>
        item.variantId === variantId
          ? {
              ...item,
              overriddenPrice: value
            }
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
          ? {
              ...item,
              overriddenPrice: undefined
            }
          : item
      )
    );
  }, []);

  const handlePushStorefront = useCallback(async (clear = false) => {
    console.log(`DEBUG: Initializing handlePushStorefront (clear=${clear})...`);
    setIsProcessing(true);
    setShowGoLiveModal(false);
    setShowStopModal(false);

    // Safety check for origin
    const origin = typeof window !== "undefined" ? window.location.origin : "";

    try {
      const res = await fetch(origin + "/api/push-storefront", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear })
      });
      
      console.log(`DEBUG: /api/push-storefront status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/push-storefront data received:", !!data);

      if (res.ok) {
        shopify.toast.show(clear ? "Storefront prices restored successfully" : "Prices are now live on your storefront");
        setMetrics(prev => ({ ...prev, isLive: !clear }));
      } else {
        throw new Error(data.error || "Failed to push rules.");
      }
    } catch (err) {
      console.error("DEBUG: PushStorefront Error detail:", err);
      shopify.toast.show("Failed to update storefront", { isError: true });
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

  // Advanced SaaS Analytics
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

  // Filtering & Sorting Logic
  const filteredPreviews = useMemo(() => {
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

    // Apply Sorting
    result.sort((a, b) => {
      const oldA = parseFloat(a.oldPrice);
      const newA = a.overriddenPrice !== undefined ? parseFloat(a.overriddenPrice) || 0 : parseFloat(a.newPrice);
      const diffA = oldA !== 0 ? ((newA - oldA) / oldA) * 100 : 0;

      const oldB = parseFloat(b.oldPrice);
      const newB = b.overriddenPrice !== undefined ? parseFloat(b.overriddenPrice) || 0 : parseFloat(b.newPrice);
      const diffB = oldB !== 0 ? ((newB - oldB) / oldB) * 100 : 0;

      switch (sortOrder) {
        case "name_asc":
          return a.title.localeCompare(b.title);
        case "name_desc":
          return b.title.localeCompare(a.title);
        case "price_asc":
          return newA - newB;
        case "price_desc":
          return newB - newA;
        case "change_asc":
          return diffA - diffB;
        case "change_desc":
          return diffB - diffA;
        default:
          return 0;
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

  // Pagination Logic
  const totalPages = Math.ceil(filteredPreviews.length / PAGE_SIZE);
  const paginatedPreviews = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPreviews.slice(start, start + PAGE_SIZE);
  }, [filteredPreviews, currentPage]);

  const totalBatches = useMemo(() => Math.ceil(previews.length / BATCH_SIZE), [previews]);

  const timeAgo = (dateStr: string) => {
    const seconds = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  return (
    <Page 
      title="Price Polish Dashboard"
      secondaryActions={[
        {
          content: 'Help Guide',
          onAction: () => navigate("/app/help"),
        },
      ]}
    >
      <BlockStack gap="500">
        {firstVisit && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Welcome to Price Polish! 🚀</Text>
              <Text as="p">Follow these simple steps to optimize your store pricing:</Text>
              <Box paddingInlineStart="400">
                <BlockStack gap="200">
                  <Text as="p">1️⃣ <strong>Configure:</strong> Set your markup and rounding rules in the <Button variant="tertiary" url="/app/rules">Rules</Button> page.</Text>
                  <Text as="p">2️⃣ <strong>Preview:</strong> Come back here to see how your new prices will look.</Text>
                  <Text as="p">3️⃣ <strong>Apply:</strong> Review the changes and apply them safely (you can undo anytime).</Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        )}

        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p">✔️ Safe to use — all changes can be undone anytime</Text>
            <Text as="p">✔️ Your original prices are preserved and stored securely</Text>
            <Text as="p">💡 <strong>Tip:</strong> The "Apply" button becomes disabled once your price is perfectly synced with your current Pricing Rules. Change your rules to reactivate it!</Text>
          </BlockStack>
        </Banner>

        {metrics.isLive && (
          <Banner tone="warning">
            <BlockStack gap="200">
              <Text as="p">⚠️ <strong>Live Pricing is ON:</strong> Any prices you "Apply" here will permanently change your Shopify database. Because your Live Rules are active, the storefront extension will apply its rules <strong>on top</strong> of these new prices. If you want the "Applied" price to be the final price, please stop Live Pricing or adjust your rules.</Text>
            </BlockStack>
          </Banner>
        )}

        {message && (
          <Banner
            title={message.text}
            tone={message.type}
            onDismiss={() => setMessage(null)}
          >
            {message.details && <p>{message.details}</p>}
          </Banner>
        )}

        {/* SAAS INSIGHT CARD */}
        {previews.length > 0 && !loading && (
          <Grid>
            <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
              <Card>
                <BlockStack gap="100" align="center">
                  <Text as="p" variant="bodySm" tone="subdued">Potential Revenue Lift</Text>
                  <Text as="h2" variant="headingLg" tone="success">
                    {`+${formatMoney(previews.reduce((sum, p) => sum + ((parseFloat(p.overriddenPrice || p.newPrice)) - parseFloat(p.originalBasePrice)), 0), currencyCode)}`}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
              <Card>
                <BlockStack gap="100" align="center">
                  <Text as="p" variant="bodySm" tone="subdued">Success Rate (%)</Text>
                  <Text as="h2" variant="headingLg" tone={metrics.successRate > 90 ? "success" : "caution"}>
                    {`${metrics.successRate.toFixed(1)}%`}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
              <Card>
                <BlockStack gap="100" align="center">
                  <Text as="p" variant="bodySm" tone="subdued">Total Optimizations</Text>
                  <Text as="h2" variant="headingLg">
                    {metrics.totalApplied}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
            <Grid.Cell columnSpan={{xs: 6, sm: 3, md: 3, lg: 3, xl: 3}}>
              <Card>
                <BlockStack gap="100" align="center">
                  <Text as="p" variant="bodySm" tone="subdued">Last Update</Text>
                  <Text as="h2" variant="headingLg" tone="subdued">
                    {metrics.lastUpdate ? timeAgo(metrics.lastUpdate) : "Never"}
                  </Text>
                </BlockStack>
              </Card>
            </Grid.Cell>
          </Grid>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h3" variant="headingMd">Storefront Control Panel</Text>
                  <Tooltip content="This is a virtual overlay. It changes what customers see on your website instantly without changing your Shopify database.">
                    <span style={{ cursor: "pointer", display: "inline-flex" }}>
                      <Icon source={InfoIcon} tone="subdued" />
                    </span>
                  </Tooltip>
                  {metrics.isLive ? (
                    <Badge tone="success">Live Pricing: ON</Badge>
                  ) : (
                    <Badge tone="critical">Live Pricing: OFF</Badge>
                  )}
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">Choose when your dynamic pricing rules are active on the storefront. No permanent admin changes.</Text>
              </BlockStack>
              <InlineStack gap="300">
                <Button
                  onClick={() => setShowStopModal(true)}
                  disabled={isProcessing || !metrics.isLive}
                  tone="critical"
                  variant="secondary"
                >
                  Stop Live Prices
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setShowGoLiveModal(true)}
                  loading={isProcessing}
                  disabled={isProcessing}
                >
                  Go Live on Storefront
                </Button>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>

        {!loading && previews.length === 0 && (
          <Card>
            <Box padding="500">
              <BlockStack gap="400" align="center">
                <Text as="h2" variant="headingMd">No products to polish yet</Text>
                <Text as="p" tone="subdued">
                  We couldn't find any products that match your current rules. Try adjusting your settings or refreshing the data.
                </Text>
                <Button variant="primary" onClick={handlePreview}>Refresh Now</Button>
              </BlockStack>
            </Box>
          </Card>
        )}

        <Card>
          <BlockStack gap="400">
            <InlineStack gap="300" align="start">
              <Button
                variant="primary"
                onClick={handlePreview}
                loading={loading}
                disabled={loading || isProcessing}
              >
                Refresh Previews
              </Button>
              <Button
                onClick={() => setIsModalOpen(true)}
                disabled={isProcessing || previews.length === 0}
                tone="success"
              >
                {`Apply All (${previews.length})`}
              </Button>
              {previews.length === 0 ? (
                <Tooltip content="Please refresh previews to generate the latest report.">
                   <span style={{ display: 'inline-block' }}>
                     <Button disabled>Download Impact Report</Button>
                   </span>
                </Tooltip>
              ) : (
                <Button onClick={handleDownloadReport} variant="secondary">
                  Download Impact Report
                </Button>
              )}
              <Button
                onClick={handleApplySelected}
                disabled={isProcessing || selectedItems.size === 0}
                variant="secondary"
              >
                {`Apply Selected (${selectedItems.size})`}
              </Button>
              {lastUpdate && (
                <Button
                  onClick={handleUndo}
                  loading={isProcessing}
                  disabled={isProcessing || !lastUpdate.batchId}
                  tone="critical"
                >
                  Undo Last Update
                </Button>
              )}
            </InlineStack>

            {isProcessing && (
              <BlockStack gap="200">
                <Text as="p">Processing price updates... Please do not close the window.</Text>
                <ProgressBar progress={progress === 0 ? 10 : progress} animated />
              </BlockStack>
            )}

            {previews.length > 0 && !loading && !isProcessing && (
              <BlockStack gap="400">
                <Divider />
                <Text as="h3" variant="headingMd">Filters & Smart Segments</Text>
                
                <InlineStack gap="200">
                  <Button pressed={activeFilter === "all"} onClick={() => setActiveFilter("all")}>All</Button>
                  <Button pressed={activeFilter === "increase"} onClick={() => setActiveFilter("increase")}>Price Increase</Button>
                  <Button pressed={activeFilter === "decrease"} onClick={() => setActiveFilter("decrease")}>Price Decrease</Button>
                  <Button pressed={activeFilter === "high_impact"} onClick={() => setActiveFilter("high_impact")}>High Impact (&gt;10%)</Button>
                </InlineStack>

                <InlineStack gap="400" align="start">
                  <Box width="300px">
                    <TextField
                      label="Search Products"
                      value={searchQuery}
                      onChange={handleSearchChange}
                      autoComplete="off"
                      placeholder="Product title..."
                      maxLength={100}
                    />
                  </Box>
                  <Box width="200px">
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
                  </Box>
                  <Box width="150px">
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
                  </Box>
                  <Box width="150px">
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
                  </Box>
                </InlineStack>

                <Divider />
                
                <InlineStack align="space-between">
                  <InlineStack gap="300">
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
                      <Card key={p.variantId} padding="300">
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
                                <Text as="span" variant="bodyMd" fontWeight="bold">
                                  {p.title}
                                </Text>
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

                            <InlineStack gap="400" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <BlockStack gap="0">
                                  <Text as="span" variant="bodySm" tone="subdued">Original: {formatMoney(parseFloat(p.originalBasePrice), currencyCode)}</Text>
                                  <Text as="span" tone="subdued" textDecorationLine={isPolished || isChanged ? "line-through" : undefined}>
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
                                  <Text as="span" tone={targetPrice > originalPrice ? "success" : "caution"} fontWeight="bold">
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
                                  disabled={!!updatingItem || isProcessing || (isManual && p.overriddenPrice === "")}
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
                                      disabled={!!updatingItem || isProcessing || (isManual && p.overriddenPrice === "")}
                                    >
                                      Apply
                                    </Button>
                                  </span>
                                </Tooltip>
                              )}
                            </InlineStack>
                          </InlineStack>
                        </Box>
                      </Card>
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
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

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
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setIsModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            You are about to update prices for <strong>{previews.length}</strong> products.
            This action can be undone later using the "Undo Last Update" button.
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={showGoLiveModal}
        onClose={() => setShowGoLiveModal(false)}
        title="Confirm Go Live"
        primaryAction={{
          content: 'Go Live',
          onAction: () => handlePushStorefront(false),
          loading: isProcessing,
          disabled: isProcessing
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowGoLiveModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">You are about to apply pricing rules to your live store.</Text>
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

      <Modal
        open={showStopModal}
        onClose={() => setShowStopModal(false)}
        title="Confirm Stop Live Prices"
        primaryAction={{
          content: 'Stop Live',
          onAction: () => handlePushStorefront(true),
          loading: isProcessing,
          disabled: isProcessing,
          destructive: true
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowStopModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">Are you sure you want to restore original prices?</Text>
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
  );
}
