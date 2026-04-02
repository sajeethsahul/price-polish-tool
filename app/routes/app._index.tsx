import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router";
import { useSafeAppBridge } from "../utils/useSafeAppBridge";

import {
  Page,
  SkeletonPage,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
} from "@shopify/polaris";

import { EmptyState } from "@shopify/polaris";
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

  const shopify = useSafeAppBridge(); // ✅ SAFE
  const appFetch = useAppFetch();
  const navigate = useNavigate();

  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<any>(null);

  // ================= FETCH =================
  const handlePreview = useCallback(async () => {
    console.log("FETCH START");
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
    } catch (e) {
      console.error(e);

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
    }
  }, [appFetch, shopify]);

  // ================= INITIAL LOAD =================
  useEffect(() => {
    handlePreview();
  }, []);

  // ================= RENDER DEBUG =================
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

      </BlockStack>
    </Page>
  );
}