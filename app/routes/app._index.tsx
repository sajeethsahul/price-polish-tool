import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { useSafeAppBridge } from "../utils/useSafeAppBridge";
import { useAppFetch } from "../utils/fetch";

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
import {
  formatMoney,
  getCurrencySymbol,
  ZERO_DECIMAL_CURRENCIES,
} from "../utils/format";

// ================= CONFIG =================
const PAGE_SIZE = 15;

// ================= TYPES =================
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

interface Metrics {
  totalApplied: number;
  lastUpdate: string;
  successRate: number;
  isLive: boolean;
}

// ================= COMPONENT =================
export default function Dashboard() {
  const { currencyCode = "USD", isBypass } =
    useOutletContext<{ currencyCode?: string; isBypass?: boolean }>() || {};

  const shopify = useSafeAppBridge();
  const appFetch = useAppFetch();
  const navigate = useNavigate();

  const isFetching = useRef(false);
  const hasLoaded = useRef(false);

  // ================= STATE =================
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const [metrics, setMetrics] = useState<Metrics>({
    totalApplied: 0,
    lastUpdate: "",
    successRate: 100,
    isLive: false,
  });

  const [message, setMessage] = useState<any>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const currencySymbol = getCurrencySymbol(currencyCode);

  // ================= FETCH =================
  const handlePreview = useCallback(async () => {
    if (isFetching.current) return;
    isFetching.current = true;

    setLoading(true);
    setMessage(null);

    try {
      const [data, metricsData] = await Promise.all([
        appFetch("/api/preview-price"),
        appFetch("/api/metrics").catch(() => null),
      ]);

      setPreviews(data?.previews ?? []);
      setMetrics(metricsData ?? metrics);
    } catch (err) {
      console.error(err);
      shopify?.toast.show("Failed to load preview", { isError: true });

      setMessage({
        type: "critical",
        text: "Failed to load data",
      });
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  }, [appFetch, shopify]);

  // ================= INIT =================
  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;
    handlePreview();
  }, []);

  // ================= APPLY =================
  const handleApplySingle = useCallback(async (item: PreviewItem) => {
    setIsProcessing(true);

    try {
      await appFetch("/api/bulk-price", {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              productId: item.productId,
              variantId: item.variantId,
              newPrice: item.overriddenPrice ?? item.newPrice,
            },
          ],
        }),
      });

      shopify?.toast.show("Updated successfully");
      handlePreview();
    } catch {
      shopify?.toast.show("Failed to update", { isError: true });
    } finally {
      setIsProcessing(false);
    }
  }, [appFetch, handlePreview, shopify]);

  // ================= FILTER =================
  const filtered = useMemo(() => {
    return previews.filter((p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [previews, searchQuery]);

  // ================= PAGINATION =================
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  // ================= LOADING =================
  if (loading) {
    return (
      <Page title="Dashboard">
        <Spinner accessibilityLabel="Loading" size="large" />
      </Page>
    );
  }

  // ================= EMPTY =================
  if (previews.length === 0) {
    return (
      <Page title="Dashboard">
        <Card>
          <Text as="p">No products found</Text>
          <Button onClick={handlePreview}>Refresh</Button>
        </Card>
      </Page>
    );
  }

  // ================= MAIN =================
  return (
    <Page title="Price Polish Dashboard">
      <BlockStack gap="500">

        {/* METRICS */}
        <Grid>
          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <Text as='p'>Total Optimized</Text>
              <Text as='p' variant="headingLg">{metrics.totalApplied}</Text>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <Text as='p'>Success Rate</Text>
              <Text as='p' variant="headingLg">{metrics.successRate}%</Text>
            </Card>
          </Grid.Cell>

          <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
            <Card>
              <Text as='p'>Live Status</Text>
              <Badge tone={metrics.isLive ? "success" : "critical"}>
                {metrics.isLive ? "LIVE" : "OFF"}
              </Badge>
            </Card>
          </Grid.Cell>
        </Grid>

        {/* ACTIONS */}
        <InlineStack gap="300">
          <Button onClick={handlePreview}>Refresh</Button>
          <Button variant="primary" onClick={() => navigate("/app/rules")}>
            Rules
          </Button>
        </InlineStack>

        {/* SEARCH */}
        <TextField
          label="Search"
          value={searchQuery}
          onChange={setSearchQuery}
          autoComplete="off"
        />

        {/* LIST */}
        <BlockStack gap="200">
          {paginated.map((p) => (
            <Card key={p.variantId}>
              <InlineStack align="space-between">
                <InlineStack gap="300">
                  <Thumbnail source={p.image} alt="" />
                  <Text as='p'>{p.title}</Text>
                </InlineStack>

                <InlineStack gap="200">
                  <Text as='p'>{p.oldPrice}</Text>
                  <Text as='p'>→</Text>
                  <Text as='p'>{p.newPrice}</Text>

                  <Button
                    size="slim"
                    onClick={() => handleApplySingle(p)}
                  >
                    Apply
                  </Button>
                </InlineStack>
              </InlineStack>
            </Card>
          ))}
        </BlockStack>

        {/* PAGINATION */}
        <Pagination
          hasPrevious={currentPage > 1}
          onPrevious={() => setCurrentPage((p) => p - 1)}
          hasNext={currentPage < totalPages}
          onNext={() => setCurrentPage((p) => p + 1)}
        />

      </BlockStack>
    </Page>
  );
}