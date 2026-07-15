import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router";
import type { PricingPreviewItem } from "../types/pricing";
import { useAppFetch } from "../utils/fetch";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Page,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
} from "@shopify/polaris";

const PREVIEW_SAMPLE_SIZE = 30;

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
  const [showAll, setShowAll] = useState(false);
  const toggleButtonRef = useRef<HTMLDivElement | null>(null);

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

  // Phase 3 (UX): client-side sample display. The API response is
  // unchanged — we only slice on the client so the wizard preview stays
  // lightweight. Users can opt in to the full list via "View Full Preview".
  const totalCount = previews.length;
  const hasMoreThanSample = totalCount > PREVIEW_SAMPLE_SIZE;
  const visiblePreviews = useMemo(
    () => (showAll || !hasMoreThanSample ? previews : previews.slice(0, PREVIEW_SAMPLE_SIZE)),
    [previews, showAll, hasMoreThanSample]
  );
  const visibleCount = visiblePreviews.length;

  // Verification refinement (Phase 3): when collapsing the expanded list,
  // scroll the toggle button back into view so the merchant keeps their
  // anchor. Expanding never moves scroll; collapsing focuses the button.
  const handleTogglePreviewScope = useCallback(() => {
    setShowAll((prev) => {
      const next = !prev;
      if (prev === true) {
        // We are collapsing — restore anchor after the DOM updates.
        requestAnimationFrame(() => {
          toggleButtonRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
      }
      return next;
    });
  }, []);

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
          {isLoading ? (
            <BlockStack gap="300">
              <SkeletonDisplayText size="small" />
              <BlockStack gap="150">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Card key={`preview-skeleton-${index}`}>
                    <BlockStack gap="150">
                      <SkeletonDisplayText size="small" />
                      <SkeletonBodyText lines={1} />
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>
            </BlockStack>
          ) : previews.length === 0 ? (
            <EmptyState
              heading="No products to preview yet"
              image=""
              action={{
                content: "Adjust pricing rule",
                onAction: () =>
                  navigate(
                    isFromOnboarding
                      ? `/app/rules?from=onboarding${revisitSuffix}`
                      : "/app/rules"
                  ),
              }}
            >
              <p>
                Once you create or refine a pricing rule, we'll show a live preview of the new prices here so you can review them before applying.
              </p>
            </EmptyState>
          ) : (
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="p" tone="subdued" variant="bodySm">
                  {`Showing ${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()} product${totalCount === 1 ? "" : "s"}`}
                </Text>
                {hasMoreThanSample ? (
                  <div ref={toggleButtonRef}>
                    <Button
                      variant="plain"
                      onClick={handleTogglePreviewScope}
                      accessibilityLabel={
                        showAll
                          ? `Collapse the preview list back to the first ${PREVIEW_SAMPLE_SIZE} products`
                          : `Expand the preview to show all ${totalCount.toLocaleString()} products`
                      }
                    >
                      {showAll ? "Show fewer" : "View Full Preview"}
                    </Button>
                  </div>
                ) : null}
              </InlineStack>
              <BlockStack gap="150">
                {visiblePreviews.map((p) => (
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
            </BlockStack>
          )}
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
