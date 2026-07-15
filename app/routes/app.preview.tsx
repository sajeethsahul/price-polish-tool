import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router";
import type { PricingPreviewItem } from "../types/pricing";
import { useAppFetch } from "../utils/fetch";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";

export default function PreviewPage() {
  const navigate = useNavigate();
  const { currencyCode } = useOutletContext<{ currencyCode: string }>();
  const appFetch = useAppFetch();
  const [searchParams] = useSearchParams();
  const isFromOnboarding = searchParams.get("from") === "onboarding";
  const isRevisit = searchParams.get("revisit") === "1";
  const revisitSuffix = isRevisit ? "&revisit=1" : "";

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<PricingPreviewItem[]>([]);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await appFetch("/api/preview-price");
        if (!active) return;
        setPreviews(Array.isArray(data?.previews) ? (data.previews as PricingPreviewItem[]) : []);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!active) return;
        setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [appFetch]);

  // Phase 2 (UX): when arriving from the onboarding wizard, hide the tiny
  // Polaris backAction chevron (which merchants mis-read as "Previous Step")
  // in favour of explicit navigation buttons rendered in the page body.
  // Direct navigation (not from onboarding) keeps a clear "Back to dashboard"
  // action to avoid dropping merchants onto the confusing "Back to onboarding"
  // label that shipped before Phase 2.
  const backActionProps = isFromOnboarding
    ? undefined
    : {
        content: "Back to dashboard",
        onAction: () => navigate("/app"),
      };

  return (
    <Page
      title="Product Previews"
      subtitle={`Currency: ${currencyCode}`}
      backAction={backActionProps}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Unable to load previews">
            <p>{error}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            {isLoading ? (
              <InlineStack align="center">
                <Spinner accessibilityLabel="Loading product previews" />
              </InlineStack>
            ) : previews.length === 0 ? (
              <BlockStack gap="100" align="center">
                <Text as="h2" variant="headingMd">
                  No preview products yet
                </Text>
                <Text as="p" tone="subdued" alignment="center">
                  Create a pricing rule, then refresh previews to see proposed pricing updates.
                </Text>
              </BlockStack>
            ) : (
              <BlockStack gap="200">
                <Text as="p" tone="subdued">
                  Showing {previews.length} preview items.
                </Text>
                <BlockStack gap="150">
                  {previews.slice(0, 30).map((p) => (
                    <Card key={String(p.variantId)}>
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd">
                          {p.title}
                        </Text>
                        <Text as="p" tone="subdued">
                          Old: {p.oldPrice} → New: {p.newPrice}
                        </Text>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
                {previews.length > 30 ? (
                  <Text as="p" tone="subdued">
                    Showing first 30 items.
                  </Text>
                ) : null}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {isFromOnboarding ? (
          <InlineStack align="space-between" gap="200" wrap>
            <Button
              onClick={() =>
                navigate(`/app/welcome?step=create-rule${revisitSuffix}`)
              }
              accessibilityLabel="Return to Step 1: Create Pricing Rule"
            >
              ← Previous Step
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                navigate(`/app/welcome?step=apply-update${revisitSuffix}`)
              }
              accessibilityLabel="Continue to Step 3: Apply Pricing"
            >
              Continue →
            </Button>
          </InlineStack>
        ) : null}
      </BlockStack>
    </Page>
  );
}
