import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
import { formatMoney, getCurrencySymbol } from "../utils/format";
import { useAppFetch } from "../utils/fetch";

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

export default function Dashboard() {
  const { currencyCode = "USD", isBypass } =
    useOutletContext<{ currencyCode?: string; isBypass?: boolean }>() || {};

  if (isBypass) {
    return <DashboardContent currencyCode={currencyCode} />;
  }

  return <DashboardWithBridge currencyCode={currencyCode} />;
}

function DashboardWithBridge({ currencyCode }: { currencyCode: string }) {
  const shopify = useAppBridge();
  return <DashboardContent shopify={shopify} currencyCode={currencyCode} />;
}

function DashboardContent({
  shopify,
  currencyCode,
}: {
  shopify?: any;
  currencyCode: string;
}) {
  const navigate = useNavigate();
  const appFetch = useAppFetch();
  const currencySymbol = getCurrencySymbol(currencyCode);

  const isFetching = useRef(false);
  const hasLoaded = useRef(false);

  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<any>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // ================= FETCH =================
  const handlePreview = useCallback(async () => {
    if (isFetching.current) return;

    isFetching.current = true;
    setLoading(true);
    setMessage(null);

    try {
      const data = await appFetch("/api/preview-price");

      console.log("DATA:", data);

      setPreviews(data?.previews ?? []);

      if ((data?.previews ?? []).length === 0) {
        setMessage({
          type: "warning",
          text: "No products found",
        });
      }
    } catch (err) {
      console.error(err);

      if (shopify) {
        shopify.toast.show("Failed to load data", { isError: true });
      }

      setPreviews([]);
      setMessage({
        type: "critical",
        text: "API failed",
      });
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  }, [appFetch, shopify]);

  // ================= INITIAL LOAD =================
  useEffect(() => {
    if (hasLoaded.current) return;

    hasLoaded.current = true;
    handlePreview();
  }, [handlePreview]);

  // ================= FILTER =================
  const filteredPreviews = useMemo(() => {
    return previews.filter((p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [previews, searchQuery]);

  // ================= PAGINATION =================
  const totalPages = Math.ceil(filteredPreviews.length / PAGE_SIZE);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPreviews.slice(start, start + PAGE_SIZE);
  }, [filteredPreviews, currentPage]);

  // ================= LOADING =================
  if (loading) {
    return <Page title="Loading..." />;
  }

  // ================= EMPTY =================
  if (!loading && previews.length === 0) {
    return (
      <Page title="Price Polish Dashboard">
        <Card>
          <BlockStack gap="400" align="center">
            <Text as="h2">No products found</Text>
            <Button onClick={() => navigate("/app/rules")}>
              Go to Rules
            </Button>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  // ================= MAIN =================
  return (
    <Page title="Price Polish Dashboard">
      <BlockStack gap="400">

        {message && (
          <Banner tone={message.type}>
            {message.text}
          </Banner>
        )}

        {/* SEARCH */}
        <Card>
          <TextField
            label="Search"
            value={searchQuery}
            onChange={setSearchQuery}
            autoComplete="off"
          />
        </Card>

        {/* HEADER */}
        <Card>
          <InlineStack align="space-between">
            <Text as="h3">Products ({filteredPreviews.length})</Text>

            <Button onClick={handlePreview}>
              Refresh
            </Button>
          </InlineStack>
        </Card>

        {/* LIST */}
        <BlockStack gap="200">
          {paginated.map((p) => {
            const newPrice = p.overriddenPrice ?? p.newPrice;

            return (
              <Card key={p.variantId}>
                <InlineStack align="space-between" blockAlign="center">

                  <InlineStack gap="300" blockAlign="center">
                    <Thumbnail source={p.image} alt={p.title} />
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="bold">
                        {p.title}
                      </Text>

                      <Text as="span">
                        {p.oldPrice} → {newPrice} {currencyCode}
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <Badge tone="success">Preview</Badge>

                </InlineStack>
              </Card>
            );
          })}
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