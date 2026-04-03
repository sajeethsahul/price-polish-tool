import { useState, useEffect, useCallback } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { useSafeAppBridge } from "../utils/useSafeAppBridge";
import { useRef } from "react";

import {
  Page,
  SkeletonPage,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
  DataTable,
  EmptyState,
} from "@shopify/polaris";

import { useAppFetch } from "../utils/fetch";

interface PreviewItem {
  variantId: string;
  title: string;
  oldPrice: string;
  newPrice: string;
}

export default function Dashboard() {
  const { currencyCode = "USD", isBypass } =
    useOutletContext<{ currencyCode?: string; isBypass?: boolean }>() || {};

  const shopify = useSafeAppBridge();
  const appFetch = useAppFetch();
  const navigate = useNavigate();
  const isFetching = useRef(false);

  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<any>(null);
  const hasLoaded = useRef(false);

  // ================= FETCH =================
  const handlePreview = useCallback(async () => {
    if (isFetching.current) return; // 🔥 PREVENT DUPLICATE CALLS

    isFetching.current = true;

    console.log("FETCH START");
    setLoading(true);
    setMessage(null);

    try {
      const res = await appFetch("/api/preview-price");
      const data = await res.json();
      console.log("DATA:", data);

      setPreviews(data?.previews ?? []);
    } catch (e) {
      console.error(e);
      setPreviews([]);
    } finally {
      setLoading(false);
      isFetching.current = false; // 🔥 RELEASE LOCK
    }
  }, [appFetch]);

  // ================= INITIAL LOAD =================
  useEffect(() => {
    if (hasLoaded.current) return;

    hasLoaded.current = true;
    handlePreview();
  }, []);

  // ================= DEBUG =================
  console.log("RENDER STATE:", {
    loading,
    previews: previews.length,
    hasShopify: !!shopify,
  });

  // ================= LOADING =================
  if (loading) {
    return <SkeletonPage title="Loading..." />;
  }

  // ================= EMPTY =================
  if (!loading && previews.length === 0) {
    return (
      <EmptyState
        heading="No products found"
        action={{
          content: "Go to Rules",
          onAction: () => navigate("/app/rules"),
        }}
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>Configure pricing rules to see preview.</p>
      </EmptyState>
    );
  }

  // ================= TABLE DATA =================
  const rows = previews.map((item) => [
    item.title,
    `${item.oldPrice} ${currencyCode}`,
    `${item.newPrice} ${currencyCode}`,
  ]);

  // ================= MAIN UI =================
  return (
    <Page title="Price Polish Dashboard">
      <BlockStack gap="400">
        {message && (
          <Banner tone={message.type}>
            {message.text}
          </Banner>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h3">Products Preview</Text>
            <Text as="p">Total: {previews.length}</Text>

            <Button onClick={handlePreview}>
              Refresh
            </Button>
          </BlockStack>
        </Card>

        {/* 🔥 THIS WAS MISSING */}
        <Card>
          <DataTable
            columnContentTypes={["text", "text", "text"]}
            headings={["Product", "Old Price", "New Price"]}
            rows={rows}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}