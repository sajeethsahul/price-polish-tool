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
  const hasLoaded = useRef(false);

  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<any>(null);

  const handlePreview = useCallback(async () => {
    if (isFetching.current) return;

    isFetching.current = true;

    console.log("FETCH START");
    setLoading(true);
    setMessage(null);

    try {
      const data = await appFetch("/api/preview-price");

      console.log("DATA:", data);

      setPreviews(data?.previews ?? []);
    } catch (e) {
      console.error(e);

      setPreviews([]);
      setMessage({
        type: "critical",
        text: "Failed to load preview",
      });

      if (shopify) {
        shopify.toast.show("Failed to load data", { isError: true });
      }
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  }, [appFetch, shopify]);

  useEffect(() => {
    if (hasLoaded.current) return;

    hasLoaded.current = true;
    handlePreview();
  }, [handlePreview]);

  console.log("RENDER STATE:", {
    loading,
    previews: previews.length,
    hasShopify: !!shopify,
  });

  if (loading) {
    return <SkeletonPage title="Loading..." />;
  }

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

  const rows = previews.map((item) => [
    item.title,
    `${item.oldPrice} ${currencyCode}`,
    `${item.newPrice} ${currencyCode}`,
  ]);

  return (
    <Page title="Price Polish Dashboard">
      <BlockStack gap="400">
        {message && <Banner tone={message.type}>{message.text}</Banner>}

        <Card>
          <BlockStack gap="200">
            <Text as="h3">Products Preview</Text>
            <Text as="p">Total: {previews.length}</Text>

            <Button onClick={handlePreview}>Refresh</Button>
          </BlockStack>
        </Card>

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