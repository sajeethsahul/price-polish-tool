import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useNavigate, useOutletContext } from "react-router";
import {
  Page,
  BannerTone,
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
  SkeletonPage,
} from "@shopify/polaris";
import {
  InfoIcon,
  CalendarTimeIcon,
  ArrowDownIcon,
  UndoIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckIcon,
  SearchIcon,
  XCircleIcon,
  PlayIcon,
  HomeIcon,
  ClockIcon,
  PriceListIcon,
  CreditCardIcon,
  SettingsIcon,
  QuestionCircleIcon,
  RefreshIcon
} from "@shopify/polaris-icons";
import {
  formatMoney,
  getCurrencySymbol,
} from "../utils/format";
import { useAppFetch } from "../utils/fetch";
import { parseShopifyPrice } from "../utils/price-utils";
import { ScheduledHistoryModal } from "../components/ScheduledHistoryModal";
import {
  ImmediateApplyConfirmationModal,
  type ImmediateApplyImpactSummary,
} from "../components/ImmediateApplyConfirmationModal";
import {
  PricePolishLoader,
  PRICE_POLISH_LOADER_COPY,
  useDelayedVisibility,
} from "../components/PricePolishLoader";
import {
  BillingBlockModal,
  type BillingBlockModalCode,
} from "../components/BillingBlockModal";
import { DiscardChangesModal } from "../components/DiscardChangesModal";
import { useUnsavedChanges } from "../hooks/useUnsavedChanges";
import type {
  OperationalSafeguardNotice,
  PricingPreviewItem,
} from "../types/pricing";
import { calculatePrice, type PricingRuleLike } from "../utils/pricing";
import { resolveWindowLifecycleState } from "../utils/window-lifecycle";
import { t } from "../utils/i18n";

interface Message {
  text: string;
  type: BannerTone; // ensures tone matches Polaris union
  details?: string;
}

const BATCH_SIZE = 50;
const PAGE_SIZE = 15;
/** Number of staged variants processed per publish API call for client-side progress tracking. */
const PUBLISH_BATCH_SIZE = 50;
const CAMPAIGN_DETAIL_COMPARISON_GRID = "minmax(0, 1fr) 110px 160px 120px";
const REVERT_PREVIEW_COMPARISON_GRID = "minmax(0, 1fr) 110px 160px";
const LARGE_OPERATION_THRESHOLD = 100;
const VERY_LARGE_OPERATION_THRESHOLD = 250;
const MOST_VISIBLE_SCOPE_RATIO = 0.8;
const SIGNIFICANT_MOVEMENT_THRESHOLD = 25;
const MAJOR_MOVEMENT_THRESHOLD = 40;

type PreviewItem = PricingPreviewItem;
type ImmediateApplyScope = "all" | "selected" | "single";

interface LastUpdateInfo {
  batchId: string;
  updatedAt: string;
  successCount: number;
  failedCount: number;
}

interface CampaignHistoryItem {
  campaignId: string;
  title: string;
  status: string;
  createdAt: string;
  runAt?: string | null;
  windowEndAt?: string | null;
  productCount: number;
  source: string | null;
  latestBatchId: string | null;
  revertable: boolean;
  unrecoverableReason: string | null;
  revertedCount: number;
  failedCount: number;
  unrecoverableCount: number;
  totalTrackedCount: number;
  runtimeStatus?: string;
}

interface CampaignRevertPreviewRow {
  variantId: string;
  productId?: string | null;
  productTitle: string;
  variantTitle?: string | null;
  sku?: string | null;
  currentPrice: number | null;
  scheduledPrice?: number | null;
  revertTargetPrice: number;
  status?: string;
  revertFailureReason?: string | null;
}

interface CampaignRevertPreviewData {
  campaignId: string | null;
  title: string;
  productCount: number;
  latestBatchId: string | null;
  revertCompletedAt?: string | null;
  rows: CampaignRevertPreviewRow[];
  revertedCount?: number;
  failedCount?: number;
  unrecoverableCount?: number;
  totalTrackedCount?: number;
  missingHistoricalRevertedFromCount?: number;
  terminal?: boolean;
  preActivation?: boolean;
  prePublish?: boolean;
  staged?: boolean;
  schedule?: {
    type: "one-time" | "time-window" | string;
    status: string;
    runAt: string | null;
    windowEndAt?: string | null;
    productCount: number;
    createdAt?: string | null;
  };
  message?: string | null;
}

interface StorefrontControlMetrics {
  influencedVariantCount: number;
  stagedPendingCount: number;
  pendingRetryCount: number;
  retryableRevertCount: number;
  unrecoverableCount: number;
  latestInfluenceAt: string;
  openCampaignCount: number;
  closedCampaignCount: number;
  canGoLive: boolean;
  goLiveMessage: string;
}

interface DashboardMetrics {
  activeCampaignsCount: number;
  scheduledRunsCount: number;
  livePricingRulesCount: number;
  productsUnderAutomationCount: number;
  isLive: boolean;
  hasActivePlan: boolean;
  onboarding?: {
    onboardingFirstRuleAt: string | null;
    onboardingFirstPreviewAt: string | null;
    onboardingFirstApplyStartAt: string | null;
    onboardingFirstApplyAt: string | null;
    onboardingFirstScheduleAt: string | null;
    onboardingCompletedAt: string | null;
    onboardingCelebratedAt: string | null;
    reviewRequestShownAt: string | null;
    reviewRequestDismissedAt: string | null;
  };
  storefrontControl: StorefrontControlMetrics;
}

// Getter (not a module-level constant): t() must be evaluated lazily so the
// message resolves against the active locale at render time, not bundle load.
const getDefaultStorefrontControlMetrics = (): StorefrontControlMetrics => ({
  influencedVariantCount: 0,
  stagedPendingCount: 0,
  pendingRetryCount: 0,
  retryableRevertCount: 0,
  unrecoverableCount: 0,
  latestInfluenceAt: "",
  openCampaignCount: 0,
  closedCampaignCount: 0,
  canGoLive: false,
  goLiveMessage: t("server.noStagedReady"),
});

const DEFAULT_DASHBOARD_METRICS: DashboardMetrics = {
  activeCampaignsCount: 0,
  scheduledRunsCount: 0,
  livePricingRulesCount: 0,
  productsUnderAutomationCount: 0,
  isLive: false,
  hasActivePlan: true,
  onboarding: {
    onboardingFirstRuleAt: null,
    onboardingFirstPreviewAt: null,
    onboardingFirstApplyStartAt: null,
    onboardingFirstApplyAt: null,
    onboardingFirstScheduleAt: null,
    onboardingCompletedAt: null,
    onboardingCelebratedAt: null,
    reviewRequestShownAt: null,
    reviewRequestDismissedAt: null,
  },
  storefrontControl: getDefaultStorefrontControlMetrics(),
};

type TimelineTone = "success" | "warning" | "critical" | "info" | "attention";

function normalizeMeaningfulVariantTitle(
  value: string | null | undefined,
  productTitle?: string | null,
) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "default title") return null;
  const normalizedProductTitle = (productTitle ?? "").trim().toLowerCase();
  if (
    normalizedProductTitle &&
    trimmed.toLowerCase() === normalizedProductTitle
  )
    return null;
  return trimmed;
}

function normalizeSku(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function buildVariantSubtitle(params: {
  productTitle?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
}) {
  const variantTitle = normalizeMeaningfulVariantTitle(
    params.variantTitle,
    params.productTitle,
  );
  const sku = normalizeSku(params.sku);
  const parts: string[] = [];
  if (variantTitle) parts.push(variantTitle);
  if (sku) parts.push(`SKU: ${sku}`);
  return parts.length > 0 ? parts.join(" • ") : null;
}

function computeProductVariantCounts(
  items: Array<{ productId?: string | null; variantId?: string | null }>,
) {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();

  for (const item of items) {
    const productId = (item.productId ?? "").trim();
    const variantId = (item.variantId ?? "").trim();
    if (productId) productIds.add(productId);
    if (variantId) variantIds.add(variantId);
  }

  const variantCount = variantIds.size || items.length;
  const productCount = productIds.size || Math.min(items.length, variantCount);
  return { productCount, variantCount };
}

interface CampaignTimelineMilestone {
  key: string;
  label: string;
  tone: TimelineTone;
  badgeLabel?: string;
  timestamp?: string | null;
  description: string;
}

type CampaignHistoryStatusFilter =
  | "all"
  | "active"
  | "partial"
  | "scheduled"
  | "closed";
type CampaignHistorySourceFilter =
  | "all"
  | "manual"
  | "scheduled"
  | "time-window";
type CampaignHistoryTimeframeFilter =
  | "week"
  | "month"
  | "3_months"
  | "6_months"
  | "year"
  | "all";
type RevertPreviewMovementFilter =
  | "all"
  | "increase"
  | "decrease"
  | "large_movement";
type PreviewSortOrder =
  | "highest_increase"
  | "highest_decrease"
  | "alphabetical_az"
  | "alphabetical_za"
  | "highest_final_price"
  | "lowest_final_price";

const OPERATIONAL_PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 25];
const SELECT_OPTION_PREFIX = "\u2002";
const SORT_OPTION_PREFIX = "\u2009\u2009\u2009";
const REVERT_PREVIEW_DEFAULT_PAGE_SIZE = 15;
const REVERT_PREVIEW_LARGE_MOVEMENT_THRESHOLD = 15;

function normalizeCampaignStatus(status: string) {
  return status.toLowerCase();
}

function isClosedCampaignStatus(status: string) {
  const normalized = normalizeCampaignStatus(status);
  return (
    normalized === "reverted" ||
    normalized === "unrecoverable" ||
    normalized === "auto-restored" ||
    normalized === "window-stopped" ||
    normalized === "cancelled-publish" ||
    normalized === "cancelled-window"
  );
}

function normalizeCampaignSource(source: string | null) {
  return (source ?? "").trim().toLowerCase();
}

export function getStatusLabel(status: string): string {
  const normalized = (status ?? "").toLowerCase().trim();
  const STATUS_LABELS: Record<string, string> = {
    published: t("common.status.published"),
    reverted: t("common.status.reverted"),
    "auto-restored": t("common.status.autoRestored"),
    pending: t("common.status.pending"),
    processing: t("common.status.processing"),
    scheduled: t("common.status.scheduled"),
    failed: t("common.status.failed"),
    active: t("common.status.active"),
    completed: t("common.status.completed"),
    done: t("common.status.completed"),
    success: t("common.status.completed"),
    "restore-failed": t("common.status.restoreFailed"),
    "missed-during-uninstall": t("common.status.missedDuringUninstall"),
    "active-window": t("common.status.activeWindow"),
    restoring: t("common.status.restoring"),
    "window-stopped": t("common.status.windowStopped"),
    cancelled: t("common.status.cancelled"),
    "cancelled-publish": t("dashboard.campaignHistory.cancelled"),
    "cancelled-window": t("dashboard.campaignHistory.cancelledWindow"),
    "scheduled-publish": t("dashboard.campaignHistory.scheduledPublish"),
    "scheduled-window": t("dashboard.campaignHistory.scheduledWindow"),
    "publishing-window": t("dashboard.campaignHistory.publishingWindow"),
    publishing: t("common.status.publishing"),
    "expired-window": t("dashboard.campaignHistory.expiredWindow"),
    unrecoverable: t("common.status.unrecoverable"),
    draft: t("common.status.draft"),
    partial: t("common.status.partial"),
    actual: t("common.status.actual"),
  };
  return STATUS_LABELS[normalized] ?? status;
}

function resolveCampaignRuntimeStatus(
  campaign: CampaignHistoryItem,
  now: Date = new Date(),
) {
  if (normalizeCampaignSource(campaign.source) !== "time-window") {
    const status = normalizeCampaignStatus(
      campaign.runtimeStatus ?? campaign.status,
    );
    if (
      normalizeCampaignSource(campaign.source) === "scheduled" &&
      status === "scheduled-publish"
    ) {
      const runAtMs = campaign.runAt
        ? new Date(campaign.runAt).getTime()
        : null;
      if (
        runAtMs != null &&
        !Number.isNaN(runAtMs) &&
        now.getTime() >= runAtMs
      ) {
        return "publishing";
      }
    }
    return normalizeCampaignStatus(campaign.runtimeStatus ?? campaign.status);
  }

  return (
    resolveWindowLifecycleState(
      {
        status: campaign.status,
        source: "schedule-window",
        runAt: campaign.runAt,
        windowEndAt: campaign.windowEndAt,
        totalTrackedCount: campaign.totalTrackedCount,
        revertedCount: campaign.revertedCount,
        unrecoverableCount: campaign.unrecoverableCount,
      },
      now,
    ) ?? normalizeCampaignStatus(campaign.runtimeStatus ?? campaign.status)
  );
}

function formatCampaignSourceLabel(source: string | null) {
  const normalized = normalizeCampaignSource(source);
  if (normalized === "manual") return t("dashboard.campaignHistory.manual");
  if (normalized === "scheduled")
    return t("dashboard.campaignHistory.scheduled");
  if (normalized === "time-window")
    return t("dashboard.campaignHistory.timeWindow");
  return source || t("dashboard.campaignHistory.unknown");
}

function formatTimeWindowSummary(campaign: CampaignHistoryItem) {
  if (normalizeCampaignSource(campaign.source) !== "time-window") return null;

  const status = resolveCampaignRuntimeStatus(campaign);
  const start = campaign.runAt
    ? new Date(campaign.runAt).toLocaleString()
    : null;
  const end = campaign.windowEndAt
    ? new Date(campaign.windowEndAt).toLocaleString()
    : null;

  if (status === "scheduled-window" && start && end) {
    return t("campaignHistory.list.publishRestoreAt")
      .replace("{start}", start)
      .replace("{end}", end);
  }
  if (status === "publishing-window") {
    return t("campaignHistory.list.applyingScheduledPricingNotice");
  }
  if (status === "active-window" && end) {
    return t("campaignHistory.list.pricingActive");
  }
  if (status === "restoring" || status === "expired-window") {
    return t("campaignHistory.list.restoringOriginalPricingNotice");
  }
  if (status === "auto-restored") {
    return t("campaignHistory.list.originalPricingRestored");
  }
  if (status === "restore-failed") {
    return t("campaignHistory.list.autoRestoreFailed");
  }
  if (status === "window-stopped") {
    return t("campaignHistory.list.originalPricingRestoredBeforeEnd");
  }
  if (status === "cancelled-window") {
    return t("campaignHistory.list.windowCancelledBeforeStart");
  }
  if (status === "missed-during-uninstall") {
    return t("campaignHistory.list.scheduleMissedUninstall");
  }
  if (status === "failed") {
    return t("campaignHistory.list.scheduledPricingFailed");
  }
  if (status === "partial") {
    return t("campaignHistory.list.restoreNeedsAttention");
  }

  return null;
}

function formatScheduledPublishSummary(
  campaign: CampaignHistoryItem,
  now: Date = new Date(),
) {
  if (normalizeCampaignSource(campaign.source) !== "scheduled") return null;
  const status = resolveCampaignRuntimeStatus(campaign, now);
  const runAt = campaign.runAt ? new Date(campaign.runAt) : null;
  if (
    (status === "scheduled" || status === "scheduled-publish") &&
    runAt &&
    !Number.isNaN(runAt.getTime())
  ) {
    const time = runAt.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    return t("campaignHistory.list.publishesAtTime").replace("{time}", time);
  }
  if (status === "publishing")
    return t("campaignHistory.list.applyingScheduledPricingNotice");
  if (status === "published")
    return t("campaignHistory.list.publishedSuccessfully");
  if (status === "cancelled-publish" || status === "cancelled")
    return t("campaignHistory.list.scheduledPublishCancelled");
  if (status === "missed-during-uninstall")
    return t("campaignHistory.list.scheduleMissedUninstall");
  if (status === "failed")
    return t("campaignHistory.list.scheduledPricingFailed");
  return null;
}

function formatDurationParts(totalMs: number) {
  const clampedMs = Math.max(0, totalMs);
  const totalSeconds = Math.floor(clampedMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getTimeframeStart(
  filter: CampaignHistoryTimeframeFilter,
  now = new Date(),
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (filter === "all") return null;
  if (filter === "week") {
    const day = start.getDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - daysSinceMonday);
    return start;
  }
  if (filter === "month") {
    start.setDate(1);
    return start;
  }
  if (filter === "3_months") {
    start.setMonth(start.getMonth() - 3);
    return start;
  }
  if (filter === "6_months") {
    start.setMonth(start.getMonth() - 6);
    return start;
  }
  start.setMonth(0, 1);
  return start;
}

function DashboardLoader() {
  return (
    <PricePolishLoader
      title={PRICE_POLISH_LOADER_COPY.dashboard.title}
      subtitle={PRICE_POLISH_LOADER_COPY.dashboard.subtitle}
    />
  );
}

// ─── Store Health Card ───────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  if (!isoString) return t("dashboard.storeHealth.never");
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return t("dashboard.storeHealth.justNow");
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60)
    return `${diffMins} ${t("dashboard.storeHealth.minutesAgo")}`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24)
    return `${diffHours} ${t("dashboard.storeHealth.hoursAgo")}`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ${t("dashboard.storeHealth.daysAgo")}`;
}

function StoreHealthCard({
  isLive,
  stagedPendingCount,
  pendingRetryCount,
  scheduledRunsCount,
  latestInfluenceAt,
}: {
  isLive: boolean;
  stagedPendingCount: number;
  pendingRetryCount: number;
  scheduledRunsCount: number;
  latestInfluenceAt: string;
}) {
  // Status priority: Attention > Healthy > Changes Ready > Not Configured
  type StoreStatusKey = "attention" | "healthy" | "staged" | "not-configured";
  const storeStatus: StoreStatusKey =
    pendingRetryCount > 0
      ? "attention"
      : isLive
        ? "healthy"
        : stagedPendingCount > 0
          ? "staged"
          : "not-configured";

  const statusBadge = {
    attention: <Badge tone="critical">{t("common.statusAttention")}</Badge>,
    healthy: <Badge tone="success">{t("common.statusHealthy")}</Badge>,
    staged: <Badge tone="attention">{t("common.statusChangesReady")}</Badge>,
    "not-configured": <Badge>{t("common.statusNotConfigured")}</Badge>,
  }[storeStatus];

  const lastPublish = formatRelativeTime(latestInfluenceAt);

  return (
    <Card>
      <div
        style={{
          backgroundColor: "rgba(0, 82, 124, 0.08)", // soft info-blue background
          border: "1px solid rgba(0, 82, 124, 0.3)", // subtle border
          borderRadius: "12px", // inner curve
          padding: "16px",
        }}
      >
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingSm">
              {t("dashboard.storeHealth.title")}
            </Text>
            {statusBadge}
          </InlineStack>
          <BlockStack gap="100">
            <InlineStack align="space-between">
              <Text as="p" variant="bodySm" tone="subdued">
                {t("dashboard.storeHealth.productsReadyToPublish")}
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {stagedPendingCount}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="p" variant="bodySm" tone="subdued">
                {t("dashboard.storeHealth.scheduledJobs")}
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {scheduledRunsCount}
              </Text>
            </InlineStack>
            <InlineStack align="space-between">
              <Text as="p" variant="bodySm" tone="subdued">
                {t("dashboard.storeHealth.lastPublish")}
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {lastPublish}
              </Text>
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const {
    currencyCode = "USD",
    shop = "",
    host = "",
    hasMultipleMarkets = false,
    isBypass,
  } = useOutletContext<{
    currencyCode?: string;
    shop?: string;
    host?: string;
    hasMultipleMarkets?: boolean;
    isBypass?: boolean;
  }>() || {};

  if (isBypass) {
    return (
      <DashboardContent
        isBypass={true}
        currencyCode={currencyCode}
        shop={shop}
        host={host}
        hasMultipleMarkets={hasMultipleMarkets}
      />
    );
  }

  return (
    <DashboardWithBridge
      currencyCode={currencyCode}
      shop={shop}
      host={host}
      hasMultipleMarkets={hasMultipleMarkets}
    />
  );
}

function DashboardWithBridge({
  currencyCode,
  shop,
  host,
  hasMultipleMarkets,
}: {
  currencyCode: string;
  shop: string;
  host: string;
  hasMultipleMarkets: boolean;
}) {
  const shopify = useAppBridge();
  return (
    <DashboardContent
      shopify={shopify}
      currencyCode={currencyCode}
      shop={shop}
      host={host}
      hasMultipleMarkets={hasMultipleMarkets}
    />
  );
}

function DashboardContent({
  shopify,
  isBypass,
  currencyCode,
  shop,
  host,
  hasMultipleMarkets,
}: {
  shopify?: any;
  isBypass?: boolean;
  currencyCode: string;
  shop: string;
  host: string;
  hasMultipleMarkets?: boolean;
}) {
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  // ruleExists = null → not yet fetched; true/false comes from backend DB check
  const [ruleExists, setRuleExists] = useState<boolean | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [publishTotal, setPublishTotal] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<LastUpdateInfo | null>(null);
  const [showGoLiveModal, setShowGoLiveModal] = useState(false); // UPDATED
  const [showStopModal, setShowStopModal] = useState(false); // UPDATED
  const [message, setMessage] = useState<{
    type: "success" | "critical" | "warning" | "info";
    text: string;
    details?: string;
  } | null>(null);
  const [applyCampaignTitle, setApplyCampaignTitle] = useState("");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [campaignHistory, setCampaignHistory] = useState<CampaignHistoryItem[]>(
    [],
  );
  const [campaignHistoryLoading, setCampaignHistoryLoading] = useState(false);
  const [campaignHistoryExpanded, setCampaignHistoryExpanded] = useState(true);
  const [hideClosedCampaigns, setHideClosedCampaigns] = useState(true);
  const [campaignHistoryStatusFilter, setCampaignHistoryStatusFilter] =
    useState<CampaignHistoryStatusFilter>("all");
  const [campaignHistorySourceFilter, setCampaignHistorySourceFilter] =
    useState<CampaignHistorySourceFilter>("all");
  const [campaignHistoryTimeframeFilter, setCampaignHistoryTimeframeFilter] =
    useState<CampaignHistoryTimeframeFilter>("month");
  const [campaignHistorySearchQuery, setCampaignHistorySearchQuery] =
    useState("");
  const [campaignRuntimeNow, setCampaignRuntimeNow] = useState(
    () => new Date(),
  );
  const [revertPreviewOpen, setRevertPreviewOpen] = useState(false);
  const [revertPreviewLoading, setRevertPreviewLoading] = useState(false);
  const [revertPreviewRetryFailedOnly, setRevertPreviewRetryFailedOnly] =
    useState(false);
  const [selectedCampaignForRevert, setSelectedCampaignForRevert] =
    useState<CampaignHistoryItem | null>(null);
  const [revertPreview, setRevertPreview] =
    useState<CampaignRevertPreviewData | null>(null);
  const [revertPreviewSearchQuery, setRevertPreviewSearchQuery] = useState("");
  const [revertPreviewMovementFilter, setRevertPreviewMovementFilter] =
    useState<RevertPreviewMovementFilter>("all");
  const [revertPreviewPageSize, setRevertPreviewPageSize] = useState(
    REVERT_PREVIEW_DEFAULT_PAGE_SIZE,
  );
  const [revertPreviewPage, setRevertPreviewPage] = useState(1);
  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false);
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false);
  const [selectedCampaignForDetail, setSelectedCampaignForDetail] =
    useState<CampaignHistoryItem | null>(null);
  const [campaignDetail, setCampaignDetail] =
    useState<CampaignRevertPreviewData | null>(null);
  const [campaignDetailPageSize, setCampaignDetailPageSize] = useState(15);
  const [campaignDetailPage, setCampaignDetailPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [updatingItem, setUpdatingItem] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<
    "all" | "increase" | "decrease" | "high_impact"
  >("all");
  const [sortOrder, setSortOrder] =
    useState<PreviewSortOrder>("alphabetical_az");
  const [firstVisit, setFirstVisit] = useState(false);
  const [activeMarkup, setActiveMarkup] = useState(0);
  const [roundingStep, setRoundingStep] = useState(1);
  const [charmPricing, setCharmPricing] = useState(true);
  const [previewPricingRule, setPreviewPricingRule] =
    useState<PricingRuleLike | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics>(
    DEFAULT_DASHBOARD_METRICS,
  );
  const collectionId = "";
  const [immediateApplyModalOpen, setImmediateApplyModalOpen] = useState(false);
  const [immediateApplyScope, setImmediateApplyScope] =
    useState<ImmediateApplyScope>("selected");
  const [immediateApplySingleItem, setImmediateApplySingleItem] =
    useState<PreviewItem | null>(null);
  const [immediateApplyModalItems, setImmediateApplyModalItems] = useState<
    PreviewItem[]
  >([]);
  const [scheduleHistoryModalOpen, setScheduleHistoryModalOpen] =
    useState(false);

  // Billing block modal state
  const [billingBlockModalOpen, setBillingBlockModalOpen] = useState(false);
  const [billingBlockModalCode, setBillingBlockModalCode] =
    useState<BillingBlockModalCode | null>(null);

  // Billing placeholders — do not modify
  const handleUpgrade = useCallback(() => {
    if (shopify) shopify.toast.show(t("toast.billingComingSoon"));
    else console.log("BYPASS: Upgrade triggered");
  }, [shopify]);

  const hasActivePlan = metrics.hasActivePlan;
  const storefrontControl =
    metrics.storefrontControl ?? getDefaultStorefrontControlMetrics();

  // UPDATED: hasRules driven by backend DB check (ruleExists), NOT previews.length
  const hasRules = ruleExists === true;
  console.log(
    `[hasRules DEBUG] ruleExists=${ruleExists} → hasRules=${hasRules}, previews.length=${previews.length}`,
  );

  const navigate = useNavigate();
  const appFetch = useAppFetch();
  const currencySymbol = getCurrencySymbol(currencyCode);

  // ADDED: Guard helper — shows toast and blocks execution when no rules exist
  const guardNoRules = useCallback(() => {
    if (!hasRules) {
      if (shopify)
        shopify.toast.show(t("toast.configureRulesFirst"), { isError: true });
      else console.warn("BYPASS: Please configure pricing rules first");
      return true; // blocked
    }
    return false; // allowed
  }, [hasRules, shopify]);

  const handlePreview = useCallback(async () => {
    console.log("DEBUG: Initializing handlePreview fetch...");
    setLoading(true);
    setMessage(null);
    setCurrentPage(1);
    setSelectedItems(new Set());

    try {
      const fetcher = await appFetch;
      console.log("[Campaign History UI] fetch started");

      const [data, metricsData, campaignHistoryData] = await Promise.all([
        fetcher("/api/preview-price"),
        fetcher(
          `/api/metrics?locale=${encodeURIComponent(
            (typeof window !== "undefined" && (window as any).__LOCALE__) || "",
          )}`,
        ).catch(() => DEFAULT_DASHBOARD_METRICS),
        fetcher("/api/campaign-history").catch(() => ({ campaigns: [] })),
      ]);

      console.log("DEBUG: Data received from parallel fetch");

      const fetchedPreviews = data.previews ?? [];
      setPreviews(fetchedPreviews);
      console.log("[Operational Refresh] preview/grid refreshed", {
        count: fetchedPreviews.length,
      });
      setLastUpdate(data.lastUpdate ?? null);
      // UPDATED: Use backend's ruleExists flag as authoritative source for hasRules
      console.log(
        `[FETCH DEBUG] data.ruleExists=${data.ruleExists}, previews.length=${fetchedPreviews.length}`,
      );
      setRuleExists(data.ruleExists === true);
      setActiveMarkup(data.markupPercent ?? 0);
      setRoundingStep(data.roundingStep ?? 1);
      setCharmPricing(data.charmPricing ?? true);
      setPreviewPricingRule({
        adjustmentType: data.adjustmentType ?? "percentage",
        adjustmentDirection:
          data.adjustmentDirection ??
          ((data.markupPercent ?? 0) < 0 ? "decrease" : "increase"),
        adjustmentValue:
          data.adjustmentValue ?? Math.abs(data.markupPercent ?? 0),
        endingOption:
          data.endingOption ??
          ((data.charmPricing ?? true)
            ? "0.99"
            : (data.roundingStep ?? 0) > 0
              ? Number(data.roundingStep).toFixed(2)
              : "none"),
        roundingPrecision: data.roundingPrecision ?? "standard",
        minPrice: data.minPrice ?? null,
        maxPrice: data.maxPrice ?? null,
      });
      setMetrics((prev) => ({
        ...prev,
        ...metricsData,
        hasActivePlan:
          metricsData.hasActivePlan !== undefined
            ? metricsData.hasActivePlan
            : true,
        storefrontControl: {
          ...getDefaultStorefrontControlMetrics(),
          ...(metricsData?.storefrontControl ?? {}),
        },
      }));
      setActiveCampaignId(
        metricsData?.storefrontControl?.activeCampaignId ?? null,
      );
      const campaigns = Array.isArray(campaignHistoryData?.campaigns)
        ? campaignHistoryData.campaigns
        : [];
      setCampaignHistory(campaigns);
      console.log("[Campaign History UI] loaded count:", campaigns.length);
      console.log("[Campaign History UI] operational metrics rendered", {
        count: campaigns.length,
      });
      console.log("[Operational Refresh] campaign history refreshed", {
        count: campaigns.length,
      });

      if (fetchedPreviews.length === 0) {
        setFirstVisit(true);
      } else {
        setFirstVisit(false);
      }
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("An unknown error occurred.");
      console.error("DEBUG: Preview Error detail:", error);
      if (shopify)
        shopify.toast.show(t("toast.networkErrorTryAgain"), { isError: true });
      else console.warn("BYPASS: Network error. Please try again.");
      setMessage({
        type: "critical",
        text: "Failed to load preview data.",
        details: error.message,
      });
    } finally {
      console.log("DEBUG: Finalizing handlePreview loading state.");
      setLoading(false);
    }
  }, [shopify]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const params = url.searchParams;

    const shop = params.get("shop");
    const host = params.get("host");
    const hasChargeId = params.has("charge_id");

    if (shop) {
      localStorage.setItem("shop", shop);
      console.log("[SHOP STORED]", shop);
    }

    if (hasChargeId) {
      console.log("[BILLING] Payment completed → cleaning URL safely");
      params.delete("charge_id");
      const newUrl = `${url.pathname}?${params.toString()}`;
      window.location.replace(newUrl);
      return;
    }

    console.log("DEBUG: Dashboard mounted → fetching preview");
    handlePreview();
  }, [handlePreview]);

  const handleApplyBatch = useCallback(
    async (
      itemsToUpdate: PreviewItem[],
      campaignTitle: string,
    ): Promise<boolean> => {
      if (!hasRules) {
        shopify.toast.show(t("toast.configureRulesFirstShort"), {
          isError: true,
        });
        return false;
      }

      setIsProcessing(true);

      try {
        // handleApplyBatch ONLY stages the items passed to it.
        // Callers determine the item list/scope.
        const scopedItems = itemsToUpdate;

        if (scopedItems.length === 0) {
          shopify.toast.show(t("toast.noProductsToApply"), { isError: true });
          return false;
        }

        const normalizedCampaignTitle = campaignTitle.trim();
        if (!normalizedCampaignTitle) {
          shopify.toast.show(t("toast.campaignTitleRequired"), {
            isError: true,
          });
          return false;
        }

        const itemsWithFinalPrices = scopedItems.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          oldPrice: item.oldPrice,
          compareAtPrice: item.compareAtPrice ?? null,
          newPrice:
            item.overriddenPrice !== undefined
              ? item.overriddenPrice
              : item.newPrice,
          isManual: item.overriddenPrice !== undefined,
        }));

        console.log("Selected items:", selectedItems);
        console.log("Scoped items:", scopedItems);
        console.log("Sending payload:", itemsWithFinalPrices);
        const campaignId = crypto.randomUUID();
        console.log(
          "[Apply] campaign title submitted:",
          normalizedCampaignTitle,
        );

        const response = await fetch("/api/staging-price", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            products: itemsWithFinalPrices,
            campaignId,
            campaignTitle: normalizedCampaignTitle,
          }),
        });

        const result = await response.json();
        const stagingCampaignId =
          typeof result?.campaignId === "string" && result.campaignId.length > 0
            ? result.campaignId
            : null;
        setActiveCampaignId(stagingCampaignId);

        if (!response.ok) {
          const billingError =
            result.code === "BILLING_INACTIVE"
              ? "Subscription inactive. Please reactivate billing to continue using Price Polish."
              : result.code === "BILLING_UNKNOWN"
                ? "Billing status could not be verified. Please refresh the app and try again."
                : result.error || "Failed to apply pricing";
          throw new Error(billingError);
        }

        setActiveCampaignId(stagingCampaignId);

        // ── Auto-push when Live Pricing is Active ────────────────────────────
        if (metrics.isLive) {
          const manualVariantIds = itemsWithFinalPrices
            .filter((p) => p.isManual)
            .map((p) => p.variantId);
          console.log(
            "[Apply] push-storefront called with campaignId:",
            stagingCampaignId,
          );
          const pushRes = await fetch("/api/push-storefront", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clear: false,
              manualVariantIds,
              ...(stagingCampaignId ? { campaignId: stagingCampaignId } : {}),
            }),
          });

          const pushData = await pushRes.json();

          if (!pushRes.ok) {
            const pushBillingError =
              pushData.code === "BILLING_INACTIVE"
                ? "Subscription inactive. Please reactivate billing to continue using Price Polish."
                : pushData.code === "BILLING_UNKNOWN"
                  ? "Billing status could not be verified. Please refresh the app and try again."
                  : pushData.error || "Prices staged but failed to push live";
            console.log(
              "Prices staged but failed to push live : - push data :",
              pushData,
            );
            throw new Error(pushBillingError);
          }

          shopify.toast.show(t("toast.pricesLiveUpdated"));
          console.log("Prices updated and live on storefront-Sajeeth");
        } else {
          shopify.toast.show(t("toast.pricingApplied"));
          console.log("Prices updated and live on storefront-Sajeeth");
        }
        // ─────────────────────────────────────────────────────────────────────

        await handlePreview();

        return true;
      } catch (error: any) {
        const message = error?.message || "Apply failed";
        const isBillingError =
          message.includes("Subscription inactive") ||
          message.includes("Billing status could not be verified");
        if (isBillingError) {
          const code: BillingBlockModalCode = message.includes(
            "Subscription inactive",
          )
            ? "BILLING_INACTIVE"
            : "BILLING_UNKNOWN";
          // Close parent confirmation modal before showing billing modal
          setImmediateApplyModalOpen(false);
          setBillingBlockModalCode(code);
          setBillingBlockModalOpen(true);
        } else {
          shopify.toast.show(message, { isError: true });
        }
        return false;
      } finally {
        setIsProcessing(false);
      }
    },
    [hasRules, shopify, metrics.isLive, handlePreview],
  );

  const selectedPreviewItems = useMemo(
    () => previews.filter((item) => selectedItems.has(String(item.variantId))),
    [previews, selectedItems],
  );

  const immediateApplyItems = useMemo(
    () =>
      immediateApplyScope === "all"
        ? previews
        : immediateApplyScope === "single"
          ? immediateApplySingleItem
            ? [immediateApplySingleItem]
            : []
          : selectedPreviewItems,
    [
      immediateApplyScope,
      previews,
      selectedPreviewItems,
      immediateApplySingleItem,
    ],
  );
  const immediateApplyScopeLabel =
    immediateApplyScope === "all"
      ? t("dashboard.scopeLabels.products")
      : immediateApplyScope === "single"
        ? t("dashboard.scopeLabels.product")
        : t("dashboard.scopeLabels.selectedProducts");

  const immediateApplyContextItems =
    immediateApplyModalItems.length > 0
      ? immediateApplyModalItems
      : immediateApplyItems;

  const immediateApplyImpactSummary =
    useMemo<ImmediateApplyImpactSummary>(() => {
      const summary: ImmediateApplyImpactSummary = {
        increaseCount: 0,
        decreaseCount: 0,
        averageChangePercent: 0,
        largestMovementPercent: null,
        largestMovementDirection: null,
        singleItemDirection: null,
      };

      if (immediateApplyContextItems.length === 0) {
        return summary;
      }

      let totalPercentChange = 0;
      let validPercentCount = 0;

      for (const item of immediateApplyContextItems) {
        const oldPrice = parseShopifyPrice(item.oldPrice);
        const proposedRaw =
          item.overriddenPrice !== undefined
            ? item.overriddenPrice
            : item.newPrice;
        const proposedPrice = parseShopifyPrice(proposedRaw);

        if (
          !Number.isFinite(oldPrice) ||
          !Number.isFinite(proposedPrice) ||
          oldPrice <= 0
        ) {
          continue;
        }

        const deltaPercent = ((proposedPrice - oldPrice) / oldPrice) * 100;
        totalPercentChange += deltaPercent;
        validPercentCount += 1;

        if (deltaPercent > 0) {
          summary.increaseCount += 1;
        } else if (deltaPercent < 0) {
          summary.decreaseCount += 1;
        }

        if (
          summary.largestMovementPercent === null ||
          Math.abs(deltaPercent) > Math.abs(summary.largestMovementPercent)
        ) {
          summary.largestMovementPercent = deltaPercent;
          summary.largestMovementDirection =
            deltaPercent > 0
              ? "increase"
              : deltaPercent < 0
                ? "decrease"
                : null;
        }
      }

      if (validPercentCount > 0) {
        summary.averageChangePercent = totalPercentChange / validPercentCount;
      }

      if (immediateApplyContextItems.length === 1) {
        summary.singleItemDirection =
          summary.largestMovementDirection === "increase"
            ? "increase"
            : summary.largestMovementDirection === "decrease"
              ? "decrease"
              : "no_change";
      }

      return summary;
    }, [immediateApplyContextItems]);

  const immediateApplySafeguardNotices = useMemo<
    OperationalSafeguardNotice[]
  >(() => {
    if (immediateApplyContextItems.length <= 1) {
      return [];
    }

    const notices: OperationalSafeguardNotice[] = [];
    const totalVisibleProducts = previews.length;
    const affectsMostVisible =
      totalVisibleProducts > 0 &&
      immediateApplyContextItems.length >=
        Math.max(
          25,
          Math.ceil(totalVisibleProducts * MOST_VISIBLE_SCOPE_RATIO),
        );
    const largestMovement = Math.abs(
      immediateApplyImpactSummary.largestMovementPercent ?? 0,
    );
    const isStorefrontWide =
      totalVisibleProducts > 0 &&
      immediateApplyContextItems.length >=
        Math.ceil(totalVisibleProducts * 0.95);
    const isAllProductsScope = immediateApplyScope === "all";

    if (
      isAllProductsScope ||
      immediateApplyContextItems.length >= LARGE_OPERATION_THRESHOLD
    ) {
      notices.push({
        id: "immediate-large-operation",
        severity: "informational",
        message: t("dashboard.safeguardNotices.largeOperation"),
      });
    }

    if (affectsMostVisible) {
      notices.push({
        id: "immediate-most-visible",
        severity: "informational",
        message: t("dashboard.safeguardNotices.mostVisible"),
      });
    }

    if (largestMovement >= SIGNIFICANT_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "immediate-significant-movement",
        severity: "informational",
        message: t("dashboard.safeguardNotices.significantMovement"),
      });
    }

    if (immediateApplyContextItems.length >= VERY_LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "immediate-very-large-operation",
        severity: "warning",
        message: t("dashboard.safeguardNotices.veryLargeOperation"),
      });
    }

    if (isStorefrontWide) {
      notices.push({
        id: "immediate-storefront-wide",
        severity: "warning",
        message: t("dashboard.safeguardNotices.storefrontWide"),
      });
    }

    if (isAllProductsScope && largestMovement >= MAJOR_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "immediate-all-products-major-movement",
        severity: "warning",
        message: t("dashboard.safeguardNotices.allProductsMajorMovement"),
      });
    }

    return notices;
  }, [
    immediateApplyContextItems.length,
    immediateApplyImpactSummary.largestMovementPercent,
    immediateApplyScope,
    previews.length,
  ]);

  const normalizeCampaignTitle = useCallback((value: string) => {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }, []);

  const existingCampaignTitleSet = useMemo(() => {
    const set = new Set<string>();
    for (const campaign of campaignHistory) {
      const normalized = normalizeCampaignTitle(campaign.title ?? "");
      if (normalized) set.add(normalized);
    }
    return set;
  }, [campaignHistory, normalizeCampaignTitle]);

  const validateCampaignTitle = useCallback(
    (title: string) => {
      const normalized = normalizeCampaignTitle(title);
      if (!normalized) return undefined;
      if (existingCampaignTitleSet.has(normalized)) {
        return t("dashboard.campaignTitle.duplicate");
      }
      return undefined;
    },
    [existingCampaignTitleSet, normalizeCampaignTitle],
  );

  const campaignHistoryTitles = useMemo(
    () => campaignHistory.map((campaign) => campaign.title),
    [campaignHistory],
  );

  const openImmediateApplyModal = useCallback(
    (scope: ImmediateApplyScope, item?: PreviewItem) => {
      const scopeItems =
        scope === "all"
          ? previews
          : scope === "single"
            ? item
              ? [item]
              : []
            : previews.filter((preview) =>
                selectedItems.has(String(preview.variantId)),
              );

      setImmediateApplyScope(scope);
      if (scope === "single" && item) {
        setImmediateApplySingleItem(item);
      } else {
        setImmediateApplySingleItem(null);
      }
      setImmediateApplyModalItems(scopeItems);
      setImmediateApplyModalOpen(true);
    },
    [previews, selectedItems],
  );

  const closeImmediateApplyModal = useCallback(() => {
    setImmediateApplyModalOpen(false);
    setImmediateApplySingleItem(null);
    setImmediateApplyModalItems([]);
  }, []);

  const handleApplySingle = useCallback(
    (item: PreviewItem) => {
      openImmediateApplyModal("single", item);
    },
    [openImmediateApplyModal],
  );

  const resetRevertPreviewViewState = useCallback(() => {
    setRevertPreviewSearchQuery("");
    setRevertPreviewMovementFilter("all");
    setRevertPreviewPageSize(REVERT_PREVIEW_DEFAULT_PAGE_SIZE);
    setRevertPreviewPage(1);
  }, []);

  const campaignDetailRows = campaignDetail?.rows ?? [];
  const campaignDetailCounts = useMemo(
    () => computeProductVariantCounts(campaignDetailRows),
    [campaignDetailRows],
  );
  const campaignDetailTotalPages = Math.max(
    1,
    Math.ceil(campaignDetailRows.length / campaignDetailPageSize),
  );
  const campaignDetailPaginatedRows = useMemo(() => {
    const start = (campaignDetailPage - 1) * campaignDetailPageSize;
    return campaignDetailRows.slice(start, start + campaignDetailPageSize);
  }, [campaignDetailPage, campaignDetailPageSize, campaignDetailRows]);

  useEffect(() => {
    setCampaignDetailPage(1);
  }, [campaignDetail, campaignDetailPageSize]);

  useEffect(() => {
    if (campaignDetailPage > campaignDetailTotalPages) {
      setCampaignDetailPage(campaignDetailTotalPages);
    }
  }, [campaignDetailPage, campaignDetailTotalPages]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCampaignRuntimeNow(new Date());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [sortOrder]);

  const revertSafeguardNotices = useMemo<OperationalSafeguardNotice[]>(() => {
    if (!revertPreview || revertPreview.terminal) return [];

    const notices: OperationalSafeguardNotice[] = [];
    const productCount = Number.isFinite(revertPreview.productCount)
      ? revertPreview.productCount
      : 0;
    const totalVisibleProducts = previews.length;
    const affectsMostVisible =
      totalVisibleProducts > 0 &&
      productCount >=
        Math.max(
          25,
          Math.ceil(totalVisibleProducts * MOST_VISIBLE_SCOPE_RATIO),
        );
    const storefrontWide =
      totalVisibleProducts > 0 &&
      productCount >= Math.ceil(totalVisibleProducts * 0.95);
    let largestMovement = 0;

    for (const row of revertPreview.rows) {
      if (row.currentPrice == null || row.currentPrice <= 0) continue;
      const deltaPercent =
        ((row.revertTargetPrice - row.currentPrice) / row.currentPrice) * 100;
      if (Number.isFinite(deltaPercent)) {
        largestMovement = Math.max(largestMovement, Math.abs(deltaPercent));
      }
    }

    if (productCount >= LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "revert-large-scope",
        severity: "informational",
        message: t("dashboard.safeguardNotices.revertLargeScope"),
      });
    }

    if (affectsMostVisible) {
      notices.push({
        id: "revert-most-visible",
        severity: "informational",
        message: t("dashboard.safeguardNotices.revertMostVisible"),
      });
    }

    if (largestMovement >= SIGNIFICANT_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "revert-significant-movement",
        severity: "informational",
        message: t("dashboard.safeguardNotices.revertSignificantMovement"),
      });
    }

    if (productCount >= VERY_LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "revert-very-large-scope",
        severity: "warning",
        message: t("dashboard.safeguardNotices.revertVeryLargeScope"),
      });
    }

    if (storefrontWide && largestMovement >= MAJOR_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "revert-storefront-major-movement",
        severity: "warning",
        message: t("dashboard.safeguardNotices.revertStorefrontMajor"),
      });
    }

    return notices;
  }, [previews.length, revertPreview]);

  const revertPreviewFilteredRows = useMemo(() => {
    // 🔍 DEBUG TRACE - Now tracking the true active state variables
    console.log("=== REVERT PREVIEW TRACE ===");
    console.log("1. Full object:", revertPreview);
    console.log("2. Rows array:", revertPreview?.rows);
    console.log("3. Search input state value:", searchQuery); // Changed to tracked search state

    // Early exit check - if no object or rows array, match initial trace state safely
    if (!revertPreview || !revertPreview.rows)
      return [] as CampaignRevertPreviewRow[];

    const normalizedQuery = searchQuery.trim().toLowerCase();

    return revertPreview.rows.filter((row) => {
      // 🔹 1. Robust Extended Search Logic
      if (normalizedQuery) {
        const title = (row.productTitle || "").toLowerCase();

        // Fallback matching logic for multiple common Shopify object schemas
        const type = (
          (row as any).productType ||
          (row as any).type ||
          (row as any).product_type ||
          (row as any).productVariant?.product?.productType ||
          ""
        ).toLowerCase();

        const vendor = (
          (row as any).vendor ||
          (row as any).vendorName ||
          (row as any).brand ||
          (row as any).productVariant?.product?.vendor ||
          ""
        ).toLowerCase();

        const matchesTitle = title.includes(normalizedQuery);
        const matchesType = type.includes(normalizedQuery);
        const matchesVendor = vendor.includes(normalizedQuery);

        if (!matchesTitle && !matchesType && matchesVendor) {
          return false;
        }
      }

      // 🔹 2. Movement Filters (Ensure dependency matches your exact state naming, e.g., activeFilter)
      if (activeFilter === "all") return true;

      if (row.currentPrice == null || row.currentPrice <= 0) {
        return activeFilter === "high_impact" ? false : true;
      }

      const delta = row.revertTargetPrice - row.currentPrice;
      const deltaPercent = (delta / row.currentPrice) * 100;

      if (activeFilter === "increase") return delta > 0;
      if (activeFilter === "decrease") return delta < 0;
      if (activeFilter === "high_impact") {
        return Math.abs(deltaPercent) >= 10; // Matches your card's high impact threshold rule
      }
      return true;
    });
    // 💡 Ensure the hook updates whenever the active states or data payload rows change!
  }, [revertPreview, activeFilter, searchQuery]);

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setMinPrice("");
    setMaxPrice("");
    setActiveFilter("all");
    // Optional: Reset sort if desired, e.g., setSortOrder("alphabetical_az");
  }, []);

  const revertPreviewTotalPages = Math.max(
    1,
    Math.ceil(revertPreviewFilteredRows.length / revertPreviewPageSize),
  );
  const revertPreviewPaginatedRows = useMemo(() => {
    const start = (revertPreviewPage - 1) * revertPreviewPageSize;
    return revertPreviewFilteredRows.slice(
      start,
      start + revertPreviewPageSize,
    );
  }, [revertPreviewFilteredRows, revertPreviewPage, revertPreviewPageSize]);

  const revertPreviewCounts = useMemo(() => {
    if (!revertPreview) return { productCount: 0, variantCount: 0 };
    return computeProductVariantCounts(revertPreview.rows);
  }, [revertPreview]);

  useEffect(() => {
    setRevertPreviewPage(1);
  }, [
    revertPreviewSearchQuery,
    revertPreviewMovementFilter,
    revertPreviewPageSize,
  ]);

  useEffect(() => {
    if (revertPreviewPage > revertPreviewTotalPages) {
      setRevertPreviewPage(revertPreviewTotalPages);
    }
  }, [revertPreviewPage, revertPreviewTotalPages]);

  const filteredPreviews = useMemo(() => {
    console.log(
      `DEBUG: compute filteredPreviews. Source length: ${previews.length}`,
    );
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const parsedMin = minPrice === "" ? null : parseShopifyPrice(minPrice);
    const parsedMax = maxPrice === "" ? null : parseShopifyPrice(maxPrice);

    const derived = previews.map((p) => {
      const livePrice = parseShopifyPrice(p.oldPrice);
      const finalPrice =
        p.overriddenPrice !== undefined
          ? parseShopifyPrice(p.overriddenPrice)
          : parseShopifyPrice(p.newPrice);
      const delta = finalPrice - livePrice;
      const deltaPercent = livePrice !== 0 ? (delta / livePrice) * 100 : 0;
      return {
        ...p,
        livePrice,
        finalPrice,
        delta,
        deltaPercent,
      };
    });

    let result = derived.filter((p) => {
      // 🔹 1. Extended Multi-Field Search (Title, Product Type, and Vendor)
      let matchesSearch = normalizedQuery.length === 0;

      if (!matchesSearch) {
        const title = (p.title || "").toLowerCase();

        // Dynamic property mapping for variant/product types & vendors
        const type = (
          (p as any).productType ||
          (p as any).type ||
          (p as any).product_type ||
          ""
        ).toLowerCase();

        const vendor = (
          (p as any).vendor ||
          (p as any).vendorName ||
          ""
        ).toLowerCase();

        matchesSearch =
          title.includes(normalizedQuery) ||
          type.includes(normalizedQuery) ||
          vendor.includes(normalizedQuery);
      }

      // 🔹 2. Existing Price & Smart Segment Filters (Unchanged)
      const matchesMin = parsedMin == null || p.finalPrice >= parsedMin;
      const matchesMax = parsedMax == null || p.finalPrice <= parsedMax;

      let matchesSmartFilter = true;
      if (activeFilter === "increase") matchesSmartFilter = p.delta > 0;
      else if (activeFilter === "decrease") matchesSmartFilter = p.delta < 0;
      else if (activeFilter === "high_impact")
        matchesSmartFilter = Math.abs(p.deltaPercent) >= 10;

      return matchesSearch && matchesMin && matchesMax && matchesSmartFilter;
    });

    result.sort((a, b) => {
      switch (sortOrder) {
        case "alphabetical_az":
          return a.title.localeCompare(b.title);
        case "alphabetical_za":
          return b.title.localeCompare(a.title);
        case "highest_increase":
          return b.delta - a.delta || a.title.localeCompare(b.title);
        case "highest_decrease":
          return a.delta - b.delta || a.title.localeCompare(b.title);
        case "highest_final_price":
          return b.finalPrice - a.finalPrice || a.title.localeCompare(b.title);
        case "lowest_final_price":
          return a.finalPrice - b.finalPrice || a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

    return result;
  }, [previews, searchQuery, minPrice, maxPrice, activeFilter, sortOrder]);

  const previewImpactSummary = useMemo(() => {
    const rows = filteredPreviews;
    const productIds = new Set<string>();
    const variantIds = new Set<string>();
    let affectedCount = 0;
    let sumDelta = 0;
    let sumFinal = 0;
    let maxIncreaseDelta = 0;
    let maxDecreaseDelta = 0;
    let hasIncrease = false;
    let hasDecrease = false;

    for (const item of rows) {
      if (item.productId) productIds.add(String(item.productId));
      if (item.variantId) variantIds.add(String(item.variantId));

      const oldP = parseShopifyPrice(item.oldPrice);
      const finalP =
        item.overriddenPrice !== undefined
          ? parseShopifyPrice(item.overriddenPrice)
          : parseShopifyPrice(item.newPrice);

      if (!isFinite(oldP) || !isFinite(finalP)) continue;
      sumFinal += finalP;
      const delta = finalP - oldP;

      if (delta !== 0) {
        affectedCount += 1;
        sumDelta += delta;
        if (delta > 0) hasIncrease = true;
        if (delta < 0) hasDecrease = true;
        if (delta > maxIncreaseDelta) maxIncreaseDelta = delta;
        if (delta < maxDecreaseDelta) maxDecreaseDelta = delta;
      }
    }

    const averageDelta = affectedCount > 0 ? sumDelta / affectedCount : 0;
    const averageFinalPrice = rows.length > 0 ? sumFinal / rows.length : 0;

    let safeguardAdjustedCount = 0;
    if (previewPricingRule) {
      for (const item of rows) {
        if (item.overriddenPrice !== undefined) continue;
        const base = parseShopifyPrice(item.originalBasePrice);
        if (!isFinite(base)) continue;

        const unclamped = calculatePrice(base, {
          ...previewPricingRule,
          minPrice: null,
          maxPrice: null,
        });
        const final = calculatePrice(base, previewPricingRule);
        const clampAdjusted = Math.abs(unclamped - final) > 0.01;

        const finalWithoutEnding = calculatePrice(base, {
          ...previewPricingRule,
          endingOption: "none",
        });
        const endingOption = String(previewPricingRule.endingOption ?? "none")
          .trim()
          .toLowerCase();
        const endingAdjusted =
          endingOption !== "" &&
          endingOption !== "none" &&
          Math.abs(final - finalWithoutEnding) > 0.01;

        const finalWithoutRounding = calculatePrice(base, {
          ...previewPricingRule,
          roundingPrecision: "standard",
        });
        const roundingPrecision = String(
          previewPricingRule.roundingPrecision ?? "standard",
        )
          .trim()
          .toLowerCase();
        const roundingAdjusted =
          roundingPrecision !== "" &&
          roundingPrecision !== "standard" &&
          Math.abs(final - finalWithoutRounding) > 0.01;

        if (clampAdjusted || endingAdjusted || roundingAdjusted) {
          safeguardAdjustedCount += 1;
        }
      }
    }

    return {
      totalCount: productIds.size || rows.length,
      variantCount: variantIds.size || rows.length,
      affectedCount,
      hasIncrease,
      hasDecrease,
      averageDelta,
      maxIncreaseDelta,
      maxDecreaseDelta,
      averageFinalPrice,
      safeguardAdjustedCount,
    };
  }, [filteredPreviews, previewPricingRule]);

  const handleUndo = useCallback(async () => {
    if (!lastUpdate?.batchId) return;
    console.log(
      `DEBUG: Initializing handleUndo for batch: ${lastUpdate.batchId}...`,
    );
    setIsProcessing(true);
    setMessage(null);

    try {
      const res = await fetch("/api/undo-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: lastUpdate.batchId }),
      });

      console.log(`DEBUG: /api/undo-price status: ${res.status}`);
      const data = await res.json();
      console.log("DEBUG: /api/undo-price data received:", !!data);

      if (res.ok) {
        if (shopify)
          shopify.toast.show(
            t("dashboard.undo.restored").replace(
              "{count}",
              String(data.restoredCount),
            ),
          );
        else console.log(`BYPASS: Restored ${data.restoredCount} products`);
        await handlePreview();
        setSelectedItems(new Set());
      } else {
        if (data.code === "BILLING_INACTIVE") {
          throw new Error(
            "Subscription inactive. Please reactivate billing to continue using Price Polish.",
          );
        } else if (data.code === "BILLING_UNKNOWN") {
          throw new Error(
            "Billing status could not be verified. Please refresh the app and try again.",
          );
        } else {
          throw new Error(data.error || "Failed to undo changes.");
        }
      }
    } catch (err) {
      console.error("DEBUG: Undo Error detail:", err);
      const message = err instanceof Error ? err.message : String(err);
      const isBillingError =
        message.includes("Subscription inactive") ||
        message.includes("Billing status could not be verified");
      if (isBillingError) {
        const code: BillingBlockModalCode = message.includes(
          "Subscription inactive",
        )
          ? "BILLING_INACTIVE"
          : "BILLING_UNKNOWN";
        setBillingBlockModalCode(code);
        setBillingBlockModalOpen(true);
      } else if (shopify) {
        shopify.toast.show(message || t("dashboard.undo.failed"), {
          isError: true,
        });
      } else {
        console.error("BYPASS: Failed to undo changes");
      }
    } finally {
      console.log("DEBUG: Finalizing handleUndo processing state.");
      setIsProcessing(false);
    }
  }, [lastUpdate, shopify, handlePreview]);

  const openCampaignDetailView = useCallback(
    async (campaign: CampaignHistoryItem) => {
      console.log("[Campaign History UI] campaign detail view opened", {
        campaignId: campaign.campaignId,
        title: campaign.title,
      });
      setCampaignDetailPageSize(15);
      setCampaignDetailPage(1);
      setSelectedCampaignForDetail(campaign);
      setCampaignDetailOpen(true);
      setCampaignDetailLoading(true);
      setCampaignDetail(null);
      try {
        const res = await fetch("/api/campaign-revert-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: campaign.campaignId,
            ...(campaign.latestBatchId
              ? { batchId: campaign.latestBatchId }
              : {}),
            includeAllStatuses: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load campaign details.");
        }
        setCampaignDetail(data);
        console.log(
          "[Campaign History UI] informational campaign detail loaded",
          {
            campaignId: campaign.campaignId,
            count: Array.isArray(data?.rows) ? data.rows.length : 0,
          },
        );
      } catch (err) {
        console.error("DEBUG: Campaign detail view error:", err);
        if (shopify)
          shopify.toast.show(t("toast.failedLoadCampaignDetails"), {
            isError: true,
          });
        else console.error("BYPASS: Failed to load campaign details");
        setCampaignDetailOpen(false);
        setSelectedCampaignForDetail(null);
        setCampaignDetailPageSize(15);
        setCampaignDetailPage(1);
      } finally {
        setCampaignDetailLoading(false);
      }
    },
    [shopify],
  );

  const openCampaignRevertPreview = useCallback(
    async (campaign: CampaignHistoryItem, retryFailedOnly = false) => {
      if (!campaign.revertable) return;
      console.log("[Campaign Revert] preview opened", {
        campaignId: campaign.campaignId,
        title: campaign.title,
      });
      resetRevertPreviewViewState();
      setSelectedCampaignForRevert(campaign);
      setRevertPreviewRetryFailedOnly(retryFailedOnly);
      setRevertPreviewOpen(true);
      setRevertPreviewLoading(true);
      setRevertPreview(null);
      try {
        const res = await fetch("/api/campaign-revert-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: campaign.campaignId,
            ...(campaign.latestBatchId
              ? { batchId: campaign.latestBatchId }
              : {}),
            ...(retryFailedOnly ? { retryFailedOnly: true } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load revert preview.");
        }
        setRevertPreview(data);
        if (data?.terminal === true) {
          console.log(
            "[Campaign Revert] unrecoverable informational modal shown",
            {
              campaignId: campaign.campaignId,
              message: data?.message ?? null,
            },
          );
        }
      } catch (err) {
        console.error("DEBUG: Campaign Revert Preview Error detail:", err);
        if (shopify)
          shopify.toast.show(t("toast.failedLoadRevertPreview"), {
            isError: true,
          });
        else console.error("BYPASS: Failed to load revert preview");
        setRevertPreviewOpen(false);
        setSelectedCampaignForRevert(null);
        resetRevertPreviewViewState();
      } finally {
        setRevertPreviewLoading(false);
      }
    },
    [resetRevertPreviewViewState, shopify],
  );

  const confirmCampaignRevert = useCallback(async () => {
    if (!selectedCampaignForRevert) return;
    console.log("[Campaign Revert] confirmed", {
      campaignId: selectedCampaignForRevert.campaignId,
      title: selectedCampaignForRevert.title,
    });
    setIsProcessing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/undo-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaignForRevert.campaignId,
          ...(selectedCampaignForRevert.latestBatchId
            ? { batchId: selectedCampaignForRevert.latestBatchId }
            : {}),
          ...(revertPreviewRetryFailedOnly ? { retryFailedOnly: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "BILLING_INACTIVE") {
          throw new Error(
            "Subscription inactive. Please reactivate billing to continue using Price Polish.",
          );
        } else if (data.code === "BILLING_UNKNOWN") {
          throw new Error(
            "Billing status could not be verified. Please refresh the app and try again.",
          );
        } else {
          throw new Error(data.error || "Failed to revert campaign.");
        }
      }
      const terminalReason = selectedCampaignForRevert?.unrecoverableReason;
      if (data?.terminal === true) {
        const terminalMessage = terminalReason
          ? t("server.revertTerminalWithReason").replace(
              "{reason}",
              terminalReason.toLowerCase(),
            )
          : data?.message || t("server.revertTerminalGeneric");
        if (shopify) shopify.toast.show(terminalMessage, { isError: true });
        else console.warn(`BYPASS: ${terminalMessage}`);
      } else if (data?.message) {
        const operationalMessage = terminalReason
          ? t("server.revertOperationalWithReason")
              .replace("{message}", data.message)
              .replace("{reason}", terminalReason)
          : data.message;
        if (shopify) shopify.toast.show(operationalMessage);
        else console.log(`BYPASS: ${operationalMessage}`);
      } else if (data?.restoredCount > 0) {
        if (shopify)
          shopify.toast.show(
            t("server.revertRestoredCount").replace(
              "{count}",
              String(data.restoredCount),
            ),
          );
        else console.log(`BYPASS: Restored ${data.restoredCount} products`);
      } else {
        const noRetryMessage = terminalReason
          ? t("server.revertNoRetryWithReason").replace(
              "{reason}",
              terminalReason.toLowerCase(),
            )
          : t("server.revertNoRetryGeneric");
        if (shopify) shopify.toast.show(noRetryMessage, { isError: true });
        else console.warn(`BYPASS: ${noRetryMessage}`);
      }
      setRevertPreviewOpen(false);
      setSelectedCampaignForRevert(null);
      setRevertPreview(null);
      setRevertPreviewRetryFailedOnly(false);
      resetRevertPreviewViewState();
      await handlePreview();
    } catch (err) {
      console.error("DEBUG: Campaign Revert Error detail:", err);
      const message = err instanceof Error ? err.message : String(err);
      const isBillingError =
        message.includes("Subscription inactive") ||
        message.includes("Billing status could not be verified");
      if (isBillingError) {
        const code: BillingBlockModalCode = message.includes(
          "Subscription inactive",
        )
          ? "BILLING_INACTIVE"
          : "BILLING_UNKNOWN";
        // Close parent revert preview modal before showing billing modal
        setRevertPreviewOpen(false);
        setBillingBlockModalCode(code);
        setBillingBlockModalOpen(true);
      } else if (shopify) {
        shopify.toast.show(message || t("toast.failedRevertCampaign"), {
          isError: true,
        });
      } else {
        console.error("BYPASS: Failed to revert campaign");
      }
    } finally {
      setIsProcessing(false);
    }
  }, [
    handlePreview,
    resetRevertPreviewViewState,
    revertPreviewRetryFailedOnly,
    selectedCampaignForRevert,
    shopify,
  ]);

  const handleRefreshCampaignHistory = useCallback(
    async (showLoading = true) => {
      if (showLoading) setCampaignHistoryLoading(true);
      console.log("[Campaign History UI] manual refresh started");
      try {
        const fetcher = await appFetch;
        const campaignHistoryData = await fetcher("/api/campaign-history");
        const campaigns = Array.isArray(campaignHistoryData?.campaigns)
          ? campaignHistoryData.campaigns
          : [];
        setCampaignHistory(campaigns);
        console.log("[Campaign History UI] manual refresh completed", {
          count: campaigns.length,
        });
        console.log("[Campaign History UI] operational metrics rendered", {
          count: campaigns.length,
        });
      } catch (error) {
        console.error("DEBUG: Campaign History manual refresh failed:", error);
        if (shopify)
          shopify.toast.show(t("toast.failedRefreshCampaignHistory"), {
            isError: true,
          });
        else console.error("BYPASS: Failed to refresh campaign history");
      } finally {
        if (showLoading) setCampaignHistoryLoading(false);
      }
    },
    [appFetch, shopify],
  );

  const handleWindowLifecycleAction = useCallback(
    async (
      campaign: CampaignHistoryItem,
      action: "cancel-schedule" | "stop-window",
    ) => {
      const actionLabel =
        action === "cancel-schedule" ? "cancel schedule" : "stop window";
      setIsProcessing(true);
      try {
        const res = await fetch("/api/window-lifecycle-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: campaign.campaignId,
            action,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Unable to ${actionLabel}.`);
        }
        if (shopify) {
          shopify.toast.show(
            action === "cancel-schedule"
              ? t("dashboard.windowLifecycle.cancelled")
              : t("dashboard.windowLifecycle.stopped"),
          );
        }
        const nextStatus =
          action === "cancel-schedule"
            ? "cancelled-window"
            : (data.status ?? "window-stopped");
        setCampaignHistory((current) =>
          current.map((item) =>
            item.campaignId === campaign.campaignId
              ? {
                  ...item,
                  status: nextStatus,
                  runtimeStatus: nextStatus,
                  revertable: false,
                  ...(action === "stop-window"
                    ? {
                        revertedCount: data.restoredCount ?? item.revertedCount,
                        failedCount: data.failedCount ?? item.failedCount,
                        unrecoverableCount:
                          data.unrecoverableCount ?? item.unrecoverableCount,
                      }
                    : {}),
                }
              : item,
          ),
        );
        if (selectedCampaignForDetail?.campaignId === campaign.campaignId) {
          setSelectedCampaignForDetail({
            ...campaign,
            status: nextStatus,
            runtimeStatus: nextStatus,
            revertable: false,
          });
          setCampaignDetail((current) =>
            current
              ? {
                  ...current,
                  preActivation: false,
                  runtimeStatus: nextStatus,
                  revertedCount:
                    action === "stop-window"
                      ? (data.restoredCount ?? current.revertedCount)
                      : current.revertedCount,
                  failedCount:
                    action === "stop-window"
                      ? (data.failedCount ?? current.failedCount)
                      : current.failedCount,
                  unrecoverableCount:
                    action === "stop-window"
                      ? (data.unrecoverableCount ?? current.unrecoverableCount)
                      : current.unrecoverableCount,
                }
              : current,
          );
        }
        await handlePreview();
      } catch (error) {
        console.error("[Window Lifecycle] action failed", error);
        if (shopify) {
          shopify.toast.show(
            action === "cancel-schedule"
              ? t("dashboard.windowLifecycle.unableCancelWindow")
              : t("dashboard.windowLifecycle.unableStopWindow"),
            { isError: true },
          );
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [handlePreview, selectedCampaignForDetail, shopify],
  );

  const handlePublishLifecycleAction = useCallback(
    async (campaign: CampaignHistoryItem) => {
      setIsProcessing(true);
      try {
        const res = await fetch("/api/publish-lifecycle-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaignId: campaign.campaignId,
            action: "cancel-publish",
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Unable to cancel publish.");
        }
        setCampaignHistory((current) =>
          current.map((item) =>
            item.campaignId === campaign.campaignId
              ? {
                  ...item,
                  status: "cancelled-publish",
                  runtimeStatus: "cancelled-publish",
                  revertable: false,
                }
              : item,
          ),
        );
        if (shopify) shopify.toast.show(t("toast.scheduledPublishCancelled"));
        await handlePreview();
      } catch (error) {
        console.error("[Publish Lifecycle] action failed", error);
        if (shopify)
          shopify.toast.show(t("toast.unableCancelScheduledPublish"), {
            isError: true,
          });
      } finally {
        setIsProcessing(false);
      }
    },
    [handlePreview, shopify],
  );

  const handlePriceChange = useCallback((variantId: string, value: string) => {
    if (value.length > 15) return;
    if (value !== "" && !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;

    setPreviews((prev) =>
      prev.map((item) =>
        item.variantId === variantId
          ? { ...item, overriddenPrice: value }
          : item,
      ),
    );
  }, []);

  const handleDownloadReport = useCallback(async () => {
    if (previews.length === 0) return;

    // Columns: Product | SKU | Price Before | Adjustment | Rounding | New Price | Price Change
    // (Variant ID removed — merchants don't need raw Shopify GIDs.)
    const rows = previews.map((p) => {
      const base = parseShopifyPrice(p.originalBasePrice);
      const final = parseShopifyPrice(
        p.overriddenPrice !== undefined ? p.overriddenPrice : p.newPrice,
      );
      const markupAdded = base * (activeMarkup / 100);
      const roundingAdj = final - (base + markupAdded);
      return {
        title: p.title,
        sku: p.sku ?? "",
        priceBefore: base,
        adjustment: markupAdded,
        rounding: roundingAdj,
        newPrice: final,
        priceChange: final - base,
      };
    });

    try {
      const response = await fetch("/api/export-impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignTitle: applyCampaignTitle,
          currencyCode,
          // Match the report language to the language the UI is rendered in.
          locale: (typeof window !== "undefined" && (window as any).__LOCALE__) || undefined,
          rows,
        }),
      });
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      // price-polish-[campaign-name]-[YYYY-MM].xlsx
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const slug =
        (applyCampaignTitle || "campaign")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "campaign";

      link.href = url;
      link.setAttribute("download", `price-polish-${slug}-${month}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[EXPORT] Impact report download failed", err);
    }
  }, [previews, activeMarkup, currencyCode, applyCampaignTitle]);

  const resetOverride = useCallback((variantId: string) => {
    setPreviews((prev) =>
      prev.map((item) =>
        item.variantId === variantId
          ? { ...item, overriddenPrice: undefined }
          : item,
      ),
    );
  }, []);

  // Unsaved-change protection for inline manual price overrides.
  // `overriddenPrice` is set ONLY by the user (handlePriceChange / resetOverride),
  // never by loading, polling, metrics refresh, or preview re-fetch — so this flag
  // reflects real user edits and becomes false again after any apply (which re-fetches
  // fresh previews via handlePreview). Does NOT affect fetch/submission flows such as
  // Preview, Apply, Publish, Stop Live, or Retry — those are not router navigations.
  const hasManualOverrides = useMemo(
    () => previews.some((p) => p.overriddenPrice !== undefined),
    [previews],
  );
  const [isImmediateApplyDirty, setIsImmediateApplyDirty] = useState(false);
  const [isScheduleDirty, setIsScheduleDirty] = useState(false);
  const {
    blocker: overrideBlocker,
    discardChanges: discardOverrides,
    keepEditing: keepOverrides,
  } = useUnsavedChanges(
    hasManualOverrides || isImmediateApplyDirty || isScheduleDirty,
  );

  // UPDATED: Wrapped with guardNoRules — does NOT change existing handler logic
  const handleGoLiveClick = useCallback(() => {
    if (guardNoRules()) return;
    setShowGoLiveModal(true);
  }, [guardNoRules]);

  // UPDATED: Wrapped with guardNoRules — does NOT change existing handler logic
  const handleStopLiveClick = useCallback(() => {
    if (guardNoRules()) return;
    setShowStopModal(true);
  }, [guardNoRules]);

  const handlePushStorefront = useCallback(
    async (clear = false) => {
      setIsProcessing(true);
      setShowGoLiveModal(false);
      setShowStopModal(false);

      if (clear) {
        // ── Stop Live (no progress tracking needed) ────────────────────────────
        try {
          const res = await fetch("/api/push-storefront", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clear: true }),
          });
          const data = await res.json();
          if (res.ok) {
            if (shopify)
              shopify.toast.show(t("dashboard.pushStorefront.restored"));
            else console.log("BYPASS: Storefront prices restored successfully");
            setMetrics((prev) => ({ ...prev, isLive: false }));
            await handlePreview();
          } else {
            if (!res.ok) {
              throw new Error(
                data.message ??
                  data.error ??
                  t("dashboard.pushStorefront.failedStop"),
              );
            }
          }
        } catch (err) {
          const errorMessage =
            err instanceof Error
              ? err.message
              : t("dashboard.pushStorefront.failedState");
          if (shopify) shopify.toast.show(errorMessage, { isError: true });
          else console.error("BYPASS:", errorMessage);
        } finally {
          setIsProcessing(false);
        }
        return;
      }

      // ── Publish with per-batch progress tracking ───────────────────────────────
      // Total is read from current storefrontControl before the first batch fires.
      const total = storefrontControl.stagedPendingCount;
      setPublishTotal(total);
      setProgress(0);

      // One UUID groups all batch PushJobs into a single logical publish operation.
      // Sent with every batch request so the server can persist it on each PushJob
      // and use it to deduplicate the GO_LIVE activity log entry.
      const operationId = crypto.randomUUID();

      let processed = 0;

      try {
        while (true) {
          const pushBody = {
            clear: false,
            limit: PUBLISH_BATCH_SIZE,
            operationId,
            ...(activeCampaignId ? { campaignId: activeCampaignId } : {}),
          };

          const res = await fetch("/api/push-storefront", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pushBody),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(
              data.message ??
                data.error ??
                t("dashboard.pushStorefront.failedPublish"),
            );
          }

          // Count this batch: successful + failed = processed in this pass
          const batchProcessed = (data.applied ?? 0) + (data.failed ?? 0);
          processed += batchProcessed;

          const pct =
            total > 0
              ? Math.min(Math.round((processed / total) * 100), 99)
              : 50;
          setProgress(pct);

          if (!data.remaining || data.remaining === 0) break;
        }

        setProgress(100);
        if (shopify) shopify.toast.show(t("dashboard.pushStorefront.live"));
        else console.log("BYPASS: Prices are now live on your storefront");
        setMetrics((prev) => ({ ...prev, isLive: true }));
        setActiveCampaignId(null);
        await handlePreview();
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : t("dashboard.pushStorefront.failedState");
        if (shopify) shopify.toast.show(errorMessage, { isError: true });
        else console.error("BYPASS:", errorMessage);
      } finally {
        setIsProcessing(false);
        setProgress(0);
        setPublishTotal(0);
      }
    },
    [
      shopify,
      activeCampaignId,
      handlePreview,
      storefrontControl.stagedPendingCount,
    ],
  );

  const campaignStatusTone = useCallback((status: string) => {
    const normalized = status.toLowerCase();
    if (normalized === "unrecoverable") return "critical" as const;
    if (normalized === "expired-window") return "warning" as const;
    if (
      normalized === "active" ||
      normalized === "active-window" ||
      normalized === "done"
    )
      return "success" as const;
    if (
      normalized === "reverted" ||
      normalized === "auto-restored" ||
      normalized === "window-stopped" ||
      normalized === "cancelled-publish" ||
      normalized === "cancelled-window"
    )
      return "info" as const;
    if (
      normalized === "scheduled" ||
      normalized === "scheduled-window" ||
      normalized === "scheduled-publish" ||
      normalized === "pending"
    )
      return "warning" as const;
    if (normalized === "publishing") return "attention" as const;
    if (normalized === "published") return "success" as const;
    if (normalized === "failed") return "critical" as const;
    return "attention" as const;
  }, []);

  const campaignStatusLabel = useCallback((status: string) => {
    return getStatusLabel(status);
  }, []);

  const detailStatusTone = useCallback((status?: string | null) => {
    const normalized = (status ?? "pending").toLowerCase();
    if (normalized === "reverted") return "success" as const;
    if (normalized === "failed") return "warning" as const;
    if (normalized === "unrecoverable") return "critical" as const;
    return "attention" as const;
  }, []);

  const detailStatusLabel = useCallback((status?: string | null) => {
    if (!status) return t("common.status.pending");
    return getStatusLabel(status);
  }, []);

  const formatDetailScheduleType = useCallback((type?: string | null) => {
    if (type === "time-window")
      return t("dashboard.Schedule.center.timeWindowBadge");
    return t("dashboard.Schedule.center.oneTimePublishBadge");
  }, []);

  const formatTimelineTimestamp = useCallback((value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
  }, []);

  const campaignOperationalTimeline = useMemo<
    CampaignTimelineMilestone[]
  >(() => {
    if (!selectedCampaignForDetail) return [];

    const normalizedStatus = normalizeCampaignStatus(
      selectedCampaignForDetail.status,
    );
    const failedCount =
      campaignDetail?.failedCount ?? selectedCampaignForDetail.failedCount ?? 0;
    const revertCompletedTimestamp =
      normalizedStatus === "reverted"
        ? formatTimelineTimestamp(campaignDetail?.revertCompletedAt ?? null)
        : null;

    const milestones: CampaignTimelineMilestone[] = [
      {
        key: "created",
        label: t("timeline.created.label"),
        tone: "info",
        badgeLabel: t("timeline.created.badge"),
        timestamp: formatTimelineTimestamp(selectedCampaignForDetail.createdAt),
        description: t("timeline.created.description"),
      },
    ];

    if (normalizedStatus === "scheduled-window") {
      milestones.push({
        key: "window-scheduled",
        label: t("timeline.windowScheduled.label"),
        tone: "warning",
        badgeLabel: t("timeline.windowScheduled.badge"),
        timestamp: formatTimelineTimestamp(
          selectedCampaignForDetail.runAt ?? null,
        ),
        description: selectedCampaignForDetail.windowEndAt
          ? t("timeline.windowScheduled.descriptionWithEnd")
          : t("timeline.windowScheduled.descriptionNoEnd"),
      });
    } else if (
      normalizedStatus === "scheduled" ||
      normalizedStatus === "pending"
    ) {
      milestones.push({
        key: "scheduled",
        label: t("timeline.scheduled.label"),
        tone: "warning",
        badgeLabel: t("timeline.scheduled.badge"),
        description: t("timeline.scheduled.description"),
      });
    }

    if (normalizedStatus === "active-window") {
      milestones.push({
        key: "window-activated",
        label: t("timeline.windowActivated.label"),
        tone: "success",
        badgeLabel: t("timeline.windowActivated.badge"),
        timestamp: formatTimelineTimestamp(
          selectedCampaignForDetail.runAt ?? null,
        ),
        description: selectedCampaignForDetail.windowEndAt
          ? t("timeline.windowActivated.descriptionWithEnd")
          : t("timeline.windowActivated.descriptionNoEnd"),
      });
    }

    if (normalizedStatus === "published") {
      milestones.push({
        key: "published",
        label: t("timeline.published.label"),
        tone: failedCount > 0 ? "warning" : "success",
        badgeLabel:
          failedCount > 0
            ? t("timeline.published.badgePartial")
            : t("timeline.published.badgeSuccess"),
        description:
          failedCount > 0
            ? t("timeline.published.descriptionWithFailures")
            : t("timeline.published.descriptionSuccess"),
      });
    } else if (normalizedStatus === "publishing") {
      milestones.push({
        key: "publishing",
        label: t("timeline.publishing.label"),
        tone: "attention",
        badgeLabel: t("timeline.publishing.badge"),
        description: t("timeline.publishing.description"),
      });
    }

    if (normalizedStatus === "auto-restored") {
      milestones.push({
        key: "auto-restored",
        label: t("timeline.autoRestored.label"),
        tone: "info",
        badgeLabel: t("timeline.autoRestored.badge"),
        timestamp: formatTimelineTimestamp(
          campaignDetail?.revertCompletedAt ?? null,
        ),
        description: t("timeline.autoRestored.description"),
      });
    }

    if (normalizedStatus === "window-stopped") {
      milestones.push({
        key: "window-stopped",
        label: t("timeline.windowStopped.label"),
        tone: "info",
        badgeLabel: t("timeline.windowStopped.badge"),
        timestamp: formatTimelineTimestamp(
          campaignDetail?.revertCompletedAt ?? null,
        ),
        description: t("timeline.windowStopped.description"),
      });
    }

    if (normalizedStatus === "cancelled-window") {
      milestones.push({
        key: "cancelled-window",
        label: t("timeline.cancelledWindow.label"),
        tone: "info",
        badgeLabel: t("timeline.cancelledWindow.badge"),
        timestamp: formatTimelineTimestamp(
          selectedCampaignForDetail.runAt ?? null,
        ),
        description: t("timeline.cancelledWindow.description"),
      });
    }

    if (normalizedStatus === "cancelled-publish") {
      milestones.push({
        key: "cancelled-publish",
        label: t("timeline.cancelledPublish.label"),
        tone: "info",
        badgeLabel: t("timeline.cancelledPublish.badge"),
        timestamp: formatTimelineTimestamp(
          selectedCampaignForDetail.runAt ?? null,
        ),
        description: t("timeline.cancelledPublish.description"),
      });
    }

    if (normalizedStatus === "failed") {
      milestones.push({
        key: "failed",
        label: t("timeline.failed.label"),
        tone: "critical",
        badgeLabel: t("timeline.failed.badge"),
        description: t("timeline.failed.description"),
      });
    }

    if (normalizedStatus === "partial") {
      milestones.push({
        key: "partial",
        label: t("timeline.partial.label"),
        tone: "warning",
        badgeLabel: t("timeline.partial.badge"),
        description: t("timeline.partial.description"),
      });
    }

    if (normalizedStatus === "unrecoverable") {
      milestones.push({
        key: "unrecoverable",
        label: t("timeline.unrecoverable.label"),
        tone: "critical",
        badgeLabel: t("timeline.unrecoverable.badge"),
        timestamp: formatTimelineTimestamp(
          campaignDetail?.revertCompletedAt ?? null,
        ),
        description: selectedCampaignForDetail.unrecoverableReason
          ? t("timeline.unrecoverable.descriptionWithReason").replace(
              "{reason}",
              selectedCampaignForDetail.unrecoverableReason,
            )
          : t("timeline.unrecoverable.description"),
      });
    }

    if (normalizedStatus === "reverted") {
      milestones.push({
        key: "reverted",
        label: t("timeline.reverted.label"),
        tone: "success",
        badgeLabel: t("timeline.reverted.badge"),
        timestamp: revertCompletedTimestamp,
        description: t("timeline.reverted.description"),
      });
    }

    return milestones;
  }, [campaignDetail, formatTimelineTimestamp, selectedCampaignForDetail]);

  const compactVariantIdentifier = useCallback((variantId: string) => {
    const normalized = variantId.trim();
    if (normalized.length === 0) return "Variant: -";
    if (normalized.startsWith("gid://")) {
      return `gid://...${normalized.slice(-6)}`;
    }
    if (normalized.length > 16) {
      return `Variant: ...${normalized.slice(-8)}`;
    }
    return `Variant: ${normalized}`;
  }, []);

  const campaignHistoryCounts = useMemo(() => {
    return campaignHistory.reduce(
      (acc, campaign) => {
        const status = resolveCampaignRuntimeStatus(
          campaign,
          campaignRuntimeNow,
        );
        if (
          status === "active" ||
          status === "active-window" ||
          status === "published"
        ) {
          acc.active += 1;
        } else if (status === "partial") {
          acc.partial += 1;
        } else if (
          status === "scheduled" ||
          status === "scheduled-window" ||
          status === "scheduled-publish" ||
          status === "publishing" ||
          status === "pending"
        ) {
          acc.scheduled += 1;
        } else if (isClosedCampaignStatus(status)) {
          acc.closed += 1;
        }
        return acc;
      },
      { active: 0, partial: 0, scheduled: 0, closed: 0 },
    );
  }, [campaignHistory, campaignRuntimeNow]);

  const handleCampaignHistoryStatusFilterChange = useCallback(
    (value: string) => {
      const nextValue = value as CampaignHistoryStatusFilter;
      setCampaignHistoryStatusFilter(nextValue);
      console.log("[Campaign History UI] campaign history filter changed", {
        statusFilter: nextValue,
      });
    },
    [],
  );

  const handleCampaignHistorySourceFilterChange = useCallback(
    (value: string) => {
      const nextValue = value as CampaignHistorySourceFilter;
      setCampaignHistorySourceFilter(nextValue);
      console.log("[Campaign History UI] campaign history filter changed", {
        sourceFilter: nextValue,
      });
    },
    [],
  );

  const handleCampaignHistoryTimeframeFilterChange = useCallback(
    (value: string) => {
      setCampaignHistoryTimeframeFilter(
        value as CampaignHistoryTimeframeFilter,
      );
      console.log("[Campaign History UI] campaign history timeframe changed", {
        timeframe: value,
      });
    },
    [],
  );

  const handleCampaignHistorySearchChange = useCallback((value: string) => {
    if (value.length > 120) return;
    setCampaignHistorySearchQuery(value);
    console.log("[Campaign History UI] campaign history search applied", {
      query: value.trim(),
    });
  }, []);

  const filteredCampaignHistory = useMemo(() => {
    const normalizedQuery = campaignHistorySearchQuery.trim().toLowerCase();

    return campaignHistory.filter((campaign) => {
      const status = resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow);
      const source = normalizeCampaignSource(campaign.source);
      const title = campaign.title.toLowerCase();
      const campaignId = campaign.campaignId.toLowerCase();
      const timeframeStart = getTimeframeStart(
        campaignHistoryTimeframeFilter,
        campaignRuntimeNow,
      );
      const campaignCreatedAt = new Date(campaign.createdAt).getTime();
      const matchesTimeframe =
        !timeframeStart ||
        (!Number.isNaN(campaignCreatedAt) &&
          campaignCreatedAt >= timeframeStart.getTime());

      const matchesStatus = (() => {
        if (campaignHistoryStatusFilter === "all") return true;
        if (campaignHistoryStatusFilter === "active")
          return (
            status === "active" ||
            status === "active-window" ||
            status === "published"
          );
        if (campaignHistoryStatusFilter === "partial")
          return status === "partial";
        if (campaignHistoryStatusFilter === "scheduled")
          return (
            status === "scheduled" ||
            status === "scheduled-window" ||
            status === "scheduled-publish" ||
            status === "publishing" ||
            status === "pending"
          );
        return isClosedCampaignStatus(status);
      })();

      const matchesSource =
        campaignHistorySourceFilter === "all" ||
        source === campaignHistorySourceFilter;

      const matchesSearch =
        normalizedQuery.length === 0 ||
        title.includes(normalizedQuery) ||
        campaignId.includes(normalizedQuery);

      return (
        matchesTimeframe && matchesStatus && matchesSource && matchesSearch
      );
    });
  }, [
    campaignHistory,
    campaignHistorySearchQuery,
    campaignHistorySourceFilter,
    campaignHistoryStatusFilter,
    campaignHistoryTimeframeFilter,
    campaignRuntimeNow,
  ]);

  const visibleCampaignHistory = useMemo(() => {
    if (!hideClosedCampaigns) return filteredCampaignHistory;
    const visible = filteredCampaignHistory.filter(
      (campaign) => !isClosedCampaignStatus(campaign.status),
    );
    console.log("[Campaign History UI] closed campaigns hidden", {
      hiddenCount: filteredCampaignHistory.length - visible.length,
      total: filteredCampaignHistory.length,
    });
    return visible;
  }, [filteredCampaignHistory, hideClosedCampaigns]);

  const campaignHistorySummary = useMemo(() => {
    return visibleCampaignHistory.reduce(
      (acc, campaign) => {
        const status = resolveCampaignRuntimeStatus(
          campaign,
          campaignRuntimeNow,
        );
        if (
          status === "active" ||
          status === "active-window" ||
          status === "published"
        ) {
          acc.active += 1;
        } else if (status === "partial") {
          acc.partial += 1;
        } else if (isClosedCampaignStatus(status)) {
          acc.closed += 1;
        }
        return acc;
      },
      { active: 0, partial: 0, closed: 0 },
    );
  }, [campaignRuntimeNow, visibleCampaignHistory]);

  const campaignHistoryStatusOptions = useMemo(
    () => [
      { label: `${SELECT_OPTION_PREFIX}All`, value: "all" },
      {
        label: `${SELECT_OPTION_PREFIX}Active (${campaignHistoryCounts.active})`,
        value: "active",
      },
      {
        label: `${SELECT_OPTION_PREFIX}Partial (${campaignHistoryCounts.partial})`,
        value: "partial",
      },
      { label: `${SELECT_OPTION_PREFIX}Scheduled`, value: "scheduled" },
      { label: `${SELECT_OPTION_PREFIX}Closed`, value: "closed" },
    ],
    [campaignHistoryCounts.active, campaignHistoryCounts.partial],
  );

  const campaignHistorySourceOptions = useMemo(
    () => [
      { label: `${SELECT_OPTION_PREFIX}All Sources`, value: "all" },
      { label: `${SELECT_OPTION_PREFIX}Manual`, value: "manual" },
      { label: `${SELECT_OPTION_PREFIX}Scheduled`, value: "scheduled" },
      { label: `${SELECT_OPTION_PREFIX}Time Window`, value: "time-window" },
    ],
    [],
  );

  const campaignHistoryTimeframeOptions = useMemo(
    () => [
      { label: `${SELECT_OPTION_PREFIX}Current Week`, value: "week" },
      { label: `${SELECT_OPTION_PREFIX}Current Month`, value: "month" },
      { label: `${SELECT_OPTION_PREFIX}Last 3 Months`, value: "3_months" },
      { label: `${SELECT_OPTION_PREFIX}Last 6 Months`, value: "6_months" },
      { label: `${SELECT_OPTION_PREFIX}This Year`, value: "year" },
      { label: `${SELECT_OPTION_PREFIX}All Time`, value: "all" },
    ],
    [],
  );

  const campaignHistoryEmptyStateMessage = useMemo(() => {
    if (campaignHistory.length === 0) return "No campaigns recorded yet.";

    if (filteredCampaignHistory.length === 0) {
      if (campaignHistoryStatusFilter === "active")
        return "No active campaigns found.";
      if (campaignHistoryStatusFilter === "partial")
        return "No partial campaigns found.";
      if (campaignHistoryStatusFilter === "scheduled")
        return "No scheduled campaigns found.";
      if (campaignHistoryStatusFilter === "closed")
        return "No closed campaigns found.";
      return "No campaigns match the current filters.";
    }

    if (hideClosedCampaigns && visibleCampaignHistory.length === 0) {
      return "All matching campaigns are closed. Turn off Hide Closed Campaigns to view them.";
    }

    return "No campaigns match the current filters.";
  }, [
    campaignHistory.length,
    filteredCampaignHistory.length,
    campaignHistoryStatusFilter,
    hideClosedCampaigns,
    visibleCampaignHistory.length,
  ]);

  useEffect(() => {
    if (!campaignHistoryExpanded) return;
    void handleRefreshCampaignHistory(false);
  }, [campaignHistoryExpanded, handleRefreshCampaignHistory]);

  const toggleCampaignHistoryExpanded = useCallback(() => {
    setCampaignHistoryExpanded((prev) => {
      const next = !prev;
      console.log(
        next ? "campaign history expanded" : "campaign history collapsed",
      );
      return next;
    });
  }, []);

  const toggleSelection = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    const visibleIds = paginatedPreviews.map((p) => p.variantId);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const insights = useMemo(() => {
    let totalOld = 0;
    let totalNew = 0;
    let count = 0;

    previews.forEach((p) => {
      const oldP = parseShopifyPrice(p.oldPrice);
      const newP =
        p.overriddenPrice !== undefined
          ? parseShopifyPrice(p.overriddenPrice)
          : parseShopifyPrice(p.newPrice);
      if (oldP !== newP) {
        totalOld += oldP;
        totalNew += newP;
        count++;
      }
    });

    const lift = totalNew - totalOld;
    const liftPercent = totalOld !== 0 ? (lift / totalOld) * 100 : 0;
    return { lift, liftPercent, count };
  }, [previews]);

  console.log(
    `DEBUG: Render Cycle - previews.length: ${previews.length}, loading: ${loading}`,
  );

  const handleMinPriceChange = useCallback((value: string) => {
    if (value.length > 15) return;
    if (value !== "" && !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;
    setMinPrice(value);
  }, []);

  const handleMaxPriceChange = useCallback((value: string) => {
    if (value.length > 15) return;
    if (value !== "" && !/^\d{0,6}(\.\d{0,2})?$/.test(value)) return;
    setMaxPrice(value);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    if (value.length > 100) return;
    setSearchQuery(value);
  }, []);

  const totalPages = Math.ceil(filteredPreviews.length / PAGE_SIZE);

  const paginatedPreviews = useMemo(() => {
    console.count("Preview Dataset Recompute");
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredPreviews.slice(start, start + PAGE_SIZE);
  }, [filteredPreviews, currentPage]);

  const totalBatches = useMemo(
    () => Math.ceil(previews.length / BATCH_SIZE),
    [previews],
  );

  const formatRecentActivityProductCount = useCallback((count: number) => {
    if (count === 1) {
      return t("dashboard.recentActivity.productCountOne");
    }
    return t("dashboard.recentActivity.productCountMany").replace(
      "{count}",
      String(count),
    );
  }, []);

  const timeAgo = useCallback((dateStr: string) => {
    if (!dateStr) return "—";
    const nowMs = Date.now();
    const targetMs = new Date(dateStr).getTime();
    if (Number.isNaN(targetMs)) return t("common.time.unknownTiming");

    const diffMs = nowMs - targetMs;
    const absMinutes = Math.round(Math.abs(diffMs) / (1000 * 60));

    if (absMinutes < 1) return t("common.time.now");
    if (absMinutes < 60) {
      return t("common.time.minutesAgo").replace("{count}", String(absMinutes));
    }

    const absHours = Math.round(absMinutes / 60);
    if (absHours < 24) {
      return t("common.time.hoursAgo").replace("{count}", String(absHours));
    }

    const absDays = Math.round(absHours / 24);
    return absDays === 1
      ? t("common.time.daysAgoOne")
      : t("common.time.daysAgoMany").replace("{count}", String(absDays));
  }, []);

  const SHOW_DEBUG_TOOLS = false;
  const isInitialDashboardLoad = loading && ruleExists === null;
  const showDashboardLoader = useDelayedVisibility(isInitialDashboardLoad, 300);

  // UPDATED: Loading guard — prevents flicker of "No Pricing Rules Found" before data arrives
  // ruleExists === null means first fetch hasn't completed yet
  if (isInitialDashboardLoad) {
    return showDashboardLoader ? (
      <DashboardLoader />
    ) : (
      <div
        style={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spinner size="large" />
      </div>
    );
  }

  return (
    <>
      {/* ADDED: Global styles */}
      <style>{`
        :root {
          --pp-primary: #008060;
          --pp-success: #16a34a;
          --pp-danger: #dc2626;
          --pp-warning: #f59e0b;
          --pp-text: #111827;
          --pp-bg: #f9fafb;
          --pp-card: #ffffff;
          --pp-border: #e5e7eb;
        }

        .Polaris-Page { background-color: var(--pp-bg); }
        .Polaris-Card { border: 1px solid var(--pp-border) !important; background-color: var(--pp-card) !important; color: var(--pp-text) !important; }
        .Polaris-Text--headingLg { color: var(--pp-text); font-weight: 700; }

        .Polaris-Button--toneSuccess.Polaris-Button--variantPrimary { background: var(--pp-success) !important; }
        .Polaris-Button--toneCritical.Polaris-Button--variantPrimary { background: var(--pp-danger) !important; }

      `}</style>

      <Page
        title={t("common.dashboard")}
        titleMetadata={<Icon source={HomeIcon} tone="base" />}
        fullWidth
      >
        <div style={{ width: "100%" }}>
          <BlockStack gap="300">
            {/* Debug Tools */}
            {SHOW_DEBUG_TOOLS && (
              <>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      System Health & Diagnostics
                    </Text>
                    <Divider />
                    <BlockStack gap="200">
                      <InlineStack gap="300" align="space-between">
                        <Text as="span" variant="bodyMd">
                          Is Embedded in Iframe:
                        </Text>
                        <Badge
                          tone={
                            typeof window !== "undefined" &&
                            window.top !== window.self
                              ? "success"
                              : "critical"
                          }
                        >
                          {typeof window !== "undefined" &&
                          window.top !== window.self
                            ? "YES (Safe)"
                            : "NO (Warning: App Domain Context)"}
                        </Badge>
                      </InlineStack>
                      <InlineStack gap="300" align="space-between">
                        <Text as="span" variant="bodyMd">
                          App Bridge Handshake:
                        </Text>
                        <Badge tone={currencyCode ? "success" : "attention"}>
                          {currencyCode ? "Connected" : "Initializing..."}
                        </Badge>
                      </InlineStack>
                      <InlineStack gap="300" align="space-between">
                        <Text as="span" variant="bodyMd">
                          Detected Shop Context:
                        </Text>
                        <Text as="span" variant="bodyMd">
                          {shop || "Unknown"}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                    <Banner tone="info">
                      <p>
                        If <strong>{t("common.isEmbedded")}</strong> is NO, the
                        app is running on its own domain instead of{" "}
                        <code>admin.shopify.com</code>. This will cause App
                        Bridge origin mismatches.
                      </p>
                    </Banner>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      System Status (Debug)
                    </Text>
                    <InlineStack gap="300">
                      <Text as="p">
                        Previews: <strong>{previews.length}</strong>
                      </Text>
                      <Text as="p">
                        Filtered: <strong>{filteredPreviews.length}</strong>
                      </Text>
                      <Text as="p">
                        Loading: <strong>{loading ? "YES" : "NO"}</strong>
                      </Text>
                      <Text as="p">
                        Currency: <strong>{currencyCode}</strong>
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </>
            )}

            {/* Shopify Markets warning — base currency only */}
            {hasMultipleMarkets && (
              <Banner tone="warning">
                <p>{t("dashboard.marketsWarning")}</p>
              </Banner>
            )}

            {/* Billing Upsell */}
            {!hasActivePlan && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="100" blockAlign="center">
                    <Icon source={CreditCardIcon} tone="base" />
                    <Text as="h3" variant="headingMd">
                      {t("dashboard.billingUpsell.title")}
                    </Text>
                  </InlineStack>
                  <Text as="p">{t("dashboard.billingUpsell.body")}</Text>
                  <InlineStack gap="200">
                    <Badge tone="success">{t("pricing.bulkPricing")}</Badge>
                    <Badge tone="success">{t("pricing.undoAnytime")}</Badge>
                    <Badge tone="success">{t("pricing.liveStoreSync")}</Badge>
                  </InlineStack>
                  {/* UPDATED: variant="primary" — Task 5 hierarchy */}
                  <Button
                    variant="primary"
                    tone="success"
                    onClick={handleUpgrade}
                  >
                    {t("dashboard.billingUpsell.cta")}
                  </Button>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("dashboard.billingUpsell.noCharge")}
                  </Text>
                </BlockStack>
              </Card>
            )}

            {/* Store Health Card */}
            <StoreHealthCard
              isLive={metrics.isLive}
              stagedPendingCount={storefrontControl.stagedPendingCount}
              pendingRetryCount={storefrontControl.pendingRetryCount}
              scheduledRunsCount={metrics.scheduledRunsCount}
              latestInfluenceAt={storefrontControl.latestInfluenceAt}
            />

            {/* Needs Attention */}
            {/* {(storefrontControl.pendingRetryCount > 0 ||
              storefrontControl.retryableRevertCount > 0 ||
              storefrontControl.unrecoverableCount > 0) && (
             <Card>
                <div
                  style={{
                    padding: "20px 24px",
                    borderRadius: "12px",
                    background:
                      "linear-gradient(135deg, var(--p-color-bg-surface-warning, #FFF6E0) 0%, var(--p-color-bg-surface, #FFFFFF) 100%)",
                    border: "1px solid var(--p-color-border-warning, #E0A800)",
                  }}
                >
                  { <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center" gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            background: "var(--p-color-bg-surface-warning, #FFE8C0)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Icon source={InfoIcon} tone="caution" />
                        </div>
                        <BlockStack gap="025">
                          <Text as="h2" variant="headingSm" fontWeight="semibold">
                          ⚠ Ready to Publish
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {storefrontControl.pendingRetryCount > 0
                              ? `${storefrontControl.pendingRetryCount} product${storefrontControl.pendingRetryCount === 1 ? "" : "s"} waiting to publish`
                              : storefrontControl.retryableRevertCount > 0
                                ? `${storefrontControl.retryableRevertCount} recoverable issue${storefrontControl.retryableRevertCount === 1 ? "" : "s"}`
                                : `${storefrontControl.unrecoverableCount} product${storefrontControl.unrecoverableCount === 1 ? "" : "s"}` }
                          </Text>
                        </BlockStack>
                      </InlineStack>
                      {storefrontControl.pendingRetryCount > 0 && (
                        <Button
                          variant="primary"
                          onClick={handlePushStorefront}
                          loading={isProcessing}
                          disabled={isProcessing}
                        >
                          Publish Changes →
                        </Button>
                      )}
                    </InlineStack>
                  </BlockStack> }
                </div>
              </Card>
            )} */}

            {/* Live Mode Warning */}
            {metrics.isLive && (
              <div
                style={{
                  background:
                    "linear-gradient(90deg, #FFF3CD 0%, #FFD966 100%)", // soft yellow gradient
                  borderRadius: "8px",
                  padding: "12px",
                }}
              >
                <Banner tone="warning">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      <strong>{t("dashboard.liveModeWarning.title")}</strong>{" "}
                      {t("dashboard.liveModeWarning.body")}
                    </Text>
                  </BlockStack>
                </Banner>
              </div>
            )}

            {/* Error / Success Message */}
            {message && (
              <Banner
                title={message.text}
                tone={message.type}
                onDismiss={() => setMessage(null)}
              >
                <div
                  style={{
                    background:
                      message.type === "warning"
                        ? "linear-gradient(90deg, #FFF3CD 0%, #FFD966 100%)" // warm yellow gradient
                        : message.type === "info"
                          ? "linear-gradient(90deg, #E0F7FA 0%, #80DEEA 100%)" // soft blue gradient
                          : message.type === "critical"
                            ? "linear-gradient(90deg, #FDECEA 0%, #F5C6CB 100%)" // pale red gradient
                            : "linear-gradient(90deg, #E8F5E9 0%, #A5D6A7 100%)", // green for success
                    borderRadius: "8px",
                    padding: "12px",
                  }}
                >
                  {message.details && <p>{message.details}</p>}
                </div>
              </Banner>
            )}

            {/* Storefront Operations Overview */}
            {previews.length > 0 && (
              <Box paddingBlockEnd="200">
                <Grid>
                  {/* Card 1: Adjusted columnSpan to 4 on sm and up */}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                    <Card>
                      <Box
                        padding="300"
                        background={
                          previews.reduce(
                            (sum, p) =>
                              sum +
                              (parseShopifyPrice(p.overriddenPrice || p.newPrice) -
                                parseShopifyPrice(p.originalBasePrice)),
                            0,
                          ) >= 0
                            ? "bg-surface-success"
                            : "bg-surface-critical"
                        }
                        borderRadius="200"
                      >
                        <BlockStack gap="050" align="start">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("dashboard.metrics.pricingImpact")}
                          </Text>
                          <Text
                            as="p"
                            variant="headingLg"
                            fontWeight="semibold"
                            tone={
                              previews.reduce(
                                (sum, p) =>
                                  sum +
                                  (parseShopifyPrice(p.overriddenPrice || p.newPrice) -
                                    parseShopifyPrice(p.originalBasePrice)),
                                0,
                              ) >= 0
                                ? "success"
                                : "critical"
                            }
                          >
                            {(() => {
                              const lift = previews.reduce(
                                (sum, p) =>
                                  sum +
                                  (parseShopifyPrice(p.overriddenPrice || p.newPrice) -
                                    parseShopifyPrice(p.originalBasePrice)),
                                0,
                              );
                              const sign = lift > 0 ? "+" : lift < 0 ? "-" : "";
                              return `${sign}${formatMoney(Math.abs(lift), currencyCode)}`;
                            })()}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("dashboard.metrics.projectedDelta")}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>
                  </Grid.Cell>

                  {/* Card 2: Adjusted columnSpan to 4 on sm and up */}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                    <Card>
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="050" align="start">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("dashboard.metrics.activeCampaigns")}
                          </Text>
                          <Text
                            as="p"
                            variant="headingLg"
                            fontWeight="semibold"
                          >
                            {metrics.activeCampaignsCount}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("dashboard.metrics.affectingStorefront")}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>
                  </Grid.Cell>

                  {/* Card 3: Adjusted columnSpan to 4 on sm and up */}
                  <Grid.Cell columnSpan={{ xs: 6, sm: 4, md: 4, lg: 4, xl: 4 }}>
                    <Card>
                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                      >
                        <BlockStack gap="050" align="start">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("dashboard.metrics.productsAutomated")}
                          </Text>
                          <Text
                            as="p"
                            variant="headingLg"
                            fontWeight="semibold"
                          >
                            {metrics.productsUnderAutomationCount}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("dashboard.metrics.underWorkflows")}
                          </Text>
                        </BlockStack>
                      </Box>
                    </Card>
                  </Grid.Cell>
                </Grid>
              </Box>
            )}

            <BlockStack gap="500">
              {/* Dashboard Top Row */}
              <Grid>
                {/* 1. RECENT ACTIVITY CARD */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <div
                          style={{
                            height: "28px",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <Text
                            as="h3"
                            variant="headingSm"
                            fontWeight="semibold"
                          >
                            {t("dashboard.recentActivity.title")}
                          </Text>
                        </div>
                        <Button
                          size="slim"
                          variant="tertiary"
                          onClick={() => navigate("/app/campaign-history")}
                        >
                          {t("dashboard.recentActivity.viewAll")}
                        </Button>
                      </InlineStack>

                      {/* Forced uniform height using an explicit height value */}
                      <div
                        style={{
                          backgroundColor: "rgba(0, 82, 124, 0.03)",
                          border: "1px solid rgba(0, 82, 124, 0.15)",
                          borderRadius: "8px",
                          padding: "10px 16px",
                          height: "142px", // Fixed height to guarantee symmetry
                          overflowY: "auto", // Handles fallback if your list grows longer
                        }}
                      >
                        {campaignHistory.length === 0 ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t("dashboard.recentActivity.noCampaigns")}
                          </Text>
                        ) : (
                          <BlockStack gap="150">
                            {campaignHistory.slice(0, 4).map((c, index) => {
                              const tone = campaignStatusTone(c.status);
                              const label = getStatusLabel(c.status);
                              return (
                                <div key={c.campaignId}>
                                  <InlineStack
                                    align="space-between"
                                    blockAlign="center"
                                    gap="300"
                                  >
                                    <InlineStack gap="200" blockAlign="center">
                                      <Text
                                        as="span"
                                        variant="bodySm"
                                        fontWeight="medium"
                                      >
                                        {c.title}
                                      </Text>
                                      <Text
                                        as="span"
                                        tone="subdued"
                                        variant="bodyXs"
                                      >
                                        •
                                      </Text>
                                      <Text
                                        as="span"
                                        variant="bodySm"
                                        tone="subdued"
                                      >
                                        {`${formatRecentActivityProductCount(c.productCount)} • ${c.createdAt ? timeAgo(c.createdAt) : "—"}`}
                                      </Text>
                                    </InlineStack>
                                    <Badge tone={tone} size="small">
                                      {label}
                                    </Badge>
                                  </InlineStack>

                                  {index <
                                    campaignHistory.slice(0, 4).length - 1 && (
                                    <div
                                      style={{
                                        marginBlockStart: "6px",
                                        marginBlockEnd: "6px",
                                        borderTop:
                                          "1px solid rgba(0, 82, 124, 0.06)",
                                      }}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </BlockStack>
                        )}
                      </div>
                    </BlockStack>
                  </Card>
                </Grid.Cell>

                {/* 2. QUICK ACTIONS CARD */}
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 2, lg: 2, xl: 2 }}>
                  <Card>
                    <BlockStack gap="200">
                      <div
                        style={{
                          height: "28px",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <InlineStack gap="100" blockAlign="center">
                          <Icon source={HomeIcon} tone="base" />
                          <Text as="h3" variant="headingSm" fontWeight="semibold">
                            {t("dashboard.quickActions.title")}
                          </Text>
                        </InlineStack>
                      </div>

                      {/* Matches the left container's background style and height perfectly */}
                      <div
                        style={{
                          backgroundColor: "rgba(0, 82, 124, 0.03)",
                          border: "1px solid rgba(0, 82, 124, 0.15)",
                          borderRadius: "8px",
                          padding: "10px 16px",
                          height: "142px", // Exactly matches Recent Activity's height
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center", // Vertically centers buttons within the frame
                        }}
                      >
                        <BlockStack gap="150">
                          <Button
                            variant="primary"
                            size="slim"
                            icon={PriceListIcon}
                            onClick={() => navigate("/app/rules")}
                            fullWidth
                          >
                            {t("dashboard.quickActions.configureRules")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="slim"
                            icon={SearchIcon}
                            onClick={() => navigate("/app/preview")}
                            fullWidth
                          >
                            {t("dashboard.quickActions.previewPrices")}
                          </Button>
                          <Button
                            variant="tertiary"
                            size="slim"
                            icon={ClockIcon}
                            onClick={() => navigate("/app/campaign-history")}
                            fullWidth
                          >
                            {t("dashboard.quickActions.campaignHistory")}
                          </Button>
                        </BlockStack>
                      </div>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              </Grid>

              {/* Warning Banner Row */}
              {!hasRules && ruleExists !== null && (
                <Banner tone="warning" title={t("errors.noPricingRulesFound")}>
                  <BlockStack gap="200">
                    <p>{t("dashboard.noRulesBanner.body")}</p>
                    <InlineStack>
                      <Button
                        variant="primary"
                        tone="success"
                        size="slim"
                        onClick={() => navigate("/app/rules")}
                      >
                        {t("dashboard.noRulesBanner.cta")}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Banner>
              )}

              {/* Storefront Control Panel Row */}
              <div
                style={{
                  opacity: !hasRules ? 0.6 : 1,
                  transition: "opacity 0.2s ease",
                  pointerEvents: !hasRules ? "none" : "auto",
                }}
              >
                <Card padding="0">
                  <div
                    style={{
                      /* Soft status-driven background tint mimicking the premium store health look */
                      backgroundColor: metrics.isLive
                        ? "rgba(10, 128, 93, 0.04)"
                        : "rgba(181, 137, 0, 0.05)",
                      border: metrics.isLive
                        ? "1px solid rgba(10, 128, 93, 0.15)"
                        : "1px solid rgba(181, 137, 0, 0.2)",
                      borderRadius: "12px",
                      padding: "16px 20px",
                    }}
                  >
                    <BlockStack gap="200">
                      {/* Top Info Header Line */}
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        gap="300"
                        wrap
                      >
                        <div style={{ flex: "1 1 500px" }}>
                          <BlockStack gap="050">
                            <InlineStack gap="100" blockAlign="center">
                              <Text
                                as="h3"
                                variant="headingSm"
                                fontWeight="semibold"
                              >
                                {t("dashboard.storefrontControl.title")}
                              </Text>
                              <Tooltip
                                content={t(
                                  "dashboard.storefrontControl.tooltip",
                                )}
                              >
                                <span
                                  style={{
                                    cursor: "pointer",
                                    display: "inline-flex",
                                  }}
                                >
                                  <Icon source={InfoIcon} tone="subdued" />
                                </span>
                              </Tooltip>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("dashboard.storefrontControl.body")}
                            </Text>
                          </BlockStack>
                        </div>

                        {/* Status Badge Group */}
                        <InlineStack gap="150" blockAlign="center">
                          <Badge
                            tone={metrics.isLive ? "success" : "attention"}
                            size="small"
                          >
                            {metrics.isLive
                              ? t("dashboard.storefrontControl.live")
                              : t("dashboard.storefrontControl.paused")}
                          </Badge>
                          <Text
                            as="span"
                            variant="bodySm"
                            fontWeight="medium"
                            tone={metrics.isLive ? "success" : "subdued"}
                          >
                            {metrics.isLive
                              ? t("dashboard.storefrontControl.liveActive")
                              : t("dashboard.storefrontControl.livePaused")}
                          </Text>
                        </InlineStack>
                      </InlineStack>

                      {/* Action Button Strip */}
                      <InlineStack gap="200" blockAlign="center" wrap>
                        {metrics.isLive ? (
                          <Button
                            onClick={handleStopLiveClick}
                            disabled={isProcessing || !hasRules}
                            tone="critical"
                            variant="primary"
                            size="slim"
                          >
                            {t("dashboard.storefrontControl.pauseLivePricing")}
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            tone="success"
                            onClick={handleGoLiveClick}
                            loading={isProcessing}
                            disabled={
                              isProcessing ||
                              !hasRules ||
                              !storefrontControl.canGoLive ||
                              (storefrontControl.stagedPendingCount ?? 0) <= 0
                            }
                            size="slim"
                          >
                            {t("dashboard.storefrontControl.publishPricing")}
                          </Button>
                        )}
                        <Text as="span" variant="bodySm" tone="subdued">
                          {storefrontControl.goLiveMessage}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </div>
                </Card>
              </div>

              {/* Empty Products State Row */}
              {!loading && previews.length === 0 && (
                <Card>
                  <div
                    style={{
                      backgroundColor: "rgba(0, 82, 124, 0.03)",
                      border: "1px solid rgba(0, 82, 124, 0.12)",
                      borderRadius: "12px",
                      padding: "24px",
                    }}
                  >
                    <BlockStack gap="200" align="center">
                      <Text as="h2" variant="headingSm" fontWeight="semibold">
                        {t("dashboard.emptyProducts.title")}
                      </Text>
                      <Text
                        as="p"
                        variant="bodySm"
                        tone="subdued"
                        alignment="center"
                      >
                        {t("dashboard.emptyProducts.body")}
                      </Text>
                      <Button
                        variant="primary"
                        size="slim"
                        onClick={handlePreview}
                      >
                        {t("dashboard.emptyProducts.cta")}
                      </Button>
                    </BlockStack>
                  </div>
                </Card>
              )}
            </BlockStack>

            {/* ── TASK 1 + 6: Apply / Batch panel — opacity-dimmed and disabled when no rules ── */}
            {/* UPDATED: pointer-events blocked at wrapper level as an extra safety layer */}
            <div
              style={{
                opacity: !hasRules ? 0.6 : 1,
                transition: "opacity 0.2s ease",
                pointerEvents: !hasRules ? "none" : "auto",
              }}
            >
              <Box paddingBlockEnd="300">
                <BlockStack gap="200">
                  {/* 🔹 2. FILTER CARD */}

                  <Card padding="300">
                    <BlockStack gap="200">
                      {/* Clean, low-profile header row */}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text
                          as="h3"
                          variant="headingSm"
                          fontWeight="semibold"
                          tone="subdued"
                        >
                          {t("dashboard.filters.title")}
                        </Text>
                      </InlineStack>

                      {/* Anchored Control Bar with a subtle background to pop on the screen */}
                      <Box
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                      >
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          gap="300"
                          wrap
                        >
                          {/* Left side: Tabbed Quick Segments */}
                          <InlineStack gap="100" blockAlign="center">
                            <Button
                              size="slim"
                              variant={
                                activeFilter === "all"
                                  ? "secondary"
                                  : "tertiary"
                              }
                              pressed={activeFilter === "all"}
                              onClick={() => setActiveFilter("all")}
                            >
                              {t("dashboard.filters.all")}
                            </Button>
                            <Button
                              size="slim"
                              variant={
                                activeFilter === "increase"
                                  ? "secondary"
                                  : "tertiary"
                              }
                              pressed={activeFilter === "increase"}
                              onClick={() => setActiveFilter("increase")}
                            >
                              {t("dashboard.filters.priceIncrease")}
                            </Button>
                            <Button
                              size="slim"
                              variant={
                                activeFilter === "decrease"
                                  ? "secondary"
                                  : "tertiary"
                              }
                              pressed={activeFilter === "decrease"}
                              onClick={() => setActiveFilter("decrease")}
                            >
                              {t("dashboard.filters.priceDecrease")}
                            </Button>
                            <Button
                              size="slim"
                              variant={
                                activeFilter === "high_impact"
                                  ? "secondary"
                                  : "tertiary"
                              }
                              pressed={activeFilter === "high_impact"}
                              onClick={() => setActiveFilter("high_impact")}
                            >
                              {t("dashboard.filters.highImpact")}
                            </Button>
                          </InlineStack>

                          {/* Right side: Inline Search, Sort & Numeric Range Inputs */}
                          <div style={{ flexGrow: 1, minWidth: "320px" }}>
                            <InlineStack
                              gap="150"
                              align="end"
                              blockAlign="center"
                              wrap
                            >
                              {/* Search Input */}
                              <div
                                style={{ flex: "2 1 180px", minWidth: "160px" }}
                              >
                                <TextField
                                  label={t("dashboard.products.searchLabel")}
                                  labelHidden
                                  value={searchQuery}
                                  onChange={handleSearchChange}
                                  autoComplete="off"
                                  placeholder={t(
                                    "dashboard.products.searchPlaceholder",
                                  )}
                                  prefix={
                                    <Icon source={SearchIcon} tone="base" />
                                  }
                                  maxLength={100}
                                />
                              </div>

                              {/* Sort Menu Selector */}
                              <div
                                style={{
                                  flex: "1.5 1 140px",
                                  minWidth: "140px",
                                }}
                              >
                                <Select
                                  label={t("common.sortBy")}
                                  labelHidden
                                  options={[
                                    {
                                      label: t("dashboard.filters.sortAZ"),
                                      value: "alphabetical_az",
                                    },
                                    {
                                      label: t("dashboard.filters.sortZA"),
                                      value: "alphabetical_za",
                                    },
                                    {
                                      label: t(
                                        "dashboard.filters.sortHighestIncrease",
                                      ),
                                      value: "highest_increase",
                                    },
                                    {
                                      label: t(
                                        "dashboard.filters.sortHighestDecrease",
                                      ),
                                      value: "highest_decrease",
                                    },
                                    {
                                      label: t(
                                        "dashboard.filters.sortHighestFinalPrice",
                                      ),
                                      value: "highest_final_price",
                                    },
                                    {
                                      label: t(
                                        "dashboard.filters.sortLowestFinalPrice",
                                      ),
                                      value: "lowest_final_price",
                                    },
                                  ]}
                                  value={sortOrder}
                                  onChange={(value) =>
                                    setSortOrder(value as PreviewSortOrder)
                                  }
                                />
                              </div>

                              {/* Min Price Field */}
                              <div
                                style={{ flex: "1 1 85px", minWidth: "85px" }}
                              >
                                <TextField
                                  label={t("dashboard.products.minPriceLabel")}
                                  labelHidden
                                  type="text"
                                  inputMode="decimal"
                                  value={minPrice}
                                  onChange={handleMinPriceChange}
                                  autoComplete="off"
                                  prefix={currencySymbol}
                                  placeholder={t(
                                    "dashboard.products.minPricePlaceholder",
                                  )}
                                  maxLength={15}
                                />
                              </div>

                              {/* Max Price Field */}
                              <div
                                style={{ flex: "1 1 85px", minWidth: "85px" }}
                              >
                                <TextField
                                  label={t("dashboard.products.maxPriceLabel")}
                                  labelHidden
                                  type="text"
                                  inputMode="decimal"
                                  value={maxPrice}
                                  onChange={handleMaxPriceChange}
                                  autoComplete="off"
                                  prefix={currencySymbol}
                                  placeholder={t(
                                    "dashboard.products.maxPricePlaceholder",
                                  )}
                                  maxLength={15}
                                />
                              </div>

                              {/* 🔴 Added: Clear Filter Icon Action Button with Tooltip */}
                              {(searchQuery ||
                                minPrice ||
                                maxPrice ||
                                activeFilter !== "all") && (
                                <Tooltip
                                  content={t(
                                    "dashboard.filters.clearAllFilters",
                                  )}
                                  dismissOnMouseOut
                                >
                                  <Button
                                    variant="tertiary"
                                    tone="critical"
                                    icon={XCircleIcon}
                                    onClick={handleClearFilters}
                                    accessibilityLabel={t(
                                      "dashboard.filters.clearAccessibility",
                                    )}
                                  >
                                    {t("dashboard.filters.clear")}
                                  </Button>
                                </Tooltip>
                              )}
                            </InlineStack>
                          </div>
                        </InlineStack>
                      </Box>
                    </BlockStack>
                  </Card>

                  {previews.length > 0 && (
                    <Card>
                      <Box padding="400">
                        <BlockStack gap="300">
                          {/* Header Summary Metadata Row */}
                          <InlineStack
                            align="space-between"
                            blockAlign="center"
                            gap="200"
                            wrap
                          >
                            <Text
                              as="h3"
                              variant="headingSm"
                              fontWeight="semibold"
                            >
                              {t("dashboard.previewSummary.title")}
                            </Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {(() => {
                                const productCount = Number(
                                  previewImpactSummary.totalCount ?? 0,
                                );
                                const variantCount = Number(
                                  previewImpactSummary.variantCount ??
                                    productCount,
                                );

                                if (
                                  productCount > 0 &&
                                  variantCount > 0 &&
                                  variantCount !== productCount
                                ) {
                                  return t(
                                    "dashboard.previewSummary.basedOnProductsVariants",
                                  )
                                    .replace("{count}", String(productCount))
                                    .replace(
                                      "{variants}",
                                      String(variantCount),
                                    );
                                }
                                return t(
                                  "dashboard.previewSummary.basedOnProducts",
                                ).replace("{count}", String(productCount));
                              })()}
                            </Text>
                          </InlineStack>

                          <Divider />

                          {/* Empty State vs Metrics Dashboard View */}
                          {previewImpactSummary.affectedCount === 0 ? (
                            <Box
                              padding="300"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <Text
                                as="p"
                                variant="bodySm"
                                tone="subdued"
                                alignment="center"
                              >
                                {t("dashboard.previewSummary.noChanges")}
                              </Text>
                            </Box>
                          ) : (
                            /* Pure Flexbox Grid: 100% immune to Polaris appendChild lifecycle errors */
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "12px",
                                width: "100%",
                              }}
                            >
                              {/* Card 1: Products Affected */}
                              <div style={{ flex: "1 1 180px", minWidth: "0" }}>
                                <Box
                                  padding="300"
                                  background="bg-surface-secondary"
                                  borderRadius="200"
                                  borderStyle="solid"
                                  borderWidth="025"
                                  borderColor="border-secondary"
                                >
                                  <BlockStack gap="100">
                                    <Text
                                      as="p"
                                      variant="bodyXs"
                                      fontWeight="medium"
                                      tone="subdued"
                                    >
                                      {t(
                                        "dashboard.previewSummary.productsAffected",
                                      )}
                                    </Text>
                                    <Text
                                      as="p"
                                      variant="headingMd"
                                      fontWeight="bold"
                                    >
                                      {previewImpactSummary.affectedCount}
                                    </Text>
                                  </BlockStack>
                                </Box>
                              </div>

                              {/* Card 2: Average Change */}
                              <div style={{ flex: "1 1 180px", minWidth: "0" }}>
                                <Box
                                  padding="300"
                                  background={
                                    previewImpactSummary.averageDelta >= 0
                                      ? "bg-surface-success"
                                      : "bg-surface-critical"
                                  }
                                  borderRadius="200"
                                  borderStyle="solid"
                                  borderWidth="025"
                                  borderColor={
                                    previewImpactSummary.averageDelta >= 0
                                      ? "border-success"
                                      : "border-critical"
                                  }
                                >
                                  <BlockStack gap="100">
                                    <Text
                                      as="p"
                                      variant="bodyXs"
                                      fontWeight="medium"
                                      tone="subdued"
                                    >
                                      {t(
                                        "dashboard.previewSummary.averageChange",
                                      )}
                                    </Text>
                                    <Text
                                      as="p"
                                      variant="headingMd"
                                      fontWeight="bold"
                                      tone={
                                        previewImpactSummary.averageDelta >= 0
                                          ? "success"
                                          : "critical"
                                      }
                                    >
                                      {`${previewImpactSummary.averageDelta >= 0 ? "+" : ""}${formatMoney(previewImpactSummary.averageDelta, currencyCode)}`}
                                    </Text>
                                  </BlockStack>
                                </Box>
                              </div>

                              {/* Card 3: Largest Increase */}
                              <div style={{ flex: "1 1 180px", minWidth: "0" }}>
                                <Box
                                  padding="300"
                                  background={
                                    previewImpactSummary.hasIncrease
                                      ? "bg-surface-success"
                                      : "bg-surface-secondary"
                                  }
                                  borderRadius="200"
                                  borderStyle="solid"
                                  borderWidth="025"
                                  borderColor={
                                    previewImpactSummary.hasIncrease
                                      ? "border-success"
                                      : "border-secondary"
                                  }
                                >
                                  <BlockStack gap="100">
                                    <Text
                                      as="p"
                                      variant="bodyXs"
                                      fontWeight="medium"
                                      tone="subdued"
                                    >
                                      {t(
                                        "dashboard.previewSummary.largestIncrease",
                                      )}
                                    </Text>
                                    <Text
                                      as="p"
                                      variant="headingMd"
                                      fontWeight="bold"
                                      tone={
                                        previewImpactSummary.hasIncrease
                                          ? "success"
                                          : undefined
                                      }
                                    >
                                      {previewImpactSummary.hasIncrease
                                        ? `+${formatMoney(previewImpactSummary.maxIncreaseDelta, currencyCode)}`
                                        : "—"}
                                    </Text>
                                  </BlockStack>
                                </Box>
                              </div>

                              {/* Card 4: Largest Decrease */}
                              <div style={{ flex: "1 1 180px", minWidth: "0" }}>
                                <Box
                                  padding="300"
                                  background={
                                    previewImpactSummary.hasDecrease
                                      ? "bg-surface-critical"
                                      : "bg-surface-secondary"
                                  }
                                  borderRadius="200"
                                  borderStyle="solid"
                                  borderWidth="025"
                                  borderColor={
                                    previewImpactSummary.hasDecrease
                                      ? "border-critical"
                                      : "border-secondary"
                                  }
                                >
                                  <BlockStack gap="100">
                                    <Text
                                      as="p"
                                      variant="bodyXs"
                                      fontWeight="medium"
                                      tone="subdued"
                                    >
                                      {t(
                                        "dashboard.previewSummary.largestDecrease",
                                      )}
                                    </Text>
                                    <Text
                                      as="p"
                                      variant="headingMd"
                                      fontWeight="bold"
                                      tone={
                                        previewImpactSummary.hasDecrease
                                          ? "critical"
                                          : undefined
                                      }
                                    >
                                      {previewImpactSummary.hasDecrease
                                        ? formatMoney(
                                            previewImpactSummary.maxDecreaseDelta,
                                            currencyCode,
                                          )
                                        : "—"}
                                    </Text>
                                  </BlockStack>
                                </Box>
                              </div>

                              {/* Card 5: Avg Final Price & Safeguards */}
                              <div style={{ flex: "1 1 180px", minWidth: "0" }}>
                                <Box
                                  padding="300"
                                  background="bg-surface-secondary"
                                  borderRadius="200"
                                  borderStyle="solid"
                                  borderWidth="025"
                                  borderColor="border-secondary"
                                >
                                  <BlockStack gap="100">
                                    <Text
                                      as="p"
                                      variant="bodyXs"
                                      fontWeight="medium"
                                      tone="subdued"
                                    >
                                      {t(
                                        "dashboard.previewSummary.avgPriceSafeguards",
                                      )}
                                    </Text>
                                    <InlineStack
                                      align="space-between"
                                      blockAlign="center"
                                    >
                                      <Text
                                        as="p"
                                        variant="headingMd"
                                        fontWeight="bold"
                                      >
                                        {formatMoney(
                                          previewImpactSummary.averageFinalPrice,
                                          currencyCode,
                                        )}
                                      </Text>
                                      {previewImpactSummary.safeguardAdjustedCount >
                                        0 && (
                                        <Box
                                          background="bg-surface-warning"
                                          paddingInline="150"
                                          paddingBlock="050"
                                          borderRadius="100"
                                        >
                                          <Text
                                            as="span"
                                            variant="bodyXs"
                                            fontWeight="semibold"
                                            tone="caution"
                                          >
                                            {`${previewImpactSummary.safeguardAdjustedCount} ${t("dashboard.previewSummary.locked")}`}
                                          </Text>
                                        </Box>
                                      )}
                                    </InlineStack>
                                  </BlockStack>
                                </Box>
                              </div>
                            </div>
                          )}
                        </BlockStack>
                      </Box>
                    </Card>
                  )}

                  {/* 🔹 1. ACTION BAR CARD */}
                  <Card padding="0">
                    <div
                      style={{
                        backgroundColor: "rgba(0, 82, 124, 0.02)",
                        border: "1px solid rgba(0, 82, 124, 0.12)",
                        borderRadius: "12px",
                        padding: "10px 16px",
                      }}
                    >
                      <BlockStack gap="200">
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          gap="400"
                          wrap
                        >
                          {/* Left Side Group: Core Execution Actions */}
                          <InlineStack gap="150" blockAlign="center" wrap>
                            {/* Refresh Previews */}
                            <div style={{ pointerEvents: "auto" }}>
                              <Button
                                variant="secondary"
                                icon={RefreshIcon}
                                size="slim"
                                onClick={handlePreview}
                                loading={loading}
                                disabled={loading || isProcessing}
                              >
                                {t("dashboard.actionBar.refreshPreviews")}
                              </Button>
                            </div>

                            {/* Premium High-Contrast Apply Selected Button */}
                            <div
                              style={{
                                backgroundColor:
                                  selectedPreviewItems.length > 0
                                    ? "rgba(10, 128, 93, 0.12)"
                                    : "transparent",
                                borderRadius: "8px",
                                padding: "2px",
                                display: "inline-flex",
                                transition: "background-color 0.2s ease",
                              }}
                            >
                              <Button
                                size="slim"
                                variant="secondary"
                                icon={CheckIcon}
                                onClick={() =>
                                  openImmediateApplyModal("selected")
                                }
                                disabled={
                                  !hasActivePlan ||
                                  isProcessing ||
                                  !hasRules ||
                                  selectedPreviewItems.length === 0
                                }
                              >
                                {t("dashboard.actionBar.applySelected").replace(
                                  "{count}",
                                  String(selectedPreviewItems.length),
                                )}
                              </Button>
                            </div>

                            {/* Apply All (Lightning / Instant Icon) */}
                            {/* Apply All Button */}
                            <Button
                              variant="primary"
                              size="slim"
                              icon={PlayIcon}
                              onClick={() => openImmediateApplyModal("all")}
                              disabled={
                                !hasActivePlan ||
                                isProcessing ||
                                previews.length === 0 ||
                                !hasRules
                              }
                            >
                              {t("dashboard.actionBar.applyAll").replace(
                                "{count}",
                                String(previews.length),
                              )}
                            </Button>

                            {/* Schedule Center */}
                            <Button
                              variant="secondary"
                              size="slim"
                              icon={CalendarTimeIcon}
                              onClick={() => setScheduleHistoryModalOpen(true)}
                            >
                              {t("dashboard.actionBar.scheduleCenter")}
                            </Button>
                          </InlineStack>

                          {/* Right Side Group: Utilities / Reports */}
                          <InlineStack gap="150" blockAlign="center">
                            {previews.length === 0 ? (
                              <Tooltip
                                content={t("dashboard.actionBar.reportTooltip")}
                              >
                                <span style={{ display: "inline-block" }}>
                                  <Button
                                    variant="tertiary"
                                    size="slim"
                                    icon={ArrowDownIcon}
                                    disabled
                                  >
                                    {t("dashboard.actionBar.downloadReport")}
                                  </Button>
                                </span>
                              </Tooltip>
                            ) : (
                              <Button
                                variant="tertiary"
                                size="slim"
                                icon={ArrowDownIcon}
                                onClick={handleDownloadReport}
                              >
                                {t("dashboard.actionBar.downloadReport")}
                              </Button>
                            )}
                          </InlineStack>
                        </InlineStack>

                        {/* Processing Progress Panel */}
                        {isProcessing && (
                          <Box
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <BlockStack gap="150" align="center">
                              {publishTotal > 0 ? (
                                <>
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    fontWeight="medium"
                                  >
                                    {t("dashboard.actionBar.publishingPrices")}
                                  </Text>
                                  <Text as="p" tone="subdued" variant="bodyXs">
                                    {Math.min(
                                      Math.round(
                                        (progress / 100) * publishTotal,
                                      ),
                                      publishTotal,
                                    )}{" "}
                                    / {publishTotal} products
                                  </Text>
                                  <ProgressBar
                                    progress={progress}
                                    tone="primary"
                                  />
                                  <Text as="p" tone="subdued" variant="bodyXs">
                                    {Math.round(progress)}%
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <InlineStack
                                    gap="200"
                                    blockAlign="center"
                                    align="center"
                                  >
                                    <Spinner size="small" />
                                    <Text
                                      as="p"
                                      variant="bodySm"
                                      fontWeight="medium"
                                    >
                                      {t(
                                        "dashboard.actionBar.processingUpdates",
                                      )}
                                    </Text>
                                  </InlineStack>
                                  <Text as="p" tone="subdued" variant="bodyXs">
                                    {t("dashboard.actionBar.keepPageOpen")}
                                  </Text>
                                  <ProgressBar
                                    progress={progress === 0 ? 10 : progress}
                                    tone="primary"
                                  />
                                </>
                              )}
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                    </div>
                  </Card>

                  {/* 🔹 3. PRODUCT GRID CARD */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        gap="300"
                        wrap
                      >
                        <InlineStack gap="300" blockAlign="center" wrap>
                          <Text as="h3" variant="headingMd">
                            {t("dashboard.productGrid.title")}
                          </Text>
                          <Button size="slim" onClick={selectAllVisible}>
                            {t("dashboard.productGrid.selectAllOnPage")}
                          </Button>
                          <Button
                            size="slim"
                            onClick={() => setSelectedItems(new Set())}
                          >
                            {t("dashboard.productGrid.clearSelection")}
                          </Button>
                        </InlineStack>
                        <Pagination
                          hasPrevious={currentPage > 1}
                          onPrevious={() => setCurrentPage((prev) => prev - 1)}
                          hasNext={currentPage < totalPages}
                          onNext={() => setCurrentPage((prev) => prev + 1)}
                          label={t("dashboard.productGrid.pageLabel")
                            .replace("{current}", String(currentPage))
                            .replace("{total}", String(totalPages || 1))}
                        />
                      </InlineStack>

                      {/* Product rows */}
                      <BlockStack gap="0">
                        {previews.length > 0 &&
                          filteredPreviews.length === 0 && (
                            <Box paddingBlockEnd="400">
                              <Box
                                padding="400"
                                background="bg-surface-secondary"
                                borderRadius="200"
                              >
                                <BlockStack gap="100">
                                  <Text
                                    as="p"
                                    variant="bodyMd"
                                    fontWeight="medium"
                                  >
                                    {t("dashboard.productGrid.noMatchTitle")}
                                  </Text>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {t("dashboard.productGrid.noMatchBody")}
                                  </Text>
                                </BlockStack>
                              </Box>
                            </Box>
                          )}

                        {paginatedPreviews.length > 0 && previewPricingRule && (
                          <Box paddingBlockEnd="400" paddingInline="300">
                            <Box
                              padding="300"
                              background="bg-surface-secondary"
                              borderRadius="200"
                            >
                              <InlineStack gap="200" blockAlign="center" wrap>
                                <Text
                                  as="span"
                                  variant="bodySm"
                                  tone="subdued"
                                  fontWeight="medium"
                                >
                                  {t("dashboard.productGrid.previewContext")}
                                </Text>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {previewPricingRule.adjustmentDirection ===
                                  "decrease"
                                    ? t("dashboard.productGrid.decrease")
                                    : t("dashboard.productGrid.increase")}{" "}
                                  {previewPricingRule.adjustmentType === "fixed"
                                    ? formatMoney(
                                        previewPricingRule.adjustmentValue ?? 0,
                                        currencyCode,
                                      )
                                    : `${previewPricingRule.adjustmentValue}%`}
                                  {previewPricingRule.endingOption &&
                                  previewPricingRule.endingOption !== "none"
                                    ? ` • ${t("dashboard.productGrid.roundedTo").replace("{value}", previewPricingRule.endingOption)}`
                                    : ""}
                                </Text>
                              </InlineStack>
                            </Box>
                          </Box>
                        )}

                        {paginatedPreviews.length > 0 && (
                          <Box
                            paddingBlockEnd="200"
                            paddingInline="300"
                            borderBlockEndWidth="025"
                            borderColor="border-secondary"
                          >
                            <Box padding="200">
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: "16px",
                                  width: "100%",
                                }}
                              >
                                {/* Left Area: Product Name Column Offset */}
                                <div style={{ flex: 1, paddingLeft: "84px" }}>
                                  <Text
                                    as="span"
                                    variant="bodySm"
                                    tone="subdued"
                                    fontWeight="medium"
                                  >
                                    {t("dashboard.productGrid.product")}
                                  </Text>
                                </div>

                                {/* Right Area: Main Header Layout alignment matching row items */}
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                      "70px 100px 140px 95px 95px 340px",
                                    gap: "16px",
                                    alignItems: "center",
                                    flexShrink: 0,
                                  }}
                                >
                                  {/* Inventory */}
                                  <div style={{ textAlign: "left" }}>
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      tone="subdued"
                                      fontWeight="medium"
                                    >
                                      {t("dashboard.productGrid.inventory")}
                                    </Text>
                                  </div>

                                  {/* Product Type */}
                                  <div style={{ textAlign: "left" }}>
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      tone="subdued"
                                      fontWeight="medium"
                                    >
                                      {t("dashboard.productGrid.productType")}
                                    </Text>
                                  </div>

                                  {/* Vendor */}
                                  <div style={{ textAlign: "left" }}>
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      tone="subdued"
                                      fontWeight="medium"
                                    >
                                      {t("dashboard.productGrid.vendor")}
                                    </Text>
                                  </div>

                                  {/* Original Catalog */}
                                  <div style={{ textAlign: "right" }}>
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      tone="subdued"
                                      fontWeight="medium"
                                    >
                                      {t(
                                        "dashboard.productGrid.originalCatalog",
                                      )}
                                    </Text>
                                  </div>

                                  {/* Live Storefront */}
                                  <div style={{ textAlign: "right" }}>
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      tone="subdued"
                                      fontWeight="medium"
                                    >
                                      {t(
                                        "dashboard.productGrid.liveStorefront",
                                      )}
                                    </Text>
                                  </div>

                                  {/* New Preview */}
                                  <div style={{ textAlign: "left" }}>
                                    <Text
                                      as="span"
                                      variant="bodySm"
                                      tone="subdued"
                                      fontWeight="medium"
                                    >
                                      {t("dashboard.productGrid.newPreview")}
                                    </Text>
                                  </div>
                                </div>
                              </div>
                            </Box>
                          </Box>
                        )}

                        {paginatedPreviews.map((p) => {
                          const currentPrice = parseShopifyPrice(p.oldPrice);
                          const originalPrice = parseShopifyPrice(p.originalBasePrice);
                          const isManual = p.overriddenPrice !== undefined;
                          const targetPrice = isManual
                            ? parseShopifyPrice(p.overriddenPrice!)
                            : parseShopifyPrice(p.newPrice);
                          const isPolished = currentPrice !== originalPrice;
                          const isChanged = currentPrice !== targetPrice;
                          const diffFromOriginal =
                            originalPrice !== 0
                              ? ((targetPrice - originalPrice) /
                                  originalPrice) *
                                100
                              : 0;
                          const isSelected = selectedItems.has(p.variantId);
                          const rowSafeguardNotices: string[] = [];

                          if (
                            !isManual &&
                            previewPricingRule &&
                            isFinite(originalPrice)
                          ) {
                            const minPrice =
                              typeof previewPricingRule.minPrice === "number" &&
                              isFinite(previewPricingRule.minPrice)
                                ? previewPricingRule.minPrice
                                : null;
                            const maxPrice =
                              typeof previewPricingRule.maxPrice === "number" &&
                              isFinite(previewPricingRule.maxPrice)
                                ? previewPricingRule.maxPrice
                                : null;

                            if (minPrice != null) {
                              const withoutMin = calculatePrice(originalPrice, {
                                ...previewPricingRule,
                                minPrice: null,
                              });
                              if (
                                withoutMin + 0.01 < minPrice &&
                                Math.abs(targetPrice - minPrice) < 0.01
                              ) {
                                rowSafeguardNotices.push(
                                  t("dashboard.productGrid.adjustedMin"),
                                );
                              }
                            }

                            if (maxPrice != null) {
                              const withoutMax = calculatePrice(originalPrice, {
                                ...previewPricingRule,
                                maxPrice: null,
                              });
                              if (
                                withoutMax - 0.01 > maxPrice &&
                                Math.abs(targetPrice - maxPrice) < 0.01
                              ) {
                                rowSafeguardNotices.push(
                                  t("dashboard.productGrid.adjustedMax"),
                                );
                              }
                            }

                            const roundingPrecision = String(
                              previewPricingRule.roundingPrecision ??
                                "standard",
                            )
                              .trim()
                              .toLowerCase();
                            if (
                              roundingPrecision !== "" &&
                              roundingPrecision !== "standard"
                            ) {
                              const standardRoundedFinal = calculatePrice(
                                originalPrice,
                                {
                                  ...previewPricingRule,
                                  roundingPrecision: "standard",
                                },
                              );

                              if (
                                Math.abs(targetPrice - standardRoundedFinal) >
                                0.01
                              ) {
                                if (roundingPrecision === "nearest-0.05") {
                                  rowSafeguardNotices.push(
                                    t(
                                      "dashboard.productGrid.roundedNearest005",
                                    ),
                                  );
                                } else if (roundingPrecision === "whole") {
                                  rowSafeguardNotices.push(
                                    t("dashboard.productGrid.roundedWhole"),
                                  );
                                } else {
                                  rowSafeguardNotices.push(
                                    t(
                                      "dashboard.productGrid.roundedConsistency",
                                    ),
                                  );
                                }
                              }
                            }
                          }

                          return (
                            <Box
                              key={p.variantId}
                              paddingBlockStart="400"
                              paddingBlockEnd="400"
                              paddingInline="300"
                              borderBlockEndWidth="025"
                              borderColor="border-secondary"
                            >
                              <Box
                                background={
                                  isManual ? "bg-surface-caution" : undefined
                                }
                                padding="200"
                                borderRadius="200"
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                    gap: "16px",
                                    width: "100%",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  {/* LEFT SIDE: Product Info */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "flex-start",
                                      gap: "12px",
                                      minWidth: 0,
                                      flex: 1,
                                      overflowX: "hidden",
                                    }}
                                  >
                                    <div style={{ paddingTop: "2px" }}>
                                      <Checkbox
                                        label=""
                                        labelHidden
                                        checked={isSelected}
                                        onChange={() =>
                                          toggleSelection(p.variantId)
                                        }
                                      />
                                    </div>

                                    <Thumbnail
                                      source={p.image || ""}
                                      alt={p.title}
                                      size="small"
                                    />

                                    <BlockStack gap="100">
                                      <Text
                                        as="span"
                                        variant="bodyMd"
                                        fontWeight="medium"
                                      >
                                        {p.title}
                                      </Text>

                                      {(() => {
                                        const subtitle = buildVariantSubtitle({
                                          productTitle: p.title,
                                          variantTitle: p.variantTitle ?? null,
                                          sku: p.sku ?? null,
                                        });

                                        if (!subtitle) return null;

                                        return (
                                          <div
                                            style={{
                                              whiteSpace: "nowrap",
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              maxWidth: "100%",
                                            }}
                                          >
                                            <Text
                                              as="span"
                                              variant="bodySm"
                                              tone="subdued"
                                            >
                                              {subtitle}
                                            </Text>
                                          </div>
                                        );
                                      })()}

                                      {rowSafeguardNotices.length > 0 && (
                                        <Text
                                          as="span"
                                          variant="bodySm"
                                          tone="subdued"
                                        >
                                          {rowSafeguardNotices.join(" • ")}
                                        </Text>
                                      )}

                                      <div
                                        style={{
                                          display: "flex",
                                          gap: "6px",
                                          flexWrap: "wrap",
                                          opacity: 0.92,
                                          marginTop: "4px",
                                        }}
                                      >
                                        {isManual && (
                                          <Badge tone="attention">
                                            {t("pricing.manualOverride")}
                                          </Badge>
                                        )}

                                        {Math.abs(diffFromOriginal) >= 20 && (
                                          <Badge tone="warning">
                                            {t("pricing.highImpact")}
                                          </Badge>
                                        )}
                                      </div>
                                    </BlockStack>
                                  </div>

                                  {/* RIGHT SIDE: Table Metadata and Inline Action Controls */}
                                  <div
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns:
                                        "70px 100px 140px 95px 95px 340px",
                                      gap: "16px",
                                      alignItems: "center",
                                    }}
                                  >
                                    {/* COLUMN 1: Inventory */}
                                    <Box>
                                      <BlockStack gap="0" inlineAlign="start">
                                        <Text
                                          as="span"
                                          variant="bodyMd"
                                          tone="subdued"
                                        >
                                          {(p.inventory ??
                                            p.inventoryQuantity) !==
                                            undefined &&
                                          (p.inventory ??
                                            p.inventoryQuantity) !== null
                                            ? String(
                                                p.inventory ??
                                                  p.inventoryQuantity,
                                              )
                                            : "—"}
                                        </Text>
                                      </BlockStack>
                                    </Box>

                                    {/* COLUMN 2: Product Type */}
                                    <Box>
                                      <BlockStack gap="0" inlineAlign="start">
                                        <Text
                                          as="span"
                                          variant="bodyMd"
                                          tone="subdued"
                                        >
                                          {p.productType || "—"}
                                        </Text>
                                      </BlockStack>
                                    </Box>

                                    {/* COLUMN 3: Vendor */}
                                    <Box>
                                      <BlockStack gap="0" inlineAlign="start">
                                        <Text
                                          as="span"
                                          variant="bodyMd"
                                          tone="subdued"
                                        >
                                          {p.vendor || "—"}
                                        </Text>
                                      </BlockStack>
                                    </Box>

                                    {/* COLUMN 4: Original Catalog */}
                                    <Box>
                                      <BlockStack gap="0" inlineAlign="end">
                                        <Text
                                          as="span"
                                          variant="bodyMd"
                                          tone="subdued"
                                        >
                                          {formatMoney(
                                            parseShopifyPrice(p.originalBasePrice),
                                            currencyCode,
                                          )}
                                        </Text>
                                      </BlockStack>
                                    </Box>

                                    {/* COLUMN 5: Live Storefront */}
                                    <Box>
                                      <BlockStack gap="0" inlineAlign="end">
                                        <Text
                                          as="span"
                                          variant="bodyMd"
                                          tone={
                                            isPolished || isChanged
                                              ? "subdued"
                                              : "base"
                                          }
                                          textDecorationLine={
                                            isPolished || isChanged
                                              ? "line-through"
                                              : undefined
                                          }
                                        >
                                          {formatMoney(
                                            parseShopifyPrice(p.oldPrice),
                                            currencyCode,
                                          )}
                                        </Text>
                                      </BlockStack>
                                    </Box>

                                    {/* COLUMN 6: Restored Original Inline Flow Controls */}
                                    <Box>
                                      <InlineStack
                                        gap="150"
                                        blockAlign="center"
                                        wrap={false}
                                      >
                                        {/* Slim Price input field */}
                                        <div
                                          style={{
                                            width: "100px",
                                            flexShrink: 0,
                                          }}
                                        >
                                          <TextField
                                            label=""
                                            labelHidden
                                            value={String(
                                              p.overriddenPrice !== undefined
                                                ? p.overriddenPrice
                                                : p.newPrice,
                                            )}
                                            onChange={(val) =>
                                              handlePriceChange(
                                                p.variantId,
                                                val,
                                              )
                                            }
                                            autoComplete="off"
                                            prefix={currencySymbol}
                                            size="slim"
                                            maxLength={15}
                                          />
                                        </div>

                                        {/* Inline Action Container holding logic indicators and buttons */}
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "16px",
                                            flexGrow: 1,
                                            justifyContent: "flex-end",
                                          }}
                                        >
                                          {/* Directional Chevron Impact Percentage Indicators */}
                                          {(isPolished || isChanged) &&
                                            Math.abs(diffFromOriginal) >
                                              0.01 && (
                                              <InlineStack
                                                gap="100"
                                                blockAlign="center"
                                                wrap={false}
                                              >
                                                <Icon
                                                  source={
                                                    targetPrice > originalPrice
                                                      ? ChevronUpIcon
                                                      : ChevronDownIcon
                                                  }
                                                  tone={
                                                    targetPrice > originalPrice
                                                      ? "success"
                                                      : "critical"
                                                  }
                                                />
                                                <Text
                                                  as="span"
                                                  variant="bodySm"
                                                  tone={
                                                    targetPrice > originalPrice
                                                      ? "success"
                                                      : "critical"
                                                  }
                                                  fontWeight="medium"
                                                >
                                                  {`${Math.abs(diffFromOriginal).toFixed(1)}%`}
                                                </Text>
                                              </InlineStack>
                                            )}

                                          {/* Restored Reset Action */}
                                          {isManual && (
                                            <Button
                                              size="slim"
                                              variant="tertiary"
                                              onClick={() =>
                                                resetOverride(p.variantId)
                                              }
                                            >
                                              {t("dashboard.productGrid.reset")}
                                            </Button>
                                          )}

                                          {/* Restored Apply Action workflow with Tooltip safeguards */}
                                          {isChanged ? (
                                            <Button
                                              size="slim"
                                              onClick={() =>
                                                handleApplySingle(p)
                                              }
                                              loading={
                                                updatingItem === p.variantId
                                              }
                                              disabled={
                                                !hasActivePlan ||
                                                !!updatingItem ||
                                                isProcessing ||
                                                (isManual &&
                                                  p.overriddenPrice === "") ||
                                                !hasRules
                                              }
                                              tone="success"
                                            >
                                              {t("dashboard.productGrid.apply")}
                                            </Button>
                                          ) : (
                                            <Tooltip
                                              content={t(
                                                "dashboard.productGrid.alreadySynced",
                                              )}
                                            >
                                              <span
                                                style={{
                                                  display: "inline-block",
                                                }}
                                              >
                                                <Button
                                                  size="slim"
                                                  onClick={() =>
                                                    handleApplySingle(p)
                                                  }
                                                  loading={
                                                    updatingItem === p.variantId
                                                  }
                                                  disabled={
                                                    !hasActivePlan ||
                                                    !!updatingItem ||
                                                    isProcessing ||
                                                    (isManual &&
                                                      p.overriddenPrice ===
                                                        "") ||
                                                    !hasRules
                                                  }
                                                >
                                                  {t(
                                                    "dashboard.productGrid.apply",
                                                  )}
                                                </Button>
                                              </span>
                                            </Tooltip>
                                          )}
                                        </div>
                                      </InlineStack>
                                    </Box>
                                  </div>
                                </div>
                              </Box>
                            </Box>
                          );
                        })}
                      </BlockStack>

                      <InlineStack align="center">
                        <Pagination
                          hasPrevious={currentPage > 1}
                          onPrevious={() => setCurrentPage((prev) => prev - 1)}
                          hasNext={currentPage < totalPages}
                          onNext={() => setCurrentPage((prev) => prev + 1)}
                          label={t("dashboard.productGrid.pageLabel")
                            .replace("{current}", String(currentPage))
                            .replace("{total}", String(totalPages || 1))}
                        />
                      </InlineStack>

                      {!hasActivePlan && (
                        <Text as="p" variant="bodySm" tone="critical">
                          {t("dashboard.billingUpsell.body")}
                        </Text>
                      )}
                    </BlockStack>
                  </Card>
                </BlockStack>
              </Box>
            </div>
          </BlockStack>
        </div>

        {/* ── TASK 4: Confirmation Modals ── */}

        {shopify && (
          <ImmediateApplyConfirmationModal
            open={immediateApplyModalOpen}
            onClose={closeImmediateApplyModal}
            scopeLabel={immediateApplyScopeLabel}
            itemCount={immediateApplyContextItems.length}
            impactSummary={immediateApplyImpactSummary}
            safeguardNotices={immediateApplySafeguardNotices}
            isProcessing={isProcessing}
            initialCampaignTitle=""
            validateCampaignTitle={validateCampaignTitle}
            onConfirm={async (campaignTitle) => {
              const ok = await handleApplyBatch(
                immediateApplyContextItems,
                campaignTitle,
              );
              if (ok) {
                setApplyCampaignTitle(campaignTitle);
              }
              return ok;
            }}
            onDirtyChange={setIsImmediateApplyDirty}
          />
        )}

        {shopify && (
          <ScheduledHistoryModal
            open={scheduleHistoryModalOpen}
            onClose={() => setScheduleHistoryModalOpen(false)}
            currencyCode={currencyCode}
            shop={shop}
            host={host}
            previews={previews}
            filteredPreviews={filteredPreviews}
            selectedItems={selectedItems}
            collectionId={collectionId}
            hasActivePlan={hasActivePlan}
            hasRules={hasRules}
            existingCampaignTitles={campaignHistoryTitles}
            shopify={shopify}
            onDirtyChange={setIsScheduleDirty}
          />
        )}

        <Modal
          open={campaignDetailOpen}
          size="large"
          onClose={() => {
            setCampaignDetailOpen(false);
            setCampaignDetail(null);
            setSelectedCampaignForDetail(null);
            setCampaignDetailPageSize(15);
            setCampaignDetailPage(1);
          }}
          title={`${t("dashboard.campaignDetail.modalTitle")}${selectedCampaignForDetail ? `: ${selectedCampaignForDetail.title}` : ""}`}
          secondaryActions={[
            {
              content: t("common.close"),
              onAction: () => {
                setCampaignDetailOpen(false);
                setCampaignDetail(null);
                setSelectedCampaignForDetail(null);
                setCampaignDetailPageSize(15);
                setCampaignDetailPage(1);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {campaignDetailLoading ? (
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="small" />
                </InlineStack>
              ) : campaignDetail ? (
                <>
                  <InlineStack gap="300" wrap>
                    <Text as="p" variant="bodySm">
                      <strong>
                        {t("dashboard.revertPreview.campaignLabel")}
                      </strong>{" "}
                      {campaignDetail.title}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      <strong>
                        {campaignDetail.preActivation ||
                        campaignDetail.prePublish ||
                        campaignDetail.staged
                          ? t("dashboard.campaignDetail.scheduledProductsLabel")
                          : t("dashboard.campaignDetail.trackedItemsLabel")}
                        :
                      </strong>{" "}
                      {(() => {
                        const fallbackCount =
                          campaignDetail.preActivation ||
                          campaignDetail.prePublish ||
                          campaignDetail.staged
                            ? campaignDetail.productCount
                            : (campaignDetail.totalTrackedCount ??
                              campaignDetail.rows.length);
                        const counts =
                          campaignDetailCounts.productCount > 0
                            ? campaignDetailCounts
                            : {
                                productCount: fallbackCount,
                                variantCount: fallbackCount,
                              };
                        if (counts.variantCount !== counts.productCount) {
                          return `${counts.productCount} ${t("dashboard.campaignDetail.productsSuffix")} • ${counts.variantCount} ${t("dashboard.revertPreview.variantsSuffix")}`;
                        }
                        return `${counts.productCount} ${t("dashboard.campaignDetail.productsSuffix")}`;
                      })()}
                    </Text>
                  </InlineStack>

                  {campaignDetail.preActivation ||
                  campaignDetail.prePublish ||
                  campaignDetail.staged ? (
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <InlineStack gap="200" wrap>
                          <Badge
                            tone={
                              campaignDetail.staged
                                ? "info"
                                : campaignDetail.schedule?.status ===
                                      "cancelled-window" ||
                                    campaignDetail.schedule?.status ===
                                      "cancelled-publish"
                                  ? "info"
                                  : "warning"
                            }
                          >
                            {campaignDetail.staged
                              ? t("dashboard.campaignDetail.draftCampaignBadge")
                              : campaignDetail.schedule?.status ===
                                  "cancelled-window"
                                ? t(
                                    "dashboard.campaignDetail.cancelledWindowBadge",
                                  )
                                : campaignDetail.schedule?.status ===
                                    "cancelled-publish"
                                  ? t("dashboard.campaignDetail.cancelledBadge")
                                  : campaignDetail.prePublish
                                    ? t(
                                        "dashboard.campaignDetail.publishScheduledBadge",
                                      )
                                    : t(
                                        "dashboard.campaignDetail.windowScheduledBadge",
                                      )}
                          </Badge>
                          {!campaignDetail.staged && (
                            <Badge tone="attention">
                              {formatDetailScheduleType(
                                campaignDetail.schedule?.type,
                              )}
                            </Badge>
                          )}
                        </InlineStack>
                        <Text as="p" variant="bodySm">
                          {campaignDetail.staged
                            ? t("dashboard.campaignDetail.stagedBody")
                            : campaignDetail.schedule?.status ===
                                "cancelled-window"
                              ? t(
                                  "dashboard.campaignDetail.cancelledWindowBody",
                                )
                              : campaignDetail.schedule?.status ===
                                  "cancelled-publish"
                                ? t(
                                    "dashboard.campaignDetail.cancelledPublishBody",
                                  )
                                : campaignDetail.prePublish
                                  ? t("dashboard.campaignDetail.prePublishBody")
                                  : t(
                                      "dashboard.campaignDetail.windowScheduledBody",
                                    )}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {campaignDetail.staged
                            ? t("dashboard.campaignDetail.stagedSubBody")
                            : campaignDetail.schedule?.status ===
                                  "cancelled-window" ||
                                campaignDetail.schedule?.status ===
                                  "cancelled-publish"
                              ? t("dashboard.campaignDetail.cancelledSubBody")
                              : campaignDetail.prePublish
                                ? t(
                                    "dashboard.campaignDetail.prePublishSubBody",
                                  )
                                : t("dashboard.campaignDetail.windowSubBody")}
                        </Text>
                        <InlineStack gap="400" wrap>
                          {campaignDetail.schedule?.runAt && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("dashboard.campaignDetail.publishStartLabel")}{" "}
                              {new Date(
                                campaignDetail.schedule.runAt,
                              ).toLocaleString()}
                            </Text>
                          )}
                          {campaignDetail.schedule?.windowEndAt && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t(
                                "dashboard.campaignDetail.automaticRestoreLabel",
                              )}{" "}
                              {new Date(
                                campaignDetail.schedule.windowEndAt,
                              ).toLocaleString()}
                            </Text>
                          )}
                          <Text as="p" variant="bodySm" tone="subdued">
                            {(() => {
                              const counts =
                                campaignDetailCounts.productCount > 0
                                  ? campaignDetailCounts
                                  : {
                                      productCount: campaignDetail.productCount,
                                      variantCount: campaignDetail.productCount,
                                    };
                              if (counts.variantCount !== counts.productCount) {
                                return `${t("dashboard.campaignDetail.intendedScopePrefix")} ${counts.productCount} ${t("dashboard.campaignDetail.productsSuffix")} • ${counts.variantCount} ${t("dashboard.revertPreview.variantsSuffix")}`;
                              }
                              return `${t("dashboard.campaignDetail.intendedScopePrefix")} ${counts.productCount} ${t("dashboard.campaignDetail.productsSuffix")}`;
                            })()}
                          </Text>
                          {campaignDetail.schedule?.createdAt && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {t("dashboard.campaignDetail.createdLabel")}{" "}
                              {new Date(
                                campaignDetail.schedule.createdAt,
                              ).toLocaleString()}
                            </Text>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ) : (
                    <BlockStack gap="200">
                      {selectedCampaignForDetail &&
                        resolveCampaignRuntimeStatus(
                          selectedCampaignForDetail,
                          campaignRuntimeNow,
                        ) === "active-window" && (
                          <Box
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <BlockStack gap="150">
                              <InlineStack gap="200" wrap>
                                <Badge tone="success">
                                  {t(
                                    "dashboard.campaignDetail.pricingActiveBadge",
                                  )}
                                </Badge>
                                <Badge tone="attention">
                                  {t(
                                    "dashboard.campaignDetail.timeWindowBadge",
                                  )}
                                </Badge>
                              </InlineStack>
                              <InlineStack gap="400" wrap>
                                {selectedCampaignForDetail.runAt && (
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {t(
                                      "dashboard.campaignDetail.activeSinceLabel",
                                    )}{" "}
                                    {new Date(
                                      selectedCampaignForDetail.runAt,
                                    ).toLocaleString()}
                                  </Text>
                                )}
                                {selectedCampaignForDetail.windowEndAt && (
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {t(
                                      "dashboard.campaignDetail.restoreTimeLabel",
                                    )}{" "}
                                    {new Date(
                                      selectedCampaignForDetail.windowEndAt,
                                    ).toLocaleString()}
                                  </Text>
                                )}
                              </InlineStack>
                              {selectedCampaignForDetail.windowEndAt && (
                                <Text
                                  as="p"
                                  variant="bodySm"
                                  fontWeight="medium"
                                >
                                  {`${t("dashboard.campaignDetail.remainingDurationPrefix")} ${formatDurationParts(
                                    new Date(
                                      selectedCampaignForDetail.windowEndAt,
                                    ).getTime() - campaignRuntimeNow.getTime(),
                                  )}`}
                                </Text>
                              )}
                            </BlockStack>
                          </Box>
                        )}
                      <InlineStack gap="200" wrap>
                        <Badge tone="success">{`${t("dashboard.campaignDetail.revertedBadgePrefix")} ${campaignDetail.revertedCount ?? 0}`}</Badge>
                        <Badge tone="warning">{`${t("dashboard.campaignDetail.failedBadgePrefix")} ${campaignDetail.failedCount ?? 0}`}</Badge>
                        <Badge tone="critical">{`${t("dashboard.campaignDetail.unrecoverableBadgePrefix")} ${campaignDetail.unrecoverableCount ?? 0}`}</Badge>
                      </InlineStack>
                    </BlockStack>
                  )}

                  {campaignOperationalTimeline.length > 0 && (
                    <Box
                      padding="300"
                      background="bg-surface"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">
                          {t(
                            "dashboard.campaignDetail.operationalTimelineTitle",
                          )}
                        </Text>
                        <div
                          style={{
                            borderLeft:
                              "2px solid var(--p-color-border-secondary)",
                            paddingLeft: 12,
                          }}
                        >
                          <BlockStack gap="200">
                            {campaignOperationalTimeline.map(
                              (milestone, index) => (
                                <div
                                  key={milestone.key}
                                  style={{
                                    position: "relative",
                                    paddingLeft: 10,
                                    paddingBottom:
                                      index ===
                                      campaignOperationalTimeline.length - 1
                                        ? 0
                                        : 2,
                                  }}
                                >
                                  <span
                                    aria-hidden
                                    style={{
                                      position: "absolute",
                                      left: -18,
                                      top: 5,
                                      width: 8,
                                      height: 8,
                                      borderRadius: "50%",
                                      background:
                                        milestone.tone === "critical"
                                          ? "var(--p-color-bg-fill-critical)"
                                          : milestone.tone === "warning"
                                            ? "var(--p-color-bg-fill-warning)"
                                            : milestone.tone === "success"
                                              ? "var(--p-color-bg-fill-success)"
                                              : "var(--p-color-bg-fill-info)",
                                    }}
                                  />
                                  <InlineStack
                                    align="space-between"
                                    blockAlign="start"
                                    wrap={false}
                                  >
                                    <InlineStack gap="200" blockAlign="center">
                                      <Text
                                        as="p"
                                        variant="bodySm"
                                        fontWeight="medium"
                                      >
                                        {milestone.label}
                                      </Text>
                                      <Badge tone={milestone.tone}>
                                        {milestone.badgeLabel ??
                                          t(
                                            "dashboard.campaignDetail.milestoneBadgeDefault",
                                          )}
                                      </Badge>
                                    </InlineStack>
                                    {milestone.timestamp ? (
                                      <Text
                                        as="p"
                                        variant="bodySm"
                                        tone="subdued"
                                      >
                                        {milestone.timestamp}
                                      </Text>
                                    ) : null}
                                  </InlineStack>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {milestone.description}
                                  </Text>
                                </div>
                              ),
                            )}
                          </BlockStack>
                        </div>
                      </BlockStack>
                    </Box>
                  )}

                  <Box
                    padding="200"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="end">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`${t("dashboard.revertPreview.showingPrefix")} ${
                            campaignDetailPaginatedRows.length === 0
                              ? 0
                              : (campaignDetailPage - 1) *
                                  campaignDetailPageSize +
                                1
                          }-${
                            (campaignDetailPage - 1) * campaignDetailPageSize +
                            campaignDetailPaginatedRows.length
                          } ${t("dashboard.revertPreview.ofSuffix")} ${campaignDetailRows.length} ${
                            campaignDetail.preActivation ||
                            campaignDetail.prePublish ||
                            campaignDetail.staged
                              ? t(
                                  "dashboard.campaignDetail.scheduledProductsLower",
                                )
                              : t("dashboard.campaignDetail.trackedItemsLower")
                          }`}
                        </Text>
                        <div style={{ minWidth: 140 }}>
                          <Select
                            label={t(
                              "dashboard.revertPreview.rowsPerPageLabel",
                            )}
                            options={OPERATIONAL_PAGE_SIZE_OPTIONS.map(
                              (size) => ({
                                label: `${SELECT_OPTION_PREFIX}${size}`,
                                value: String(size),
                              }),
                            )}
                            value={String(campaignDetailPageSize)}
                            onChange={(value) =>
                              setCampaignDetailPageSize(Number(value))
                            }
                          />
                        </div>
                      </InlineStack>
                      <BlockStack gap="150">
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              CAMPAIGN_DETAIL_COMPARISON_GRID,
                            gap: "12px",
                            alignItems: "center",
                            paddingInline: "2px",
                          }}
                        >
                          <Text as="p" variant="bodySm" fontWeight="medium">
                            {t("dashboard.revertPreview.tableHeaderProduct")}
                          </Text>
                          <div style={{ fontVariantNumeric: "tabular-nums" }}>
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="medium"
                              alignment="end"
                            >
                              {campaignDetail.preActivation ||
                              campaignDetail.prePublish ||
                              campaignDetail.staged
                                ? t(
                                    "dashboard.campaignDetail.originalPriceHeader",
                                  )
                                : t(
                                    "dashboard.campaignDetail.revertedFromHeader",
                                  )}
                            </Text>
                          </div>
                          <div style={{ fontVariantNumeric: "tabular-nums" }}>
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="medium"
                              alignment="end"
                            >
                              {campaignDetail.preActivation ||
                              campaignDetail.prePublish ||
                              campaignDetail.staged
                                ? t(
                                    "dashboard.campaignDetail.stagedPriceHeader",
                                  )
                                : t(
                                    "dashboard.campaignDetail.restoredToHeader",
                                  )}
                            </Text>
                          </div>
                          <InlineStack align="start">
                            <Text as="p" variant="bodySm" fontWeight="medium">
                              {t("dashboard.campaignDetail.statusHeader")}
                            </Text>
                          </InlineStack>
                        </div>
                        {campaignDetailPaginatedRows.map((row) => (
                          <div
                            key={`${row.variantId}-${row.revertTargetPrice}-${row.status ?? "pending"}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                CAMPAIGN_DETAIL_COMPARISON_GRID,
                              gap: "12px",
                              alignItems: "start",
                              padding: "12px 2px",
                              borderTop:
                                "1px solid var(--p-color-border-secondary)",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <BlockStack gap="0">
                                <div style={{ overflowWrap: "anywhere" }}>
                                  <Text as="p" variant="bodySm">
                                    {row.productTitle}
                                  </Text>
                                </div>
                                <div style={{ overflowWrap: "anywhere" }}>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {compactVariantIdentifier(row.variantId)}
                                  </Text>
                                </div>
                                {(() => {
                                  const subtitle = buildVariantSubtitle({
                                    productTitle: row.productTitle,
                                    variantTitle: row.variantTitle ?? null,
                                    sku: row.sku ?? null,
                                  });

                                  if (!subtitle) return null;

                                  return (
                                    <div style={{ overflowWrap: "anywhere" }}>
                                      <Text
                                        as="p"
                                        variant="bodySm"
                                        tone="subdued"
                                      >
                                        {subtitle}
                                      </Text>
                                    </div>
                                  );
                                })()}
                                {row.revertFailureReason && (
                                  <div style={{ overflowWrap: "anywhere" }}>
                                    <Text
                                      as="p"
                                      variant="bodySm"
                                      tone="subdued"
                                    >
                                      {row.revertFailureReason}
                                    </Text>
                                  </div>
                                )}
                              </BlockStack>
                            </div>
                            <div
                              style={{
                                fontVariantNumeric: "tabular-nums",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <Text
                                as="p"
                                variant="bodySm"
                                alignment="end"
                                tone="subdued"
                              >
                                {row.currentPrice == null
                                  ? "-"
                                  : formatMoney(row.currentPrice, currencyCode)}
                              </Text>
                            </div>
                            <div
                              style={{
                                fontVariantNumeric: "tabular-nums",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <Text
                                as="p"
                                variant="bodySm"
                                fontWeight="medium"
                                alignment="end"
                                tone={
                                  campaignDetail.preActivation ||
                                  campaignDetail.prePublish ||
                                  campaignDetail.staged
                                    ? undefined
                                    : "success"
                                }
                              >
                                {campaignDetail.preActivation ||
                                campaignDetail.prePublish ||
                                campaignDetail.staged
                                  ? row.scheduledPrice == null
                                    ? "-"
                                    : formatMoney(
                                        row.scheduledPrice,
                                        currencyCode,
                                      )
                                  : formatMoney(
                                      row.revertTargetPrice,
                                      currencyCode,
                                    )}
                              </Text>
                            </div>
                            <InlineStack align="start" blockAlign="center">
                              <Badge tone={detailStatusTone(row.status)}>
                                {detailStatusLabel(row.status)}
                              </Badge>
                            </InlineStack>
                          </div>
                        ))}
                        {(campaignDetail.missingHistoricalRevertedFromCount ??
                          0) > 0 && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {t(
                              "dashboard.campaignDetail.historicalUnavailableNotice",
                            )}
                          </Text>
                        )}
                        <InlineStack align="end">
                          <Pagination
                            hasPrevious={campaignDetailPage > 1}
                            onPrevious={() =>
                              setCampaignDetailPage((prev) =>
                                Math.max(1, prev - 1),
                              )
                            }
                            hasNext={
                              campaignDetailPage < campaignDetailTotalPages
                            }
                            onNext={() =>
                              setCampaignDetailPage((prev) =>
                                Math.min(campaignDetailTotalPages, prev + 1),
                              )
                            }
                            label={`${t("dashboard.revertPreview.pagePrefix")} ${campaignDetailPage} ${t("dashboard.revertPreview.ofSuffix")} ${campaignDetailTotalPages}`}
                          />
                        </InlineStack>
                      </BlockStack>
                    </BlockStack>
                  </Box>
                </>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dashboard.campaignDetail.noDetailData")}
                </Text>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
        <Modal
          open={revertPreviewOpen}
          size="large"
          onClose={() => {
            if (isProcessing) return;
            setRevertPreviewOpen(false);
            setSelectedCampaignForRevert(null);
            setRevertPreview(null);
            setRevertPreviewRetryFailedOnly(false);
            resetRevertPreviewViewState();
          }}
          title={`${revertPreviewRetryFailedOnly ? t("dashboard.revertPreview.modalTitleRetry") : t("dashboard.revertPreview.modalTitleRevert")}${selectedCampaignForRevert ? `: ${selectedCampaignForRevert.title}` : ""}`}
          primaryAction={
            revertPreview?.terminal
              ? undefined
              : {
                  content: revertPreviewRetryFailedOnly
                    ? t("dashboard.revertPreview.confirmRetryCta")
                    : t("dashboard.revertPreview.confirmRevertCta"),
                  onAction: () => {
                    void confirmCampaignRevert();
                  },
                  destructive: true,
                  loading: isProcessing,
                  disabled:
                    isProcessing ||
                    revertPreviewLoading ||
                    !selectedCampaignForRevert,
                }
          }
          secondaryActions={[
            {
              content: t("common.cancel"),
              onAction: () => {
                setRevertPreviewOpen(false);
                setSelectedCampaignForRevert(null);
                setRevertPreview(null);
                setRevertPreviewRetryFailedOnly(false);
                resetRevertPreviewViewState();
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              {revertPreviewLoading ? (
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="small" />
                </InlineStack>
              ) : revertPreview ? (
                <>
                  {revertPreview.message && (
                    <Banner tone={revertPreview.terminal ? "warning" : "info"}>
                      <p>{revertPreview.message}</p>
                    </Banner>
                  )}
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("dashboard.revertPreview.reviewPricesNotice")}
                  </Text>
                  <InlineStack gap="300" wrap>
                    <Text as="p" variant="bodySm">
                      <strong>
                        {t("dashboard.revertPreview.campaignLabel")}
                      </strong>{" "}
                      {revertPreview.title}
                    </Text>
                    <Text as="p" variant="bodySm">
                      <strong>
                        {t("dashboard.revertPreview.affectedProductsLabel")}
                      </strong>{" "}
                      {revertPreviewCounts.variantCount !==
                      revertPreviewCounts.productCount
                        ? `${revertPreviewCounts.productCount} • ${revertPreviewCounts.variantCount} ${t("dashboard.revertPreview.variantsSuffix")}`
                        : revertPreviewCounts.productCount}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" wrap>
                    <Badge
                      tone={
                        revertPreview.productCount >=
                        VERY_LARGE_OPERATION_THRESHOLD
                          ? "warning"
                          : "info"
                      }
                    >
                      {revertPreviewCounts.variantCount !==
                      revertPreviewCounts.productCount
                        ? `${t("dashboard.revertPreview.affectedProductsBadgePrefix")} ${revertPreviewCounts.productCount} • ${revertPreviewCounts.variantCount} ${t("dashboard.revertPreview.variantsSuffix")}`
                        : `${t("dashboard.revertPreview.affectedProductsBadgePrefix")} ${revertPreviewCounts.productCount}`}
                    </Badge>
                    <Badge tone="success">
                      {`${t("dashboard.revertPreview.revertRowsBadgePrefix")} ${revertPreview.rows.length}`}
                    </Badge>
                  </InlineStack>
                  {revertSafeguardNotices.length > 0 && (
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="200"
                      borderColor="border"
                      borderWidth="025"
                    >
                      <BlockStack gap="200">
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          wrap
                        >
                          <Text as="p" variant="bodySm" fontWeight="medium">
                            {t(
                              "dashboard.revertPreview.operationalSafeguardsTitle",
                            )}
                          </Text>
                          <InlineStack gap="100" wrap>
                            <Badge tone="warning">
                              {`${revertSafeguardNotices.filter((notice) => notice.severity === "warning").length} ${
                                revertSafeguardNotices.filter(
                                  (notice) => notice.severity === "warning",
                                ).length === 1
                                  ? t("dashboard.revertPreview.warningLabel")
                                  : t(
                                      "dashboard.revertPreview.warningLabelPlural",
                                    )
                              }`}
                            </Badge>
                            <Badge tone="info">
                              {`${revertSafeguardNotices.filter((notice) => notice.severity === "informational").length} ${t("dashboard.revertPreview.infoLabel")}`}
                            </Badge>
                          </InlineStack>
                        </InlineStack>
                        <BlockStack gap="150">
                          {revertSafeguardNotices.map((notice) => (
                            <InlineStack
                              key={notice.id}
                              gap="200"
                              blockAlign="center"
                            >
                              <Badge
                                tone={
                                  notice.severity === "warning"
                                    ? "warning"
                                    : "info"
                                }
                              >
                                {notice.severity === "warning"
                                  ? t("dashboard.revertPreview.warningLabel")
                                  : t("dashboard.revertPreview.infoLabel")}
                              </Badge>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {notice.message}
                              </Text>
                            </InlineStack>
                          ))}
                        </BlockStack>
                      </BlockStack>
                    </Box>
                  )}
                  {selectedCampaignForRevert?.unrecoverableReason && (
                    <Banner tone="warning">
                      <p>{selectedCampaignForRevert.unrecoverableReason}</p>
                    </Banner>
                  )}
                  <Box
                    padding="200"
                    background="bg-surface-secondary"
                    borderRadius="200"
                    borderColor="border"
                    borderWidth="025"
                  >
                    <InlineStack
                      gap="200"
                      wrap
                      align="space-between"
                      blockAlign="end"
                    >
                      <div style={{ minWidth: 220, flex: "1 1 320px" }}>
                        <TextField
                          label={t("dashboard.revertPreview.searchLabel")}
                          value={revertPreviewSearchQuery}
                          onChange={setRevertPreviewSearchQuery}
                          placeholder={t(
                            "dashboard.revertPreview.searchPlaceholder",
                          )}
                          autoComplete="off"
                          disabled={isProcessing}
                        />
                      </div>
                      <div style={{ minWidth: 210 }}>
                        <Select
                          label={t(
                            "dashboard.revertPreview.movementFilterLabel",
                          )}
                          options={[
                            {
                              label: `${SELECT_OPTION_PREFIX}${t("dashboard.revertPreview.movementFilterAll")}`,
                              value: "all",
                            },
                            {
                              label: `${SELECT_OPTION_PREFIX}${t("dashboard.revertPreview.movementFilterIncrease")}`,
                              value: "increase",
                            },
                            {
                              label: `${SELECT_OPTION_PREFIX}${t("dashboard.revertPreview.movementFilterDecrease")}`,
                              value: "decrease",
                            },
                            {
                              label: `${SELECT_OPTION_PREFIX}${t("dashboard.revertPreview.movementFilterLarge")}`,
                              value: "large_movement",
                            },
                          ]}
                          value={revertPreviewMovementFilter}
                          onChange={(value) =>
                            setRevertPreviewMovementFilter(
                              value as RevertPreviewMovementFilter,
                            )
                          }
                          disabled={isProcessing}
                        />
                      </div>
                      <div style={{ minWidth: 130 }}>
                        <Select
                          label={t("dashboard.revertPreview.rowsPerPageLabel")}
                          options={OPERATIONAL_PAGE_SIZE_OPTIONS.map(
                            (size) => ({
                              label: `${SELECT_OPTION_PREFIX}${size}`,
                              value: String(size),
                            }),
                          )}
                          value={String(revertPreviewPageSize)}
                          onChange={(value) =>
                            setRevertPreviewPageSize(Number(value))
                          }
                          disabled={isProcessing}
                        />
                      </div>
                    </InlineStack>
                  </Box>
                  <Box
                    padding="200"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="150">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: REVERT_PREVIEW_COMPARISON_GRID,
                          gap: "12px",
                          alignItems: "center",
                          paddingInline: "2px",
                        }}
                      >
                        <Text as="p" variant="bodySm" fontWeight="medium">
                          {t("dashboard.revertPreview.tableHeaderProduct")}
                        </Text>
                        <div
                          style={{
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          <Text
                            as="p"
                            variant="bodySm"
                            fontWeight="medium"
                            alignment="end"
                          >
                            {t("dashboard.revertPreview.tableHeaderCurrent")}
                          </Text>
                        </div>
                        <div
                          style={{
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          <Text
                            as="p"
                            variant="bodySm"
                            fontWeight="medium"
                            alignment="end"
                          >
                            {t(
                              "dashboard.revertPreview.tableHeaderRevertTarget",
                            )}
                          </Text>
                        </div>
                      </div>
                      {revertPreviewPaginatedRows.map((row) => (
                        <div
                          key={`${row.variantId}-${row.revertTargetPrice}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: REVERT_PREVIEW_COMPARISON_GRID,
                            gap: "12px",
                            alignItems: "start",
                            padding: "12px 2px",
                            borderTop:
                              "1px solid var(--p-color-border-secondary)",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <BlockStack gap="0">
                              <div style={{ overflowWrap: "anywhere" }}>
                                <Text as="p" variant="bodySm">
                                  {row.productTitle}
                                </Text>
                              </div>
                              <div style={{ overflowWrap: "anywhere" }}>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {compactVariantIdentifier(row.variantId)}
                                </Text>
                              </div>
                              {(() => {
                                const subtitle = buildVariantSubtitle({
                                  productTitle: row.productTitle,
                                  variantTitle: row.variantTitle ?? null,
                                  sku: row.sku ?? null,
                                });

                                if (!subtitle) return null;

                                return (
                                  <div style={{ overflowWrap: "anywhere" }}>
                                    <Text
                                      as="p"
                                      variant="bodySm"
                                      tone="subdued"
                                    >
                                      {subtitle}
                                    </Text>
                                  </div>
                                );
                              })()}
                            </BlockStack>
                          </div>
                          <div
                            style={{
                              fontVariantNumeric: "tabular-nums",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Text
                              as="p"
                              variant="bodySm"
                              alignment="end"
                              tone="subdued"
                            >
                              {row.currentPrice == null
                                ? "-"
                                : formatMoney(row.currentPrice, currencyCode)}
                            </Text>
                          </div>
                          <div
                            style={{
                              fontVariantNumeric: "tabular-nums",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="medium"
                              alignment="end"
                            >
                              {formatMoney(row.revertTargetPrice, currencyCode)}
                            </Text>
                          </div>
                        </div>
                      ))}
                      {revertPreviewFilteredRows.length === 0 ? (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("dashboard.revertPreview.noMatchingProducts")}
                        </Text>
                      ) : null}
                      {revertPreview.rows.some((row) =>
                        Boolean(row.revertFailureReason),
                      ) && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("dashboard.revertPreview.recoveryNotesNotice")}
                        </Text>
                      )}
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`${t("dashboard.revertPreview.showingPrefix")} ${
                            revertPreviewFilteredRows.length === 0
                              ? 0
                              : (revertPreviewPage - 1) *
                                  revertPreviewPageSize +
                                1
                          }-${Math.min(
                            revertPreviewPage * revertPreviewPageSize,
                            revertPreviewFilteredRows.length,
                          )} ${t("dashboard.revertPreview.ofSuffix")} ${revertPreviewFilteredRows.length} ${t("dashboard.revertPreview.matchingProductsSuffix")}`}
                        </Text>
                        <Pagination
                          hasPrevious={revertPreviewPage > 1}
                          onPrevious={() =>
                            setRevertPreviewPage((prev) =>
                              Math.max(1, prev - 1),
                            )
                          }
                          hasNext={revertPreviewPage < revertPreviewTotalPages}
                          onNext={() =>
                            setRevertPreviewPage((prev) =>
                              Math.min(revertPreviewTotalPages, prev + 1),
                            )
                          }
                          label={`${t("dashboard.revertPreview.pagePrefix")} ${revertPreviewPage} ${t("dashboard.revertPreview.ofSuffix")} ${revertPreviewTotalPages}`}
                        />
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("dashboard.revertPreview.noPreviewData")}
                </Text>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* UPDATED TASK 4: Go Live confirmation modal */}
        <Modal
          open={showGoLiveModal}
          onClose={() => setShowGoLiveModal(false)}
          title={t("dashboard.goLiveModal.title")}
          primaryAction={{
            content: t("dashboard.goLiveModal.primaryCta"),
            // UPDATED: wraps existing handler — no logic change
            onAction: () => handlePushStorefront(false),
            loading: isProcessing,
            disabled: isProcessing,
          }}
          secondaryActions={[
            {
              content: t("common.cancel"),
              onAction: () => setShowGoLiveModal(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">{t("dashboard.goLiveModal.body")}</Text>
              <Box paddingInlineStart="400">
                <BlockStack gap="200">
                  <Text as="p">✔️ {t("dashboard.goLiveModal.bullet1")}</Text>
                  <Text as="p">✔️ {t("dashboard.goLiveModal.bullet2")}</Text>
                </BlockStack>
              </Box>
              <Text as="p">{t("dashboard.goLiveModal.confirmPrompt")}</Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* UPDATED TASK 4: Stop Live confirmation modal — destructive primary */}
        <Modal
          open={showStopModal}
          onClose={() => setShowStopModal(false)}
          title={t("dashboard.stopLiveModal.title")}
          primaryAction={{
            content: t("dashboard.stopLiveModal.primaryCta"),
            // UPDATED: wraps existing handler — no logic change
            onAction: () => handlePushStorefront(true),
            loading: isProcessing,
            disabled: isProcessing,
            destructive: true,
          }}
          secondaryActions={[
            {
              content: t("common.cancel"),
              onAction: () => setShowStopModal(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">{t("dashboard.stopLiveModal.body")}</Text>
              <Box paddingInlineStart="400">
                <BlockStack gap="200">
                  <Text as="p">✔️ {t("dashboard.stopLiveModal.bullet1")}</Text>
                  <Text as="p">✔️ {t("dashboard.stopLiveModal.bullet2")}</Text>
                </BlockStack>
              </Box>
            </BlockStack>
          </Modal.Section>
        </Modal>

        <BillingBlockModal
          open={billingBlockModalOpen}
          code={billingBlockModalCode}
          shop={shop}
          host={host}
          onClose={() => setBillingBlockModalOpen(false)}
        />

        <DiscardChangesModal
          open={overrideBlocker.state === "blocked"}
          onDiscard={discardOverrides}
          onKeepEditing={keepOverrides}
        />
      </Page>
    </>
  );
}
