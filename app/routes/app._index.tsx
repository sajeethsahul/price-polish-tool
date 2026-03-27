import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useNavigate } from "react-router";
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
  Grid,
} from "@shopify/polaris";

const BATCH_SIZE = 50;
const PAGE_SIZE = 15;

interface PreviewItem {
  productId: string;
  title: string;
  image: string;
  variantId: string;
  oldPrice: string;
  newPrice: string;
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
  const [loading, setLoading] = useState(false);
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
  const [firstVisit, setFirstVisit] = useState(false);
  const [metrics, setMetrics] = useState({ totalApplied: 0, lastUpdate: "", successRate: 100, isLive: false });
  
  const shopify = useAppBridge();
  const navigate = useNavigate();

  const handlePreview = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setCurrentPage(1);
    setSelectedItems(new Set());
    try {
      const res = await fetch("/api/preview-price");
      const data = await res.json();
      if (res.ok) {
        setPreviews(data.previews ?? []);
        if ((data.previews ?? []).length === 0) {
          setFirstVisit(true);
          setMessage({ type: "warning", text: "No products found or no rules configured.", details: "Please ensure you have products in your store and pricing rules are set up correctly." });
        } else {
          setFirstVisit(false);
          // Fetch metrics after preview
          const metricsRes = await fetch("/api/metrics");
          if (metricsRes.ok) {
            const metricsData = await metricsRes.json();
            setMetrics(metricsData);
          }
        }
      } else {
        throw new Error(data.error || "Failed to load preview data.");
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("An unknown error occurred.");
      console.error("Preview Error:", error);
      shopify.toast.show("Network error. Please try again.", { isError: true });
      setMessage({ type: "critical", text: "Failed to load preview data.", details: error.message });
    } finally {
      setLoading(false);
    }
  }, [shopify]);

  // Initial Load
  useEffect(() => {
    handlePreview();
  }, [handlePreview]);

  const handleApplyBatch = useCallback(async (itemsToUpdate: PreviewItem[]) => {
    setIsProcessing(true);
    setIsModalOpen(false);
    setMessage(null);
    setProgress(0);

    try {
      const res = await fetch("/api/bulk-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToUpdate }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setLastUpdate({
          batchId: data.batchId,
          updatedAt: data.updatedAt,
          successCount: data.successCount,
          failedCount: data.failedCount,
        });
        setProgress(100);

        if (data.failedCount === 0) {
          shopify.toast.show(`Successfully updated ${data.successCount} products`);
          // Update local state
          const updatedIds = new Set(itemsToUpdate.map(i => i.variantId));
          setPreviews(prev => prev.map(p => updatedIds.has(p.variantId) ? { ...p, oldPrice: p.newPrice } : p));
          setSelectedItems(new Set());
        } else {
          shopify.toast.show("Some products failed to update", { isError: true });
        }
      } else {
        throw new Error(data.error || "Failed to apply prices.");
      }
    } catch (err) {
      shopify.toast.show("System error during update", { isError: true });
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  }, [shopify]);

  const handleApplySingle = useCallback((item: PreviewItem) => {
    handleApplyBatch([item]);
  }, [handleApplyBatch]);

  const handleApplySelected = useCallback(() => {
    const itemsToUpdate = previews.filter(p => selectedItems.has(p.variantId));
    handleApplyBatch(itemsToUpdate);
  }, [previews, selectedItems, handleApplyBatch]);

  const handleUndo = useCallback(async () => {
    if (!lastUpdate?.batchId) return;
    setIsProcessing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/undo-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: lastUpdate.batchId }),
      });
      const data = await res.json();
      if (res.ok) {
        setLastUpdate(null);
        shopify.toast.show(`Restored ${data.restoredCount} products`);
        setPreviews([]);
        setSelectedItems(new Set());
      } else {
        throw new Error(data.error || "Failed to undo changes.");
      }
    } catch (err) {
      shopify.toast.show("Failed to undo changes", { isError: true });
    } finally {
      setIsProcessing(false);
    }
  }, [lastUpdate, shopify]);

  const handlePushStorefront = useCallback(async (clear = false) => {
    setIsProcessing(true);
    setShowGoLiveModal(false);
    setShowStopModal(false);
    try {
      const res = await fetch("/api/push-storefront", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear })
      });
      const data = await res.json();
      if (res.ok) {
        shopify.toast.show(clear ? "Storefront prices restored successfully" : "Prices are now live on your storefront");
        setMetrics(prev => ({ ...prev, isLive: !clear }));
      } else {
        throw new Error(data.error || "Failed to push rules.");
      }
    } catch (err) {
      shopify.toast.show("Failed to update storefront", { isError: true });
    } finally {
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
      const newP = parseFloat(p.newPrice);
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

  // Filtering Logic
  const filteredPreviews = useMemo(() => {
    return previews.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase());
      const price = parseFloat(p.newPrice);
      const matchesMin = minPrice === "" || price >= parseFloat(minPrice);
      const matchesMax = maxPrice === "" || price <= parseFloat(maxPrice);
      
      const oldP = parseFloat(p.oldPrice);
      const newP = parseFloat(p.newPrice);
      const diffPercent = oldP !== 0 ? ((newP - oldP) / oldP) * 100 : 0;

      let matchesSmartFilter = true;
      if (activeFilter === "increase") matchesSmartFilter = newP > oldP;
      else if (activeFilter === "decrease") matchesSmartFilter = newP < oldP;
      else if (activeFilter === "high_impact") matchesSmartFilter = Math.abs(diffPercent) >= 10;

      return matchesSearch && matchesMin && matchesMax && matchesSmartFilter;
    });
  }, [previews, searchQuery, minPrice, maxPrice, activeFilter]);

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
                    {`+$${insights.lift.toFixed(2)}`}
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
                  disabled={isProcessing || previews.length === 0}
                >
                  Go Live on Storefront
                </Button>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Card>

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
                      onChange={setSearchQuery}
                      autoComplete="off"
                      placeholder="Product title..."
                    />
                  </Box>
                  <Box width="150px">
                    <TextField
                      label="Min Price"
                      type="number"
                      value={minPrice}
                      onChange={setMinPrice}
                      autoComplete="off"
                      prefix="$"
                    />
                  </Box>
                  <Box width="150px">
                    <TextField
                      label="Max Price"
                      type="number"
                      value={maxPrice}
                      onChange={setMaxPrice}
                      autoComplete="off"
                      prefix="$"
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
                    const oldP = parseFloat(p.oldPrice);
                    const newP = parseFloat(p.newPrice);
                    const diff = oldP !== 0 ? ((newP - oldP) / oldP) * 100 : 0;
                    const isChanged = oldP !== newP;
                    const isSelected = selectedItems.has(p.variantId);
                    
                    return (
                      <Card key={p.variantId} padding="300">
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
                                  <Badge tone={newP > oldP ? "success" : "attention"}>
                                    {newP > oldP ? "Profit Optimized" : "Price Reduced"}
                                  </Badge>
                                ) : (
                                  <Badge tone="info">No change</Badge>
                                )}
                                {Math.abs(diff) >= 10 && <Badge tone="warning">High Impact</Badge>}
                              </InlineStack>
                            </BlockStack>
                          </InlineStack>

                          <InlineStack gap="400" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" tone="subdued" textDecorationLine={isChanged ? "line-through" : undefined}>
                                {`$${p.oldPrice}`}
                              </Text>
                              {isChanged && (
                                <>
                                  <Badge tone={newP > oldP ? "success" : "attention"}>{`$${p.newPrice}`}</Badge>
                                  <Text as="span" tone={newP > oldP ? "success" : "caution"} fontWeight="bold">
                                    {`${newP > oldP ? '+' : ''}${diff.toFixed(1)}%`}
                                  </Text>
                                </>
                              )}
                            </InlineStack>
                            
                            <Button 
                              size="slim" 
                              onClick={() => handleApplySingle(p)}
                              loading={updatingItem === p.variantId}
                              disabled={!isChanged || !!updatingItem || isProcessing}
                              tone={isChanged ? "success" : undefined}
                            >
                              Apply
                            </Button>
                          </InlineStack>
                        </InlineStack>
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
