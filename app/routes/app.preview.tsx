import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router";
import type { PricingPreviewItem } from "../types/pricing";
import { useAppFetch } from "../utils/fetch";
import { t } from "../utils/i18n";
import { parseShopifyPrice } from "../utils/price-utils";
import { formatMoney } from "../utils/format";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Page,
  Pagination,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  TextField,
} from "@shopify/polaris";

const PREVIEW_SAMPLE_SIZE = 30;

type PriceMovement = {
  oldPrice: number;
  livePrice: number;
  newPrice: number;
  delta: number;
  deltaPercent: string;
  isIncrease: boolean;
  isDecrease: boolean;
  isUnchanged: boolean;
};

function getPriceMovement(p: PricingPreviewItem): PriceMovement {
  // % change is relative to the Original Catalog price (originalBasePrice) —
  // the same baseline the New Preview is derived from (Catalog + adjustment,
  // rounded). Live Storefront price is NOT used as the denominator: it can be
  // stale, discounted, or out of sync with the rule math (e.g. gift cards),
  // which would produce alarming/incorrect percentages.
  // The card's "Current" value shows the Original Catalog baseline, with the
  // live price surfaced separately (subdued "Live: ₹X") when it has drifted.
  const originalPrice = parseShopifyPrice(
    p.originalBasePrice ?? p.oldPrice,
  );
  const livePrice = parseShopifyPrice(p.oldPrice);
  const proposedRaw =
    p.overriddenPrice !== undefined ? p.overriddenPrice : p.newPrice;
  const newPrice = parseShopifyPrice(proposedRaw);

  // Mirror the dashboard's guard: skip items with invalid prices instead of
  // treating them as increases/decreases.
  if (
    !Number.isFinite(originalPrice) ||
    !Number.isFinite(newPrice) ||
    originalPrice <= 0
  ) {
    return {
      oldPrice: originalPrice,
      livePrice,
      newPrice,
      delta: 0,
      deltaPercent: "0",
      isIncrease: false,
      isDecrease: false,
      isUnchanged: true,
    };
  }

  const delta = newPrice - originalPrice;
  const deltaPercent = ((delta / originalPrice) * 100).toFixed(1);
  return {
    oldPrice: originalPrice,
    livePrice,
    newPrice,
    delta,
    deltaPercent,
    isIncrease: delta > 0,
    isDecrease: delta < 0,
    isUnchanged: delta === 0,
  };
}

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
  // Live Pricing status — not available from the outlet context, so we fetch
  // it from /api/metrics (same source the dashboard uses). Defaults to false.
  const [isLive, setIsLive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 10;

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const locale =
          typeof window !== "undefined" ? (window as any).__LOCALE__ ?? "" : "";
        const [data, metricsData] = await Promise.all([
          appFetch("/api/preview-price"),
          appFetch(`/api/metrics?locale=${encodeURIComponent(locale)}`).catch(
            () => null,
          ),
        ]);
        if (!active) return;
        setIsLive((metricsData as any)?.isLive === true);
        setPreviews(
          Array.isArray(data?.previews)
            ? (data.previews as PricingPreviewItem[])
            : [],
        );
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

  // Client-side filtering + pagination. The API response is unchanged —
  // we only filter/slice on the client so the preview stays lightweight.
  const totalCount = previews.length;

  // Movement counts over the full preview set — used for the filter chip labels.
  const { increaseCount, decreaseCount, unchangedCount } = useMemo(() => {
    let increaseCount = 0;
    let decreaseCount = 0;
    let unchangedCount = 0;
    for (const p of previews) {
      const { isIncrease, isDecrease, isUnchanged } = getPriceMovement(p);
      if (isIncrease) increaseCount += 1;
      else if (isDecrease) decreaseCount += 1;
      else unchangedCount += 1;
    }
    return { increaseCount, decreaseCount, unchangedCount };
  }, [previews]);

  const filteredPreviews = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return previews.filter((p) => {
      if (query) {
        const matchesSearch =
          (p.title ?? "").toLowerCase().includes(query) ||
          (p.variantTitle ?? "").toLowerCase().includes(query) ||
          (p.vendor ?? "").toLowerCase().includes(query) ||
          (p.productType ?? "").toLowerCase().includes(query) ||
          (p.sku ?? "").toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (activeFilter !== "all") {
        const { isIncrease, isDecrease, isUnchanged } = getPriceMovement(p);
        if (activeFilter === "increase" && !isIncrease) return false;
        if (activeFilter === "decrease" && !isDecrease) return false;
        if (activeFilter === "unchanged" && !isUnchanged) return false;
      }
      return true;
    });
  }, [previews, searchQuery, activeFilter]);

  const filteredCount = filteredPreviews.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const visiblePreviews = useMemo(
    () =>
      filteredPreviews.slice(
        (safePage - 1) * PAGE_SIZE,
        safePage * PAGE_SIZE,
      ),
    [filteredPreviews, safePage],
  );
  const visibleCount = visiblePreviews.length;

  // Any change to search or filters resets to the first page.
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setPage(1);
  }, []);

  const handleFilterChange = useCallback((value: string) => {
    setActiveFilter(value);
    setPage(1);
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
        content: t("preview.backToDashboard"),
        onAction: () => navigate("/app"),
      };

  return (
    <Page
      title={t("common.nav.preview")}
      subtitle={t("preview.currency").replace("{currencyCode}", currencyCode)}
      backAction={backActionProps}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title={t("common.error.previewFailed")}>
            <p>{error}</p>
          </Banner>
        ) : null}

        {/* Live Pricing Status Banner */}
        {!isLoading && !error ? (
          isLive ? (
            <Banner tone="success">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="semibold">
                  {t("preview.livePricingActive")}
                </Text>
                <Text as="span" tone="subdued">
                  {t("preview.livePricingActiveDesc")}
                </Text>
              </InlineStack>
            </Banner>
          ) : (
            <Banner tone="warning">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="semibold">
                  {t("preview.livePricingInactive")}
                </Text>
                <Text as="span" tone="subdued">
                  {t("preview.livePricingInactiveDesc")}
                </Text>
              </InlineStack>
            </Banner>
          )
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
              heading={t("preview.empty.heading")}
              image=""
              action={{
                content: t("preview.empty.action"),
                onAction: () =>
                  navigate(
                    isFromOnboarding
                      ? `/app/rules?from=onboarding${revisitSuffix}`
                      : "/app/rules",
                  ),
              }}
            >
              <p>{t("preview.empty.body")}</p>
            </EmptyState>
          ) : (
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("preview.showingCount")
                    .replace("{visible}", visibleCount.toLocaleString())
                    .replace("{total}", totalCount.toLocaleString())}
                </Text>
              </InlineStack>
              <BlockStack gap="300">
                <TextField
                  label={t("preview.searchLabel")}
                  labelHidden
                  placeholder={t("preview.searchPlaceholder")}
                  value={searchQuery}
                  onChange={handleSearchChange}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => handleSearchChange("")}
                />
                <InlineStack gap="200" wrap blockAlign="center">
                  {[
                    {
                      label: `${t("preview.filter.all")} (${totalCount})`,
                      value: "all",
                    },
                    {
                      label: `▲ ${t("preview.filter.increased")} (${increaseCount})`,
                      value: "increase",
                    },
                    {
                      label: `▼ ${t("preview.filter.reduced")} (${decreaseCount})`,
                      value: "decrease",
                    },
                    {
                      label: `— ${t("preview.filter.unchanged")} (${unchangedCount})`,
                      value: "unchanged",
                    },
                  ].map((opt) => {
                    const isActive = activeFilter === opt.value;
                    return (
                      <div
                        key={opt.value}
                        style={{
                          borderBottom: isActive
                            ? "2px solid var(--p-color-text-interactive, #005bd3)"
                            : "2px solid transparent",
                          paddingBottom: "2px",
                        }}
                      >
                        <Button
                          size="slim"
                          variant={isActive ? "primary" : "secondary"}
                          onClick={() => handleFilterChange(opt.value)}
                          pressed={isActive}
                        >
                          {opt.label}
                        </Button>
                      </div>
                    );
                  })}
                </InlineStack>
              </BlockStack>
              <BlockStack gap="150">
                {filteredCount === 0 ? (
                  <Box paddingBlock="600">
                    <BlockStack gap="200" align="center">
                      <Text as="p" variant="bodyMd" tone="subdued" fontWeight="semibold">
                        {t("preview.noResultsHeading")}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("preview.noResultsBody")}
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <>
                    {visiblePreviews.map((p) => {
                      const {
                        oldPrice,
                        livePrice,
                        newPrice,
                        deltaPercent,
                        isIncrease,
                        isDecrease,
                      } = getPriceMovement(p);
                      const badgeTone = isIncrease
                        ? "success"
                        : isDecrease
                          ? "critical"
                          : "info";
                      const badgeLabel = isIncrease
                        ? `+${deltaPercent}%`
                        : isDecrease
                          ? `${deltaPercent}%`
                          : t("preview.noChange");
                      return (
                        <div
                          key={String(p.variantId)}
                          style={{
                            border: "1px solid #e1e3e5",
                            borderRadius: "8px",
                            padding: "16px",
                            background: "#ffffff",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                            marginBottom: "8px",
                          }}
                        >
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                            wrap={false}
                          >
                            {/* LEFT — Product info */}
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                {p.title}
                              </Text>
                              <InlineStack gap="200" wrap>
                                {p.vendor ? (
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {p.vendor}
                                  </Text>
                                ) : null}
                                {p.sku ? (
                                  <Badge tone="info" size="small">
                                    {p.sku}
                                  </Badge>
                                ) : null}
                                {p.productType ? (
                                  <Badge size="small">{p.productType}</Badge>
                                ) : null}
                              </InlineStack>
                            </BlockStack>

                            {/* RIGHT — Price movement (same contract as the
                                Dashboard grid: Original Catalog → New Preview,
                                with Live Storefront shown when it has drifted) */}
                            <InlineStack gap="300" blockAlign="center" wrap={false}>
                              <BlockStack gap="0" inlineAlign="end">
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {t("preview.currentPrice")}
                                </Text>
                                <Text as="span" variant="bodyMd">
                                  {formatMoney(oldPrice, currencyCode)}
                                </Text>
                                {Math.abs(livePrice - oldPrice) > 0.005 ? (
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {t("preview.livePrice").replace(
                                      "{price}",
                                      formatMoney(livePrice, currencyCode),
                                    )}
                                  </Text>
                                ) : null}
                              </BlockStack>

                              <Text as="span" tone="subdued">
                                →
                              </Text>

                              <BlockStack gap="0" inlineAlign="end">
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {t("preview.newPrice")}
                                </Text>
                                <Text
                                  as="span"
                                  variant="bodyMd"
                                  fontWeight="bold"
                                  tone={
                                    isIncrease
                                      ? "success"
                                      : isDecrease
                                        ? "critical"
                                        : "subdued"
                                  }
                                >
                                  {formatMoney(newPrice, currencyCode)}
                                </Text>
                              </BlockStack>

                              <Badge tone={badgeTone}>{badgeLabel}</Badge>
                            </InlineStack>
                          </InlineStack>
                        </div>
                      );
                    })}
                    {totalPages > 1 && (
                      <Box paddingBlockStart="400">
                        <InlineStack align="center">
                          <Pagination
                            label={t("preview.pageInfo")
                              .replace("{page}", String(safePage))
                              .replace("{pages}", String(totalPages))}
                            hasPrevious={safePage > 1}
                            hasNext={safePage < totalPages}
                            onPrevious={() => setPage((pg) => Math.max(1, pg - 1))}
                            onNext={() =>
                              setPage((pg) => Math.min(totalPages, pg + 1))
                            }
                            previousTooltip={t("preview.previousPage")}
                            nextTooltip={t("preview.nextPage")}
                          />
                        </InlineStack>
                      </Box>
                    )}
                  </>
                )}
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
              accessibilityLabel={t("preview.previousStepAria")}
            >
              {t("preview.previousStep")}
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                navigate(`/app/welcome?step=apply-update${revisitSuffix}`)
              }
              accessibilityLabel={t("preview.continueAria")}
            >
              {t("preview.continue")}
            </Button>
          </InlineStack>
        ) : null}
      </BlockStack>
    </Page>
  );
}
