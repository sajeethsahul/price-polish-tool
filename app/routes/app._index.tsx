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
  const { currencyCode = "USD" } =
    useOutletContext<{ currencyCode?: string }>() || {};

  const shopify = useSafeAppBridge();
  const appFetch = useAppFetch();
  const navigate = useNavigate();

  const isFetching = useRef(false);
  const hasLoaded = useRef(false);

  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  const handlePreview = useCallback(async () => {
    if (isFetching.current) return;

    isFetching.current = true;
    setLoading(true);

    try {
      const data = await appFetch("/api/preview-price");

      setPreviews(data?.previews ?? []);
    } catch (e) {
      console.error(e);

      if (shopify) {
        shopify.toast.show("Failed to load preview", { isError: true });
      }

      setPreviews([]);
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

  if (loading) {
    return <SkeletonPage title="Price Polish Dashboard" />;
  }

  if (previews.length === 0) {
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

  return (
    <Page title="Price Polish Dashboard">
      <BlockStack gap="400">
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
            rows={previews.map((p) => [
              p.title,
              `${p.oldPrice} ${currencyCode}`,
              `${p.newPrice} ${currencyCode}`,
            ])}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}