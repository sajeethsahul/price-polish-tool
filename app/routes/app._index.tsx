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
import { formatMoney, getCurrencySymbol, ZERO_DECIMAL_CURRENCIES } from "../utils/format";
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
  const { currencyCode = "USD" } =
    useOutletContext<{ currencyCode?: string }>() || {};

  const shopify = useAppBridge();
  const navigate = useNavigate();
  const appFetch = useAppFetch();

  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const hasFetched = useRef(false);

  // ================= FETCH =================
  const handlePreview = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;

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
    } catch (e: any) {
      console.error(e);

      if (shopify) {
        shopify.toast.show("Failed to load data", { isError: true });
      }

      setMessage({
        type: "critical",
        text: "API failed",
      });
    } finally {
      setLoading(false);
    }
  }, [appFetch, shopify]);

  useEffect(() => {
    handlePreview();
  }, []);

  // ================= FILTER =================
  const filteredPreviews = useMemo(() => {
    return previews.filter((p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [previews, searchQuery]);

  // ================= PAGINATION =================
  const totalPages = Math.ceil(filteredPreviews.length / PAGE_SIZE);

  const paginatedPreviews = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPreviews.slice(start, start + PAGE_SIZE);
  }, [filteredPreviews, currentPage]);

  const currencySymbol = getCurrencySymbol(currencyCode);

  // ================= PRICE CHANGE =================
  const handlePriceChange = (id: string, value: string) => {
    setPreviews((prev) =>
      prev.map((p) =>
        p.variantId === id ? { ...p, overriddenPrice: value } : p
      )
    );
  };

  // ================= APPLY =================
  const handleApplySingle = async (item: PreviewItem) => {
    try {
      await appFetch("/api/bulk-price", {
        method: "POST",
        body: JSON.stringify({
          items: [
            {
              variantId: item.variantId,
              newPrice:
                item.overriddenPrice ?? item.newPrice,
            },
          ],
        }),
      });

      shopify.toast.show("Applied");
      handlePreview();
    } catch {
      shopify.toast.show("Error", { isError: true });
    }
  };

  // ================= UI =================
  if (loading) {
    return (
      <Page title="Price Polish Dashboard">
        <Text as="p">Loading...</Text>
      </Page>
    );
  }

  if (!loading && previews.length === 0) {
    return (
      <Page title="Price Polish Dashboard">
        <Banner tone="warning">No products found</Banner>
      </Page>
    );
  }

  return (
    <Page title="Price Polish Dashboard">
      <BlockStack gap="400">

        {/* SEARCH */}
        <TextField
          label="Search"
          value={searchQuery}
          onChange={setSearchQuery}
          autoComplete="off"
        />

        {/* GRID */}
        <BlockStack gap="300">
          {paginatedPreviews.map((p) => {
            const price =
              p.overriddenPrice ?? p.newPrice;

            return (
              <Card key={p.variantId}>
                <InlineStack align="space-between">
                  <InlineStack gap="300">
                    <Thumbnail source={p.image} alt="" />
                    <Text as="span">{p.title}</Text>
                  </InlineStack>

                  <InlineStack gap="300">
                    <Text as="span">
                      {p.oldPrice} → {price}
                    </Text>

                    <TextField
                      label=""
                      labelHidden
                      value={price}
                      onChange={(v) =>
                        handlePriceChange(p.variantId, v)
                      }
                      prefix={currencySymbol}
                      autoComplete="off"
                    />

                    <Button
                      onClick={() => handleApplySingle(p)}
                    >
                      Apply
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Card>
            );
          })}
        </BlockStack>

        {/* PAGINATION */}
        <Pagination
          hasPrevious={currentPage > 1}
          onPrevious={() =>
            setCurrentPage((p) => p - 1)
          }
          hasNext={currentPage < totalPages}
          onNext={() =>
            setCurrentPage((p) => p + 1)
          }
        />
      </BlockStack>
    </Page>
  );
}