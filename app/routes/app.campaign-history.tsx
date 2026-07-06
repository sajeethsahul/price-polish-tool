import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useNavigate, useOutletContext } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Select,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { RefreshIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { useAppFetch } from "../utils/fetch";
import { formatMoney } from "../utils/format";
import { resolveWindowLifecycleState } from "../utils/window-lifecycle";
import { PricePolishLoader, PRICE_POLISH_LOADER_COPY, useDelayedVisibility } from "../components/PricePolishLoader";
import { BillingBlockModal, type BillingBlockModalCode } from "../components/BillingBlockModal";
import { CampaignConflictExplorerModal } from "../components/CampaignConflictExplorerModal";
import { ModalPagination } from "../components/ModalPagination";
import { ModalScrollableSection } from "../components/ModalScrollableSection";
import { computeConflictsBetweenScheduledJobs, maxSeverity } from "../utils/campaign-conflicts";
import type { CampaignConflict, CampaignConflictSeverity } from "../types/pricing";
import { t } from "../utils/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticate.admin(request);
  if (auth instanceof Response) return auth;
  return {};
};

type TimelineTone = "success" | "warning" | "critical" | "info" | "attention";

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
  scheduledJobStatus?: string | null;
  mode?: string | null;
  activatedAt?: string | null;
  restoredAt?: string | null;
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

interface CampaignTimelineMilestone {
  key: string;
  label: string;
  tone: TimelineTone;
  badgeLabel?: string;
  timestamp?: string | null;
  description: string;
}

type CampaignHistoryStatusFilter = "all" | "active" | "partial" | "scheduled" | "closed";
type CampaignHistorySourceFilter = "all" | "manual" | "scheduled" | "time-window";
type CampaignHistoryTimeframeFilter = "week" | "month" | "3_months" | "6_months" | "year" | "all";
type RevertPreviewMovementFilter = "all" | "increase" | "decrease" | "large_movement";

const OPERATIONAL_PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 25];
const SELECT_OPTION_PREFIX = "\u2002";
const CAMPAIGN_DETAIL_COMPARISON_GRID = "minmax(0, 1fr) 132px 132px minmax(96px, auto)";
const REVERT_PREVIEW_COMPARISON_GRID = "minmax(0, 1fr) 132px 132px";
const REVERT_PREVIEW_DEFAULT_PAGE_SIZE = 15;
const REVERT_PREVIEW_LARGE_MOVEMENT_THRESHOLD = 15;
const LARGE_OPERATION_THRESHOLD = 100;
const VERY_LARGE_OPERATION_THRESHOLD = 250;
const MOST_VISIBLE_SCOPE_RATIO = 0.8;
const SIGNIFICANT_MOVEMENT_THRESHOLD = 25;

function normalizeMeaningfulVariantTitle(value: string | null | undefined, productTitle?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "default title") return null;
  const normalizedProductTitle = (productTitle ?? "").trim().toLowerCase();
  if (normalizedProductTitle && trimmed.toLowerCase() === normalizedProductTitle) return null;
  return trimmed;
}

function normalizeSku(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function buildVariantSubtitle(params: { productTitle?: string | null; variantTitle?: string | null; sku?: string | null }) {
  const variantTitle = normalizeMeaningfulVariantTitle(params.variantTitle, params.productTitle);
  const sku = normalizeSku(params.sku);
  const parts: string[] = [];
  if (variantTitle) parts.push(variantTitle);
  if (sku) parts.push(`SKU: ${sku}`);
  return parts.length > 0 ? parts.join(" • ") : null;
}

function computeProductVariantCounts(items: Array<{ productId?: string | null; variantId?: string | null }>) {
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

function normalizeCampaignStatus(status: string) {
  return status.toLowerCase();
}

function isClosedCampaignStatus(status: string) {
  const normalized = normalizeCampaignStatus(status);
  return normalized === "reverted" ||
    normalized === "unrecoverable" ||
    normalized === "auto-restored" ||
    normalized === "window-stopped" ||
    normalized === "cancelled-publish" ||
    normalized === "cancelled-window";
}

function normalizeCampaignSource(source: string | null) {
  return (source ?? "").trim().toLowerCase();
}

function resolveCampaignRuntimeStatus(campaign: CampaignHistoryItem, now: Date = new Date()) {
  const source = normalizeCampaignSource(campaign.source);
  const campaignStatus = normalizeCampaignStatus(campaign.runtimeStatus ?? campaign.status);
  const scheduledJobStatus = normalizeCampaignStatus(campaign.scheduledJobStatus ?? "");

  if (source === "scheduled") {
    if (campaignStatus === "cancelled-publish" || campaignStatus === "unrecoverable") return campaignStatus;

    if (scheduledJobStatus) {
      if (scheduledJobStatus === "pending") return "scheduled";
      if (scheduledJobStatus === "processing") return "publishing";
      if (scheduledJobStatus === "done") return "published";
      if (scheduledJobStatus === "failed") return "failed";
      if (scheduledJobStatus === "missed-during-uninstall") return "missed-during-uninstall";
      if (scheduledJobStatus === "cancelled") return "cancelled-publish";
    }

    if (campaignStatus === "scheduled-publish") return "scheduled";
    if (campaignStatus === "publishing") return "publishing";
    if (campaignStatus === "published") return "published";
    if (campaignStatus === "failed") return "failed";
    return campaignStatus;
  }

  if (source === "time-window") {
    if (campaignStatus === "cancelled-window" || campaignStatus === "window-stopped" || campaignStatus === "unrecoverable") return campaignStatus;

    if (scheduledJobStatus) {
      if (scheduledJobStatus === "pending") return "scheduled-window";
      if (scheduledJobStatus === "processing") return "publishing-window";
      if (scheduledJobStatus === "active-window") return "active-window";
      if (scheduledJobStatus === "restoring") return "restoring";
      if (scheduledJobStatus === "auto-restored") return "auto-restored";
      if (scheduledJobStatus === "restore-failed") return "restore-failed";
      if (scheduledJobStatus === "failed") return "failed";
      if (scheduledJobStatus === "missed-during-uninstall") return "missed-during-uninstall";
      if (scheduledJobStatus === "cancelled") return "cancelled-window";
    }

    const inferred = resolveWindowLifecycleState({
      status: campaignStatus,
      source: "schedule-window",
      runAt: campaign.runAt,
      windowEndAt: campaign.windowEndAt,
      restoredAt: campaign.restoredAt ?? null,
      totalTrackedCount: campaign.totalTrackedCount,
      revertedCount: campaign.revertedCount,
      unrecoverableCount: campaign.unrecoverableCount,
    }, now);

    return inferred ?? campaignStatus;
  }

  return campaignStatus;
}

function formatCampaignSourceLabel(source: string | null) {
  const normalized = normalizeCampaignSource(source);
  if (normalized === "manual") return "Manual";
  if (normalized === "scheduled") return "Scheduled";
  if (normalized === "time-window") return "Time Window";
  return source || "Unknown";
}

function formatTimeWindowSummary(campaign: CampaignHistoryItem) {
  if (normalizeCampaignSource(campaign.source) !== "time-window") return null;

  const status = resolveCampaignRuntimeStatus(campaign);
  const start = campaign.runAt ? new Date(campaign.runAt).toLocaleString() : null;
  const end = campaign.windowEndAt ? new Date(campaign.windowEndAt).toLocaleString() : null;

  if (status === "scheduled-window" && start && end) {
    return `Pricing will publish at ${start} and automatically restore at ${end}.`;
  }
  if (status === "publishing-window") {
    return "Applying scheduled pricing...";
  }
  if (status === "active-window" && end) {
    return "Pricing currently active.";
  }
  if (status === "restoring" || status === "expired-window") {
    return "Restoring original storefront pricing...";
  }
  if (status === "auto-restored") {
    return "Original storefront pricing restored.";
  }
  if (status === "restore-failed") {
    return "Scheduled pricing applied but automatic restore failed.";
  }
  if (status === "window-stopped") {
    return "Original storefront pricing was restored before the scheduled end time.";
  }
  if (status === "cancelled-window") {
    return "This pricing window was cancelled before it started.";
  }
  if (status === "missed-during-uninstall") {
    return "Schedule did not execute because the app was uninstalled during the execution window.";
  }
  if (status === "failed") {
    return "Scheduled pricing failed.";
  }
  if (status === "partial") {
    return "Automatic restore needs attention for one or more tracked products.";
  }

  return null;
}

function formatScheduledPublishSummary(campaign: CampaignHistoryItem, now: Date = new Date()) {
  if (normalizeCampaignSource(campaign.source) !== "scheduled") return null;
  const status = resolveCampaignRuntimeStatus(campaign, now);
  const runAt = campaign.runAt ? new Date(campaign.runAt) : null;
  if (status === "scheduled" && runAt && !Number.isNaN(runAt.getTime())) {
    return `Pricing will publish automatically at ${runAt.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  if (status === "publishing") return "Applying scheduled pricing...";
  if (status === "published") return "Pricing was published successfully.";
  if (status === "cancelled-publish") return "This scheduled publish was cancelled before it started.";
  if (status === "missed-during-uninstall") return "Schedule did not execute because the app was uninstalled during the execution window.";
  if (status === "failed") return "Scheduled pricing failed.";
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

function getTimeframeStart(filter: CampaignHistoryTimeframeFilter, now = new Date()) {
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

export default function CampaignHistoryPage() {
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const { currencyCode, hasActivePlan, shop, host } = useOutletContext<{ currencyCode: string; hasActivePlan: boolean; shop: string; host: string }>();
  const appFetch = useAppFetch();

  const [campaignHistory, setCampaignHistory] = useState<CampaignHistoryItem[]>([]);
  const [campaignHistoryLoading, setCampaignHistoryLoading] = useState(false);
  const [scheduleJobs, setScheduleJobs] = useState<any[]>([]);
  const [scheduleJobsLoading, setScheduleJobsLoading] = useState(false);
  const [hideClosedCampaigns, setHideClosedCampaigns] = useState(true);
  const [campaignHistoryStatusFilter, setCampaignHistoryStatusFilter] = useState<CampaignHistoryStatusFilter>("all");
  const [campaignHistorySourceFilter, setCampaignHistorySourceFilter] = useState<CampaignHistorySourceFilter>("all");
  const [campaignHistoryTimeframeFilter, setCampaignHistoryTimeframeFilter] = useState<CampaignHistoryTimeframeFilter>("month");
  const [campaignHistorySearchQuery, setCampaignHistorySearchQuery] = useState("");
  const [campaignRuntimeNow, setCampaignRuntimeNow] = useState(() => new Date());
  const [isProcessing, setIsProcessing] = useState(false);

  const [campaignDetailOpen, setCampaignDetailOpen] = useState(false);
  const [campaignDetailLoading, setCampaignDetailLoading] = useState(false);
  const [selectedCampaignForDetail, setSelectedCampaignForDetail] = useState<CampaignHistoryItem | null>(null);
  const [campaignDetail, setCampaignDetail] = useState<CampaignRevertPreviewData | null>(null);
  const [campaignDetailPageSize, setCampaignDetailPageSize] = useState(15);
  const [campaignDetailPage, setCampaignDetailPage] = useState(1);

  const [revertPreviewOpen, setRevertPreviewOpen] = useState(false);
  const [revertPreviewLoading, setRevertPreviewLoading] = useState(false);
  const [revertPreviewRetryFailedOnly, setRevertPreviewRetryFailedOnly] = useState(false);
  const [selectedCampaignForRevert, setSelectedCampaignForRevert] = useState<CampaignHistoryItem | null>(null);
  const [revertPreview, setRevertPreview] = useState<CampaignRevertPreviewData | null>(null);
  const [revertPreviewSearchQuery, setRevertPreviewSearchQuery] = useState("");
  const [revertPreviewMovementFilter, setRevertPreviewMovementFilter] = useState<RevertPreviewMovementFilter>("all");
  const [revertPreviewPageSize, setRevertPreviewPageSize] = useState(REVERT_PREVIEW_DEFAULT_PAGE_SIZE);
  const [revertPreviewPage, setRevertPreviewPage] = useState(1);

  const [visiblePreviewCount, setVisiblePreviewCount] = useState(0);
  const isInitialCampaignHistoryLoad = campaignHistoryLoading && campaignHistory.length === 0;
  const showInitialCampaignHistoryLoader = useDelayedVisibility(isInitialCampaignHistoryLoad, 300);
  const showCampaignDetailLoader = useDelayedVisibility(campaignDetailLoading, 300);
  const showRevertPreviewLoader = useDelayedVisibility(revertPreviewLoading, 300);
  const [conflictExplorerOpen, setConflictExplorerOpen] = useState(false);
  const [conflictExplorerTitle, setConflictExplorerTitle] = useState("Campaign");
  const [conflictExplorerConflicts, setConflictExplorerConflicts] = useState<CampaignConflict[]>([]);

  // Billing block modal state
  const [billingBlockModalOpen, setBillingBlockModalOpen] = useState(false);
  const [billingBlockModalCode, setBillingBlockModalCode] = useState<BillingBlockModalCode | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setCampaignRuntimeNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetcher = appFetch;
    void (async () => {
      try {
        const data = await fetcher("/api/preview-price").catch(() => ({}));
        const previews = Array.isArray((data as any)?.previews) ? (data as any).previews : [];
        setVisiblePreviewCount(previews.length);
      } catch {
        setVisiblePreviewCount(0);
      }
    })();
  }, [appFetch]);

  const handleRefreshCampaignHistory = useCallback(async (showLoading = true) => {
    if (showLoading) setCampaignHistoryLoading(true);
    try {
      const fetcher = appFetch;
      const campaignHistoryData = await fetcher("/api/campaign-history");
      const campaigns = Array.isArray((campaignHistoryData as any)?.campaigns) ? (campaignHistoryData as any).campaigns : [];
      setCampaignHistory(campaigns);
    } catch {
      (shopify as any)?.toast?.show?.(t("toast.failedRefreshCampaignHistory"), { isError: true });
    } finally {
      if (showLoading) setCampaignHistoryLoading(false);
    }
  }, [appFetch, shopify]);

  const handleRefreshScheduleJobs = useCallback(async (showLoading = true) => {
    if (showLoading) setScheduleJobsLoading(true);
    try {
      const fetcher = appFetch;
      const data = await fetcher("/api/schedule-history");
      const jobs = Array.isArray((data as any)?.jobs) ? (data as any).jobs : [];
      setScheduleJobs(jobs);
    } catch {
      setScheduleJobs([]);
    } finally {
      if (showLoading) setScheduleJobsLoading(false);
    }
  }, [appFetch]);

  useEffect(() => {
    void handleRefreshCampaignHistory(true);
    void handleRefreshScheduleJobs(true);
  }, [handleRefreshCampaignHistory, handleRefreshScheduleJobs]);

  const campaignHistoryCounts = useMemo(() => {
    return campaignHistory.reduce(
      (acc, campaign) => {
        const status = resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow);
        if (status === "active" || status === "active-window" || status === "published") {
          acc.active += 1;
        } else if (status === "partial") {
          acc.partial += 1;
        } else if (
          status === "scheduled" ||
          status === "scheduled-window" ||
          status === "scheduled-publish" ||
          status === "publishing" ||
          status === "publishing-window" ||
          status === "restoring"
        ) {
          acc.scheduled += 1;
        } else if (isClosedCampaignStatus(status)) {
          acc.closed += 1;
        }
        return acc;
      },
      { active: 0, partial: 0, scheduled: 0, closed: 0 }
    );
  }, [campaignHistory, campaignRuntimeNow]);

  const campaignHistoryStatusOptions = useMemo(
    () => [
      { label: `${SELECT_OPTION_PREFIX}All`, value: "all" },
      { label: `${SELECT_OPTION_PREFIX}Active (${campaignHistoryCounts.active})`, value: "active" },
      { label: `${SELECT_OPTION_PREFIX}Partial (${campaignHistoryCounts.partial})`, value: "partial" },
      { label: `${SELECT_OPTION_PREFIX}Scheduled`, value: "scheduled" },
      { label: `${SELECT_OPTION_PREFIX}Closed`, value: "closed" },
    ],
    [campaignHistoryCounts.active, campaignHistoryCounts.partial]
  );

  const campaignHistorySourceOptions = useMemo(
    () => [
      { label: `${SELECT_OPTION_PREFIX}All Sources`, value: "all" },
      { label: `${SELECT_OPTION_PREFIX}Manual`, value: "manual" },
      { label: `${SELECT_OPTION_PREFIX}Scheduled`, value: "scheduled" },
      { label: `${SELECT_OPTION_PREFIX}Time Window`, value: "time-window" },
    ],
    []
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
    []
  );

  const filteredCampaignHistory = useMemo(() => {
    const normalizedQuery = campaignHistorySearchQuery.trim().toLowerCase();

    return campaignHistory.filter((campaign) => {
      const status = resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow);
      const source = normalizeCampaignSource(campaign.source);
      const title = campaign.title.toLowerCase();
      const campaignId = campaign.campaignId.toLowerCase();
      const timeframeStart = getTimeframeStart(campaignHistoryTimeframeFilter, campaignRuntimeNow);
      const campaignCreatedAt = new Date(campaign.createdAt).getTime();
      const matchesTimeframe =
        !timeframeStart ||
        (!Number.isNaN(campaignCreatedAt) && campaignCreatedAt >= timeframeStart.getTime());

      const matchesStatus = (() => {
        if (campaignHistoryStatusFilter === "all") return true;
        if (campaignHistoryStatusFilter === "active") return status === "active" || status === "active-window" || status === "published";
        if (campaignHistoryStatusFilter === "partial") return status === "partial";
        if (campaignHistoryStatusFilter === "scheduled") {
          return status === "scheduled" ||
            status === "scheduled-window" ||
            status === "scheduled-publish" ||
            status === "publishing" ||
            status === "publishing-window" ||
            status === "restoring";
        }
        return isClosedCampaignStatus(status);
      })();

      const matchesSource =
        campaignHistorySourceFilter === "all" || source === campaignHistorySourceFilter;

      const matchesSearch =
        normalizedQuery.length === 0 ||
        title.includes(normalizedQuery) ||
        campaignId.includes(normalizedQuery);

      return matchesTimeframe && matchesStatus && matchesSource && matchesSearch;
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
    return filteredCampaignHistory.filter((campaign) => !isClosedCampaignStatus(campaign.status));
  }, [filteredCampaignHistory, hideClosedCampaigns]);

  const upcomingScheduleJobs = useMemo(() => {
    const nowMs = Date.now();
    const queueStatuses = new Set(["pending", "processing", "restoring"]);
    const activeWindowStatuses = new Set(["active-window"]);

    return scheduleJobs
      .filter((job) => job && typeof job.runAt === "string")
      .map((job) => {
        const runAtMs = new Date(job.runAt).getTime();
        const normalizedStatus = String(job.status ?? "").toLowerCase();
        return { ...job, runAtMs, normalizedStatus };
      })
      .filter((job) => Number.isFinite(job.runAtMs))
      .filter((job) => queueStatuses.has(job.normalizedStatus) || activeWindowStatuses.has(job.normalizedStatus) || job.runAtMs >= nowMs);
  }, [scheduleJobs]);

  const scheduledJobConflictsByJobId = useMemo(() => {
    return computeConflictsBetweenScheduledJobs(upcomingScheduleJobs);
  }, [upcomingScheduleJobs]);

  const campaignConflictMetaByCampaignId = useMemo(() => {
    const map = new Map<string, { conflicts: CampaignConflict[]; severity: CampaignConflictSeverity | null; count: number }>();

    for (const job of upcomingScheduleJobs) {
      const campaignId = String(job.campaignId ?? "").trim();
      if (!campaignId) continue;
      const conflicts = scheduledJobConflictsByJobId.get(String(job.id)) ?? [];
      const existing = map.get(campaignId);
      const merged = existing ? existing.conflicts.concat(conflicts) : conflicts;
      const severity = merged.length > 0 ? maxSeverity(merged) : null;
      const unique = new Set(merged.map((c) => c.conflicting.campaignId ?? c.conflicting.scheduledJobId ?? c.id));
      map.set(campaignId, { conflicts: merged, severity, count: unique.size });
    }

    return map;
  }, [scheduledJobConflictsByJobId, upcomingScheduleJobs]);

  const conflictExplorerLabelMaps = useMemo(() => {
    const productLabelById = new Map<string, string>();
    const variantLabelById = new Map<string, string>();

    for (const job of scheduleJobs) {
      const products = Array.isArray((job as any)?.products) ? ((job as any).products as any[]) : [];
      for (const item of products) {
        const productId = String((item as any)?.productId ?? "").trim();
        const variantId = String((item as any)?.variantId ?? "").trim();
        const productTitle = String((item as any)?.title ?? "").trim();
        const variantTitle = normalizeMeaningfulVariantTitle((item as any)?.variantTitle ?? null, productTitle);

        if (productId && productTitle && !productLabelById.has(productId)) {
          productLabelById.set(productId, productTitle);
        }
        if (variantId) {
          const label = productTitle
            ? (variantTitle ? `${productTitle} / ${variantTitle}` : productTitle)
            : variantTitle
              ? variantTitle
              : "";
          if (label && !variantLabelById.has(variantId)) {
            variantLabelById.set(variantId, label);
          }
        }
      }
    }

    return { productLabelById, variantLabelById };
  }, [scheduleJobs]);

  const campaignHistoryEmptyStateMessage = useMemo(() => {
    if (campaignHistory.length === 0) return "No campaigns recorded yet.";

    if (filteredCampaignHistory.length === 0) {
      if (campaignHistoryStatusFilter === "active") return "No active campaigns found.";
      if (campaignHistoryStatusFilter === "partial") return "No partial campaigns found.";
      if (campaignHistoryStatusFilter === "scheduled") return "No scheduled campaigns found.";
      if (campaignHistoryStatusFilter === "closed") return "No closed campaigns found.";
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

  const campaignStatusTone = useCallback((status: string) => {
    const normalized = status.toLowerCase();
    if (normalized === "active-window" || normalized === "active") return "success" as const;
    if (normalized === "partial") return "warning" as const;
    if (normalized === "reverted" || normalized === "auto-restored" || normalized === "unrecoverable" || normalized === "window-stopped" || normalized === "cancelled-publish" || normalized === "cancelled-window") return "info" as const;
    if (normalized === "scheduled" || normalized === "scheduled-window" || normalized === "scheduled-publish" || normalized === "pending") return "warning" as const;
    if (normalized === "publishing" || normalized === "publishing-window" || normalized === "restoring") return "attention" as const;
    if (normalized === "published") return "success" as const;
    if (normalized === "failed" || normalized === "restore-failed") return "critical" as const;
    if (normalized === "missed-during-uninstall") return "warning" as const;
    return "attention" as const;
  }, []);

  const campaignStatusLabel = useCallback((status: string) => {
    const normalized = status.toLowerCase();
    if (normalized === "scheduled") return "Scheduled";
    if (normalized === "scheduled-window") return "Scheduled Window";
    if (normalized === "publishing-window") return "Publishing Window";
    if (normalized === "active-window") return "Active Window";
    if (normalized === "restoring") return "Restoring";
    if (normalized === "expired-window") return "Expired Window";
    if (normalized === "auto-restored") return "Auto Restored";
    if (normalized === "window-stopped") return "Window Stopped";
    if (normalized === "cancelled-window") return "Cancelled Window";
    if (normalized === "scheduled-publish") return "Scheduled Publish";
    if (normalized === "cancelled-publish") return "Cancelled";
    if (normalized === "publishing") return "Publishing";
    if (normalized === "published") return "Published";
    if (normalized === "failed") return "Failed";
    if (normalized === "restore-failed") return "Restore Failed";
    if (normalized === "missed-during-uninstall") return "Missed During Uninstall";
    if (normalized === "unrecoverable") return "Unrecoverable";
    return status;
  }, []);

  const resetRevertPreviewViewState = useCallback(() => {
    setRevertPreviewSearchQuery("");
    setRevertPreviewMovementFilter("all");
    setRevertPreviewPageSize(REVERT_PREVIEW_DEFAULT_PAGE_SIZE);
    setRevertPreviewPage(1);
  }, []);

  const campaignDetailRows = campaignDetail?.rows ?? [];
  const campaignDetailCounts = useMemo(
    () => computeProductVariantCounts(campaignDetailRows),
    [campaignDetailRows]
  );
  const campaignDetailTotalPages = Math.max(1, Math.ceil(campaignDetailRows.length / campaignDetailPageSize));
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

  const detailStatusTone = useCallback((status?: string | null) => {
    const normalized = (status ?? "pending").toLowerCase();
    if (normalized === "reverted") return "success" as const;
    if (normalized === "failed") return "warning" as const;
    if (normalized === "unrecoverable") return "critical" as const;
    return "attention" as const;
  }, []);

  const detailStatusLabel = useCallback((status?: string | null) => {
    const normalized = (status ?? "pending").toLowerCase();
    if (normalized === "reverted") return "Reverted";
    if (normalized === "failed") return "Failed";
    if (normalized === "unrecoverable") return "Unrecoverable";
    if (normalized === "scheduled") return "Scheduled";
    return "Pending";
  }, []);

  const formatDetailScheduleType = useCallback((type?: string | null) => {
    if (type === "time-window") return "Time Window";
    return "One-time Publish";
  }, []);

  const formatTimelineTimestamp = useCallback((value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
  }, []);

  const campaignOperationalTimeline = useMemo<CampaignTimelineMilestone[]>(() => {
    if (!selectedCampaignForDetail) return [];

    const normalizedStatus = normalizeCampaignStatus(selectedCampaignForDetail.status);
    const failedCount = campaignDetail?.failedCount ?? selectedCampaignForDetail.failedCount ?? 0;
    const revertCompletedTimestamp =
      normalizedStatus === "reverted"
        ? formatTimelineTimestamp(campaignDetail?.revertCompletedAt ?? null)
        : null;

    const milestones: CampaignTimelineMilestone[] = [
      {
        key: "created",
        label: "Created",
        tone: "info",
        badgeLabel: "Recorded",
        timestamp: formatTimelineTimestamp(selectedCampaignForDetail.createdAt),
        description: "Campaign record created and ready for lifecycle actions.",
      },
    ];

    if (normalizedStatus === "scheduled-window") {
      milestones.push({
        key: "window-scheduled",
        label: "Window Scheduled",
        tone: "warning",
        badgeLabel: "Queued",
        timestamp: formatTimelineTimestamp(selectedCampaignForDetail.runAt ?? null),
        description: selectedCampaignForDetail.windowEndAt
          ? "Pricing will publish at the window start and automatically restore at the window end."
          : "Pricing window is queued for publishing and automatic restore.",
      });
    } else if (normalizedStatus === "scheduled" || normalizedStatus === "pending") {
      milestones.push({
        key: "scheduled",
        label: "Scheduled",
        tone: "warning",
        badgeLabel: "Queued",
        description: "Campaign is queued for execution.",
      });
    }

    if (normalizedStatus === "active-window") {
      milestones.push({
        key: "window-activated",
        label: "Window Activated",
        tone: "success",
        badgeLabel: "Active",
        timestamp: formatTimelineTimestamp(selectedCampaignForDetail.runAt ?? null),
        description: selectedCampaignForDetail.windowEndAt
          ? "Pricing is active now and will automatically restore at the scheduled end time."
          : "Pricing is active now and waiting for automatic restore.",
      });
    }

    if (normalizedStatus === "published") {
      milestones.push({
        key: "published",
        label: "Published",
        tone: failedCount > 0 ? "warning" : "success",
        badgeLabel: failedCount > 0 ? "Partial" : "Success",
        description: failedCount > 0
          ? "Pricing published with one or more failures."
          : "Pricing published successfully.",
      });
    } else if (normalizedStatus === "publishing") {
      milestones.push({
        key: "publishing",
        label: "Publishing",
        tone: "attention",
        badgeLabel: "Running",
        description: "Pricing updates are currently being applied.",
      });
    }

    if (normalizedStatus === "auto-restored") {
      milestones.push({
        key: "auto-restored",
        label: "Auto Restored",
        tone: "info",
        badgeLabel: "Restored",
        timestamp: formatTimelineTimestamp(campaignDetail?.revertCompletedAt ?? null),
        description: "Original pricing was automatically restored after the window ended.",
      });
    }

    if (normalizedStatus === "window-stopped") {
      milestones.push({
        key: "window-stopped",
        label: "Window Stopped",
        tone: "info",
        badgeLabel: "Stopped",
        timestamp: formatTimelineTimestamp(campaignDetail?.revertCompletedAt ?? null),
        description: "Original pricing was restored before the scheduled window end.",
      });
    }

    if (normalizedStatus === "cancelled-window") {
      milestones.push({
        key: "cancelled-window",
        label: "Cancelled",
        tone: "info",
        badgeLabel: "Cancelled",
        timestamp: formatTimelineTimestamp(selectedCampaignForDetail.runAt ?? null),
        description: "The scheduled pricing window was cancelled before it started.",
      });
    }

    if (normalizedStatus === "cancelled-publish") {
      milestones.push({
        key: "cancelled-publish",
        label: "Cancelled",
        tone: "info",
        badgeLabel: "Cancelled",
        timestamp: formatTimelineTimestamp(selectedCampaignForDetail.runAt ?? null),
        description: "The scheduled publish was cancelled before it started.",
      });
    }

    if (normalizedStatus === "failed") {
      milestones.push({
        key: "failed",
        label: "Failed",
        tone: "critical",
        badgeLabel: "Needs attention",
        description: "Campaign execution encountered failures and may require attention.",
      });
    }

    if (normalizedStatus === "partial") {
      milestones.push({
        key: "partial",
        label: "Partial",
        tone: "warning",
        badgeLabel: "Needs attention",
        description: "Campaign completed with partial results and requires attention.",
      });
    }

    if (normalizedStatus === "unrecoverable") {
      milestones.push({
        key: "unrecoverable",
        label: "Unrecoverable",
        tone: "critical",
        badgeLabel: "Blocked",
        timestamp: formatTimelineTimestamp(campaignDetail?.revertCompletedAt ?? null),
        description: selectedCampaignForDetail.unrecoverableReason
          ? `This campaign can no longer be reverted. ${selectedCampaignForDetail.unrecoverableReason}`
          : "This campaign can no longer be reverted.",
      });
    }

    if (normalizedStatus === "reverted") {
      milestones.push({
        key: "reverted",
        label: "Reverted",
        tone: "success",
        badgeLabel: "Restored",
        timestamp: revertCompletedTimestamp,
        description: "Original pricing was restored for this campaign.",
      });
    }

    return milestones;
  }, [campaignDetail?.failedCount, campaignDetail?.revertCompletedAt, formatTimelineTimestamp, selectedCampaignForDetail]);

  const openCampaignDetailView = useCallback(async (campaign: CampaignHistoryItem) => {
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
          ...(campaign.latestBatchId ? { batchId: campaign.latestBatchId } : {}),
          includeAllStatuses: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as any).error || "Failed to load campaign details.");
      }
      setCampaignDetail(data);
    } catch {
      (shopify as any)?.toast?.show?.(t("toast.failedLoadCampaignDetails"), { isError: true });
      setCampaignDetailOpen(false);
      setSelectedCampaignForDetail(null);
      setCampaignDetailPageSize(15);
      setCampaignDetailPage(1);
    } finally {
      setCampaignDetailLoading(false);
    }
  }, [shopify]);

  const openCampaignRevertPreview = useCallback(async (campaign: CampaignHistoryItem, retryFailedOnly = false) => {
    if (!campaign.revertable) return;
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
          ...(campaign.latestBatchId ? { batchId: campaign.latestBatchId } : {}),
          ...(retryFailedOnly ? { retryFailedOnly: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as any).error || "Failed to load revert preview.");
      }
      setRevertPreview(data);
    } catch {
      (shopify as any)?.toast?.show?.(t("toast.failedLoadRevertPreview"), { isError: true });
      setRevertPreviewOpen(false);
      setSelectedCampaignForRevert(null);
      resetRevertPreviewViewState();
    } finally {
      setRevertPreviewLoading(false);
    }
  }, [resetRevertPreviewViewState, shopify]);

  const openCampaignConflictDetails = useCallback((campaign: CampaignHistoryItem) => {
    const meta = campaignConflictMetaByCampaignId.get(campaign.campaignId);
    if (!meta || meta.conflicts.length === 0) {
      (shopify as any)?.toast?.show?.(t("toast.noConflictsDetected"));
      return;
    }
    setConflictExplorerTitle(campaign.title);
    setConflictExplorerConflicts(meta.conflicts);
    setConflictExplorerOpen(true);
  }, [campaignConflictMetaByCampaignId, shopify]);

  const handleWindowLifecycleAction = useCallback(async (
    campaign: CampaignHistoryItem,
    action: "cancel-schedule" | "stop-window"
  ) => {
    const actionLabel = action === "cancel-schedule" ? "cancel schedule" : "stop window";
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
        throw new Error((data as any).error || `Unable to ${actionLabel}.`);
      }
      (shopify as any)?.toast?.show?.(
        action === "cancel-schedule"
          ? "Pricing window cancelled"
          : "Original pricing restored and window stopped"
      );
      const nextStatus = action === "cancel-schedule" ? "cancelled-window" : (data as any).status ?? "window-stopped";
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
                  revertedCount: (data as any).restoredCount ?? item.revertedCount,
                  failedCount: (data as any).failedCount ?? item.failedCount,
                  unrecoverableCount: (data as any).unrecoverableCount ?? item.unrecoverableCount,
                }
                : {}),
            }
            : item
        )
      );
      await handleRefreshCampaignHistory(false);
    } catch {
      (shopify as any)?.toast?.show?.(
        action === "cancel-schedule"
          ? "Unable to cancel pricing window"
          : "Unable to stop pricing window",
        { isError: true }
      );
    } finally {
      setIsProcessing(false);
    }
  }, [handleRefreshCampaignHistory, shopify]);

  const handlePublishLifecycleAction = useCallback(async (campaign: CampaignHistoryItem) => {
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
        throw new Error((data as any).error || "Unable to cancel publish.");
      }
      setCampaignHistory((current) =>
        current.map((item) =>
          item.campaignId === campaign.campaignId
            ? { ...item, status: "cancelled-publish", runtimeStatus: "cancelled-publish", revertable: false }
            : item
        )
      );
      (shopify as any)?.toast?.show?.(t("toast.scheduledPublishCancelled"));
      await handleRefreshCampaignHistory(false);
    } catch {
      (shopify as any)?.toast?.show?.(t("toast.unableCancelScheduledPublish"), { isError: true });
    } finally {
      setIsProcessing(false);
    }
  }, [handleRefreshCampaignHistory, shopify]);

  const revertPreviewRows = revertPreview?.rows ?? [];
  const revertPreviewCounts = useMemo(() => computeProductVariantCounts(revertPreviewRows), [revertPreviewRows]);
  const revertPreviewFilteredRows = useMemo(() => {
    const normalizedQuery = revertPreviewSearchQuery.trim().toLowerCase();
    return revertPreviewRows.filter((row) => {
      const title = (row.productTitle ?? "").toLowerCase();
      if (normalizedQuery && !title.includes(normalizedQuery)) return false;

      if (revertPreviewMovementFilter === "all") return true;
      if (row.currentPrice == null || row.currentPrice <= 0) return false;
      const deltaPercent = ((row.revertTargetPrice - row.currentPrice) / row.currentPrice) * 100;
      if (!Number.isFinite(deltaPercent)) return false;
      if (revertPreviewMovementFilter === "increase") return deltaPercent > 0;
      if (revertPreviewMovementFilter === "decrease") return deltaPercent < 0;
      return Math.abs(deltaPercent) >= REVERT_PREVIEW_LARGE_MOVEMENT_THRESHOLD;
    });
  }, [revertPreviewMovementFilter, revertPreviewRows, revertPreviewSearchQuery]);

  const revertPreviewTotalPages = Math.max(1, Math.ceil(revertPreviewFilteredRows.length / revertPreviewPageSize));
  const revertPreviewPaginatedRows = useMemo(() => {
    const start = (revertPreviewPage - 1) * revertPreviewPageSize;
    return revertPreviewFilteredRows.slice(start, start + revertPreviewPageSize);
  }, [revertPreviewFilteredRows, revertPreviewPage, revertPreviewPageSize]);

  useEffect(() => {
    setRevertPreviewPage(1);
  }, [revertPreviewMovementFilter, revertPreviewSearchQuery, revertPreviewPageSize]);

  useEffect(() => {
    if (revertPreviewPage > revertPreviewTotalPages) setRevertPreviewPage(revertPreviewTotalPages);
  }, [revertPreviewPage, revertPreviewTotalPages]);

  const revertSafeguardNotices = useMemo(() => {
    if (!revertPreview || revertPreview.terminal) return [];

    const notices: Array<{ id: string; severity: "warning" | "informational"; message: string }> = [];
    const productCount = Number.isFinite(revertPreview.productCount) ? revertPreview.productCount : 0;
    const totalVisibleProducts = visiblePreviewCount;
    const affectsMostVisible =
      totalVisibleProducts > 0 &&
      productCount >= Math.max(25, Math.ceil(totalVisibleProducts * MOST_VISIBLE_SCOPE_RATIO));
    const storefrontWide = totalVisibleProducts > 0 && productCount >= Math.ceil(totalVisibleProducts * 0.95);
    let largestMovement = 0;

    for (const row of revertPreview.rows) {
      if (row.currentPrice == null || row.currentPrice <= 0) continue;
      const deltaPercent = ((row.revertTargetPrice - row.currentPrice) / row.currentPrice) * 100;
      if (Number.isFinite(deltaPercent)) {
        largestMovement = Math.max(largestMovement, Math.abs(deltaPercent));
      }
    }

    if (productCount >= LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "revert-large-scope",
        severity: "informational",
        message: "Large revert operation detected.",
      });
    }

    if (affectsMostVisible) {
      notices.push({
        id: "revert-most-visible",
        severity: "informational",
        message: "This revert restores pricing across most visible products.",
      });
    }

    if (storefrontWide) {
      notices.push({
        id: "revert-storefront-wide",
        severity: "informational",
        message: "This revert restores pricing across nearly all storefront products.",
      });
    }

    if (largestMovement >= SIGNIFICANT_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "revert-significant-movement",
        severity: "informational",
        message: "Some products contain significant pricing movement.",
      });
    }

    if (productCount >= VERY_LARGE_OPERATION_THRESHOLD) {
      notices.push({
        id: "revert-very-large-scope",
        severity: "warning",
        message: "Very large revert operation detected.",
      });
    }

    return notices;
  }, [revertPreview, visiblePreviewCount]);

  const confirmCampaignRevert = useCallback(async () => {
    if (!selectedCampaignForRevert) return;
    setIsProcessing(true);
    try {
      const res = await fetch("/api/undo-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: selectedCampaignForRevert.campaignId,
          ...(selectedCampaignForRevert.latestBatchId ? { batchId: selectedCampaignForRevert.latestBatchId } : {}),
          ...(revertPreviewRetryFailedOnly ? { retryFailedOnly: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "BILLING_INACTIVE") {
          throw new Error("Subscription inactive. Please reactivate billing to continue using Price Polish.");
        } else if (data.code === "BILLING_UNKNOWN") {
          throw new Error("Billing status could not be verified. Please refresh the app and try again.");
        } else {
          throw new Error((data as any).error || "Failed to revert campaign.");
        }
      }
      const terminalReason = selectedCampaignForRevert?.unrecoverableReason;
      if ((data as any)?.terminal === true) {
        const terminalMessage = terminalReason
          ? `This campaign can no longer be reverted because ${terminalReason.toLowerCase()}.`
          : ((data as any)?.message || "This campaign can no longer be reverted.");
        (shopify as any)?.toast?.show?.(terminalMessage, { isError: true });
      } else if ((data as any)?.message) {
        const operationalMessage = terminalReason
          ? `${(data as any).message} Reason: ${terminalReason}.`
          : (data as any).message;
        (shopify as any)?.toast?.show?.(operationalMessage);
      } else if ((data as any)?.restoredCount > 0) {
        (shopify as any)?.toast?.show?.(`Restored ${(data as any).restoredCount} products`);
      } else {
        const noRetryMessage = terminalReason
          ? `No retryable revert actions remain because ${terminalReason.toLowerCase()}.`
          : "No retryable revert actions remain.";
        (shopify as any)?.toast?.show?.(noRetryMessage, { isError: true });
      }

      setRevertPreviewOpen(false);
      setSelectedCampaignForRevert(null);
      setRevertPreview(null);
      setRevertPreviewRetryFailedOnly(false);
      resetRevertPreviewViewState();
      await handleRefreshCampaignHistory(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isBillingError = message.includes("Subscription inactive") || message.includes("Billing status could not be verified");
      if (isBillingError) {
        const code: BillingBlockModalCode = message.includes("Subscription inactive") ? "BILLING_INACTIVE" : "BILLING_UNKNOWN";
        // Close parent revert preview modal before showing billing modal
        setRevertPreviewOpen(false);
        setBillingBlockModalCode(code);
        setBillingBlockModalOpen(true);
      } else {
        (shopify as any)?.toast?.show?.(message || t("toast.failedRevertCampaign"), { isError: true });
      }
    } finally {
      setIsProcessing(false);
    }
  }, [handleRefreshCampaignHistory, resetRevertPreviewViewState, revertPreviewRetryFailedOnly, selectedCampaignForRevert, shopify]);

  return (
    <>
      <Page title={t("campaignHistory.pageTitle")} backAction={{ onAction: () => navigate("/app") }} fullWidth>
        {isInitialCampaignHistoryLoad ? (
          showInitialCampaignHistoryLoader ? (
            <PricePolishLoader
              title={PRICE_POLISH_LOADER_COPY.campaignHistory.title}
              subtitle={PRICE_POLISH_LOADER_COPY.campaignHistory.subtitle}
            />
          ) : (
            <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Spinner size="large" />
            </div>
          )
        ) : (
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Card>
              <BlockStack gap="300">
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    background: "var(--p-color-bg-surface, white)",
                    borderBottom: "1px solid var(--p-color-border-secondary)",
                    paddingBottom: 16,
                  }}
                >
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start" wrap>
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingMd">{t("campaignHistory.headerTitle")}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {t("campaignHistory.headerSubtitle")}
                        </Text>
                      </BlockStack>
                      <Button
                        size="slim"
                        variant="tertiary"
                        icon={RefreshIcon}
                        loading={campaignHistoryLoading}
                        disabled={campaignHistoryLoading}
                        onClick={() => {
                          void handleRefreshCampaignHistory();
                          void handleRefreshScheduleJobs(false);
                        }}
                      >
                        {t("campaignHistory.refresh")}
                      </Button>
                    </InlineStack>

                    <BlockStack gap="300">
                      <InlineStack gap="300" wrap align="start">
                        <div style={{ flex: "1 1 200px", minWidth: "180px" }}>
                          <Select
                            label={t("campaignHistory.status")}
                            options={campaignHistoryStatusOptions}
                            value={campaignHistoryStatusFilter}
                            onChange={(value) => setCampaignHistoryStatusFilter(value as CampaignHistoryStatusFilter)}
                          />
                        </div>
                        <div style={{ flex: "1 1 180px", minWidth: "160px" }}>
                          <Select
                            label={t("campaignHistory.source")}
                            options={campaignHistorySourceOptions}
                            value={campaignHistorySourceFilter}
                            onChange={(value) => setCampaignHistorySourceFilter(value as CampaignHistorySourceFilter)}
                          />
                        </div>
                        <div style={{ flex: "1 1 180px", minWidth: "170px" }}>
                          <Select
                            label={t("campaignHistory.timeframe")}
                            options={campaignHistoryTimeframeOptions}
                            value={campaignHistoryTimeframeFilter}
                            onChange={(value) => setCampaignHistoryTimeframeFilter(value as CampaignHistoryTimeframeFilter)}
                          />
                        </div>
                        <div style={{ flex: "2 1 260px", minWidth: "220px" }}>
                          <TextField
                            label={t("campaignHistory.searchCampaigns")}
                            value={campaignHistorySearchQuery}
                            onChange={(value) => {
                              if (value.length > 120) return;
                              setCampaignHistorySearchQuery(value);
                            }}
                            autoComplete="off"
                            placeholder={t("campaignHistory.searchPlaceholder")}
                            maxLength={120}
                          />
                        </div>
                      </InlineStack>
                      <Checkbox
                        label={t("campaignHistory.hideClosedCampaigns")}
                        checked={hideClosedCampaigns}
                        onChange={(checked) => setHideClosedCampaigns(checked)}
                      />

                      <Text as="p" variant="bodySm" tone="subdued">
                        Showing {visibleCampaignHistory.length} of {filteredCampaignHistory.length} matching campaigns
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </div>

                <div style={{ paddingBottom: 56 }}>
                  {visibleCampaignHistory.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {campaignHistoryEmptyStateMessage}
                    </Text>
                  ) : (
                    <BlockStack gap="200">
                      {visibleCampaignHistory.map((campaign) => {
                        const conflictMeta = campaignConflictMetaByCampaignId.get(campaign.campaignId) ?? null;
                        const conflictTone =
                          conflictMeta?.severity === "critical"
                            ? ("critical" as const)
                            : conflictMeta?.severity === "warning"
                              ? ("warning" as const)
                              : ("info" as const);

                        return (
                          <Box
                            key={campaign.campaignId}
                            padding="300"
                            background="bg-surface-secondary"
                            borderRadius="200"
                          >
                            <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
                          <div style={{ flex: "2 1 420px", minWidth: 260 }}>
                            <BlockStack gap="200">
                              <InlineStack gap="200" blockAlign="center" wrap>
                                <Text as="p" variant="bodyMd" fontWeight="medium">
                                  {campaign.title}
                                </Text>
                                <Badge tone={campaignStatusTone(resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow))}>
                                  {campaignStatusLabel(resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow))}
                                </Badge>
                                {conflictMeta?.count ? (
                                  <Badge tone={conflictTone}>
                                    {`Conflicts: ${conflictMeta.count}`}
                                  </Badge>
                                ) : null}
                                {resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "active-window" && (
                                  <Badge tone="success">Pricing Currently Active</Badge>
                                )}
                              </InlineStack>
                              {formatTimeWindowSummary(campaign) && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {formatTimeWindowSummary(campaign)}
                                </Text>
                              )}
                              {formatScheduledPublishSummary(campaign, campaignRuntimeNow) && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {formatScheduledPublishSummary(campaign, campaignRuntimeNow)}
                                </Text>
                              )}
                              {normalizeCampaignSource(campaign.source) === "scheduled" &&
                                resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "scheduled" &&
                                campaign.runAt && (
                                <Box padding="200" background="bg-surface" borderRadius="200">
                                  <BlockStack gap="100">
                                    <InlineStack gap="200" blockAlign="center" wrap>
                                      <Badge tone="warning">Scheduled</Badge>
                                      <Text as="p" variant="headingSm">
                                        {`Starts in ${formatDurationParts(new Date(campaign.runAt).getTime() - campaignRuntimeNow.getTime())}`}
                                      </Text>
                                    </InlineStack>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {`Publishing at ${new Date(campaign.runAt).toLocaleTimeString([], {
                                        hour: "numeric",
                                        minute: "2-digit",
                                      })}`}
                                    </Text>
                                  </BlockStack>
                                </Box>
                              )}
                              {(resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "publishing" ||
                                resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "publishing-window") && (
                                <Box padding="200" background="bg-surface" borderRadius="200">
                                  <InlineStack gap="200" blockAlign="center" wrap>
                                    <Spinner size="small" />
                                    <BlockStack gap="050">
                                      <Text as="p" variant="bodySm" fontWeight="medium">
                                        {resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "publishing-window"
                                          ? "Publishing window..."
                                          : "Publishing..."}
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        Applying scheduled pricing...
                                      </Text>
                                    </BlockStack>
                                  </InlineStack>
                                </Box>
                              )}
                              {resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "restoring" && (
                                <Box padding="200" background="bg-surface" borderRadius="200">
                                  <InlineStack gap="200" blockAlign="center" wrap>
                                    <Spinner size="small" />
                                    <BlockStack gap="050">
                                      <Text as="p" variant="bodySm" fontWeight="medium">
                                        Restoring...
                                      </Text>
                                      <Text as="p" variant="bodySm" tone="subdued">
                                        Restoring original storefront pricing...
                                      </Text>
                                    </BlockStack>
                                  </InlineStack>
                                </Box>
                              )}
                              {resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "active-window" && campaign.windowEndAt && (
                                <Box padding="200" background="bg-surface" borderRadius="200">
                                  <BlockStack gap="150">
                                    <InlineStack gap="200" blockAlign="center" wrap>
                                      <Badge tone="success">Live</Badge>
                                      <Text as="p" variant="headingSm">
                                        {`Restores in ${formatDurationParts(new Date(campaign.windowEndAt).getTime() - campaignRuntimeNow.getTime())}`}
                                      </Text>
                                    </InlineStack>
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {`Auto restore scheduled for ${new Date(campaign.windowEndAt).toLocaleTimeString([], {
                                        hour: "numeric",
                                        minute: "2-digit",
                                        second: "2-digit",
                                      })}`}
                                    </Text>
                                  </BlockStack>
                                </Box>
                              )}
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "180px 120px minmax(220px, 1fr)",
                                  columnGap: 24,
                                  rowGap: 4,
                                }}
                              >
                                <div>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Source: {formatCampaignSourceLabel(campaign.source)}
                                  </Text>
                                </div>
                                <div>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Products: {campaign.productCount}
                                  </Text>
                                </div>
                                <div>
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Created: {new Date(campaign.createdAt).toLocaleString()}
                                  </Text>
                                </div>
                              </div>
                            </BlockStack>
                          </div>

                          <div style={{ flex: "1 1 360px", minWidth: 260 }}>
                            <Box padding="200" background="bg-surface" borderRadius="200">
                              <BlockStack gap="150">
                                <InlineStack gap="150" wrap>
                                  <Badge tone="success">{`Reverted: ${campaign.revertedCount ?? 0}`}</Badge>
                                  <Badge tone="warning">{`Failed: ${campaign.failedCount ?? 0}`}</Badge>
                                </InlineStack>
                                <InlineStack gap="150" wrap>
                                  <Badge tone="critical">{`Unrecoverable: ${campaign.unrecoverableCount ?? 0}`}</Badge>
                                  <Badge tone="info">{`Tracked: ${campaign.totalTrackedCount ?? 0}`}</Badge>
                                </InlineStack>
                              </BlockStack>
                            </Box>
                            {campaign.unrecoverableReason && (
                              <Box paddingBlockStart="100">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Reason: {campaign.unrecoverableReason}
                                </Text>
                              </Box>
                            )}
                          </div>

                          <div style={{ flex: "0 1 auto", marginInlineStart: "auto" }}>
                            <BlockStack gap="150" align="end">
                              {conflictMeta?.count ? (
                                <Button
                                  size="slim"
                                  variant="tertiary"
                                  disabled={scheduleJobsLoading}
                                  onClick={() => openCampaignConflictDetails(campaign)}
                                >
                                  View Conflict Details
                                </Button>
                              ) : null}
                              <Button
                                size="slim"
                                variant="tertiary"
                                onClick={() => { void openCampaignDetailView(campaign); }}
                              >
                                View
                              </Button>
                              {resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "scheduled-window" && (
                                <Button
                                  size="slim"
                                  variant="secondary"
                                  disabled={isProcessing}
                                  loading={isProcessing}
                                  onClick={() => {
                                    void handleWindowLifecycleAction(campaign, "cancel-schedule");
                                  }}
                                >
                                  Cancel Schedule
                                </Button>
                              )}
                              {normalizeCampaignSource(campaign.source) === "scheduled" &&
                                resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "scheduled" && (
                                <Button
                                  size="slim"
                                  variant="secondary"
                                  disabled={isProcessing}
                                  loading={isProcessing}
                                  onClick={() => {
                                    void handlePublishLifecycleAction(campaign);
                                  }}
                                >
                                  Cancel Publish
                                </Button>
                              )}
                              {resolveCampaignRuntimeStatus(campaign, campaignRuntimeNow) === "active-window" && (
                                <Button
                                  size="slim"
                                  tone="critical"
                                  disabled={isProcessing}
                                  loading={isProcessing}
                                  onClick={() => {
                                    void handleWindowLifecycleAction(campaign, "stop-window");
                                  }}
                                >
                                  Stop Window
                                </Button>
                              )}
                              {campaign.status.toLowerCase() === "partial" && campaign.revertable && (
                                <Button
                                  size="slim"
                                  variant="secondary"
                                  disabled={isProcessing}
                                  loading={isProcessing}
                                  onClick={() => openCampaignRevertPreview(campaign, true)}
                                >
                                  Retry Failed Reverts
                                </Button>
                              )}
                              {campaign.revertable && normalizeCampaignSource(campaign.source) !== "time-window" && (
                                <Button
                                  size="slim"
                                  tone="critical"
                                  disabled={isProcessing || !hasActivePlan}
                                  loading={isProcessing}
                                  onClick={() => openCampaignRevertPreview(campaign)}
                                >
                                  Revert
                                </Button>
                              )}
                            </BlockStack>
                          </div>
                        </InlineStack>
                          </Box>
                        );
                      })}
                  </BlockStack>
                )}
              </div>
            </BlockStack>
          </Card>
          </div>
        )}
      </Page>

      <CampaignConflictExplorerModal
        open={conflictExplorerOpen}
        onClose={() => setConflictExplorerOpen(false)}
        primaryTitle={conflictExplorerTitle}
        conflicts={conflictExplorerConflicts}
        productLabelById={conflictExplorerLabelMaps.productLabelById}
        variantLabelById={conflictExplorerLabelMaps.variantLabelById}
      />

      <Modal
        open={campaignDetailOpen}
        onClose={() => {
          setCampaignDetailOpen(false);
          setCampaignDetail(null);
          setSelectedCampaignForDetail(null);
          setCampaignDetailPageSize(15);
          setCampaignDetailPage(1);
        }}
        title={`Campaign Details${selectedCampaignForDetail ? `: ${selectedCampaignForDetail.title}` : ""}`}
        secondaryActions={[{
          content: t("common.close"),
          onAction: () => {
            setCampaignDetailOpen(false);
            setCampaignDetail(null);
            setSelectedCampaignForDetail(null);
            setCampaignDetailPageSize(15);
            setCampaignDetailPage(1);
          },
        }]}
      >
        <Modal.Section>
          <ModalScrollableSection>
            <BlockStack gap="300">
              {campaignDetailLoading ? (
                showCampaignDetailLoader ? (
                  <PricePolishLoader
                    title={PRICE_POLISH_LOADER_COPY.campaignDetails.title}
                    subtitle={PRICE_POLISH_LOADER_COPY.campaignDetails.subtitle}
                    minHeight={260}
                  />
                ) : (
                  <InlineStack align="center" blockAlign="center">
                    <Spinner size="small" />
                  </InlineStack>
                )
              ) : campaignDetail ? (
                <>
                <InlineStack gap="300" wrap>
                  <Text as="p" variant="bodySm">
                    <strong>Campaign:</strong> {campaignDetail.title}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>{campaignDetail.preActivation || campaignDetail.prePublish || campaignDetail.staged ? "Scheduled products" : "Tracked items"}:</strong>{" "}
                    {(() => {
                      const fallbackCount = campaignDetail.preActivation || campaignDetail.prePublish || campaignDetail.staged
                        ? campaignDetail.productCount
                        : campaignDetail.totalTrackedCount ?? campaignDetail.rows.length;
                      const counts = campaignDetailCounts.productCount > 0
                        ? campaignDetailCounts
                        : { productCount: fallbackCount, variantCount: fallbackCount };
                      if (counts.variantCount !== counts.productCount) {
                        return `${counts.productCount} products • ${counts.variantCount} variants`;
                      }
                      return `${counts.productCount} products`;
                    })()}
                  </Text>
                </InlineStack>

                {campaignDetail.preActivation || campaignDetail.prePublish || campaignDetail.staged ? (
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <InlineStack gap="200" wrap>
                        <Badge tone={
                          campaignDetail.staged
                            ? "attention"
                            : campaignDetail.schedule?.status === "cancelled-window" ||
                              campaignDetail.schedule?.status === "cancelled-publish"
                              ? "info"
                              : "warning"
                        }>
                          {campaignDetail.staged
                            ? "Ready to Publish"
                            : campaignDetail.schedule?.status === "cancelled-window"
                              ? "Cancelled Window"
                              : campaignDetail.schedule?.status === "cancelled-publish"
                                ? "Cancelled"
                                : campaignDetail.prePublish
                                  ? "Publish Scheduled"
                                  : "Window Scheduled"}
                        </Badge>
                        {!campaignDetail.staged && (
                          <Badge tone="attention">
                            {formatDetailScheduleType(campaignDetail.schedule?.type)}
                          </Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm">
                        {campaignDetail.staged
                          ? "This campaign has been staged but has not yet been published."
                          : campaignDetail.schedule?.status === "cancelled-window"
                            ? "This pricing window was cancelled before it started."
                            : campaignDetail.schedule?.status === "cancelled-publish"
                              ? "This scheduled publish was cancelled before it started."
                              : campaignDetail.prePublish
                                ? "This pricing publish is scheduled and has not started yet."
                                : "This pricing window is scheduled and has not started yet."}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {campaignDetail.staged
                          ? "Go to the Dashboard to publish these changes."
                          : campaignDetail.schedule?.status === "cancelled-window" ||
                            campaignDetail.schedule?.status === "cancelled-publish"
                            ? "No storefront pricing was changed for this cancelled schedule."
                            : campaignDetail.prePublish
                              ? "Applied storefront details will appear after publishing completes."
                              : "Tracked storefront pricing details will appear once the publish window activates."}
                      </Text>
                      {campaignDetail.staged && (
                        <InlineStack gap="200" wrap>
                          <Button variant="secondary" onClick={() => navigate("/app")}>
                            Go to Dashboard
                          </Button>
                        </InlineStack>
                      )}
                      <InlineStack gap="400" wrap>
                        {campaignDetail.schedule?.runAt && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Publish start: {new Date(campaignDetail.schedule.runAt).toLocaleString()}
                          </Text>
                        )}
                        {campaignDetail.schedule?.windowEndAt && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Automatic restore: {new Date(campaignDetail.schedule.windowEndAt).toLocaleString()}
                          </Text>
                        )}
                        <Text as="p" variant="bodySm" tone="subdued">
                          {(() => {
                            const counts = campaignDetailCounts.productCount > 0
                              ? campaignDetailCounts
                              : { productCount: campaignDetail.productCount, variantCount: campaignDetail.productCount };
                            if (counts.variantCount !== counts.productCount) {
                              return `Intended pricing scope: ${counts.productCount} products • ${counts.variantCount} variants`;
                            }
                            return `Intended pricing scope: ${counts.productCount} products`;
                          })()}
                        </Text>
                        {campaignDetail.schedule?.createdAt && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Created: {new Date(campaignDetail.schedule.createdAt).toLocaleString()}
                          </Text>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </Box>
                ) : (
                  <BlockStack gap="200">
                    {selectedCampaignForDetail &&
                      resolveCampaignRuntimeStatus(selectedCampaignForDetail, campaignRuntimeNow) === "active-window" && (
                        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                          <BlockStack gap="150">
                            <InlineStack gap="200" wrap>
                              <Badge tone="success">Pricing Currently Active</Badge>
                              <Badge tone="attention">Time Window</Badge>
                            </InlineStack>
                            <InlineStack gap="400" wrap>
                              {selectedCampaignForDetail.runAt && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Active since: {new Date(selectedCampaignForDetail.runAt).toLocaleString()}
                                </Text>
                              )}
                              {selectedCampaignForDetail.windowEndAt && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Restore time: {new Date(selectedCampaignForDetail.windowEndAt).toLocaleString()}
                                </Text>
                              )}
                            </InlineStack>
                            {selectedCampaignForDetail.windowEndAt && (
                              <Text as="p" variant="bodySm" fontWeight="medium">
                                {`Remaining duration: ${formatDurationParts(
                                  new Date(selectedCampaignForDetail.windowEndAt).getTime() -
                                  campaignRuntimeNow.getTime()
                                )}`}
                              </Text>
                            )}
                          </BlockStack>
                        </Box>
                      )}
                    <InlineStack gap="200" wrap>
                      <Badge tone="success">{`Reverted: ${campaignDetail.revertedCount ?? 0}`}</Badge>
                      <Badge tone="warning">{`Failed: ${campaignDetail.failedCount ?? 0}`}</Badge>
                      <Badge tone="critical">{`Unrecoverable: ${campaignDetail.unrecoverableCount ?? 0}`}</Badge>
                    </InlineStack>
                  </BlockStack>
                )}

                {campaignOperationalTimeline.length > 0 && (
                  <Box padding="300" background="bg-surface" borderRadius="200">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Operational timeline
                      </Text>
                      <div
                        style={{
                          borderLeft: "2px solid var(--p-color-border-secondary)",
                          paddingLeft: 12,
                        }}
                      >
                        <BlockStack gap="200">
                          {campaignOperationalTimeline.map((milestone, index) => (
                            <div
                              key={milestone.key}
                              style={{
                                position: "relative",
                                paddingLeft: 10,
                                paddingBottom: index === campaignOperationalTimeline.length - 1 ? 0 : 2,
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
                              <InlineStack align="space-between" blockAlign="start" wrap={false}>
                                <InlineStack gap="200" blockAlign="center">
                                  <Text as="p" variant="bodySm" fontWeight="medium">
                                    {milestone.label}
                                  </Text>
                                  <Badge tone={milestone.tone}>
                                    {milestone.badgeLabel ?? "Milestone"}
                                  </Badge>
                                </InlineStack>
                                {milestone.timestamp ? (
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    {milestone.timestamp}
                                  </Text>
                                ) : null}
                              </InlineStack>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {milestone.description}
                              </Text>
                            </div>
                          ))}
                        </BlockStack>
                      </div>
                    </BlockStack>
                  </Box>
                )}

                <Box padding="200" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="300">
                    <ModalPagination
                      totalCount={campaignDetailRows.length}
                      page={campaignDetailPage}
                      pageSize={campaignDetailPageSize}
                      onPageChange={(nextPage) => setCampaignDetailPage(nextPage)}
                      onPageSizeChange={(nextSize) => setCampaignDetailPageSize(nextSize)}
                      itemLabel={campaignDetail.preActivation || campaignDetail.prePublish || campaignDetail.staged ? "scheduled products" : "tracked items"}
                      pageSizeOptions={OPERATIONAL_PAGE_SIZE_OPTIONS}
                    />

                    <Box padding="200" background="bg-surface" borderRadius="200">
                      <BlockStack gap="150">
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: CAMPAIGN_DETAIL_COMPARISON_GRID,
                            gap: "12px",
                            alignItems: "center",
                            paddingInline: "2px",
                          }}
                        >
                          <Text as="p" variant="bodySm" fontWeight="medium">Product</Text>
                          <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                              Current
                            </Text>
                          </div>
                          <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                              {campaignDetail.preActivation || campaignDetail.prePublish || campaignDetail.staged ? "Scheduled" : "Revert Target"}
                            </Text>
                          </div>
                          <Text as="p" variant="bodySm" fontWeight="medium">Status</Text>
                        </div>
                        <div style={campaignDetailPaginatedRows.length > 10 ? { maxHeight: 300, overflowY: "auto", paddingRight: 4 } : undefined}>
                          {campaignDetailPaginatedRows.map((row) => {
                            const subtitle = buildVariantSubtitle({
                              productTitle: row.productTitle ?? null,
                              variantTitle: row.variantTitle ?? null,
                              sku: row.sku ?? null,
                            });

                            return (
                              <div
                                key={`${row.variantId}-${row.revertTargetPrice}`}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: CAMPAIGN_DETAIL_COMPARISON_GRID,
                                  gap: "12px",
                                  alignItems: "start",
                                  padding: "12px 2px",
                                  borderTop: "1px solid var(--p-color-border-secondary)",
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <Text as="p" variant="bodySm" fontWeight="medium">
                                    {row.productTitle}
                                  </Text>
                                  {subtitle && (
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {subtitle}
                                    </Text>
                                  )}
                                </div>
                                <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                  <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                                    {row.currentPrice == null ? "-" : formatMoney(row.currentPrice, currencyCode)}
                                  </Text>
                                </div>
                                <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                  <Text
                                    as="p"
                                    variant="bodySm"
                                    fontWeight="medium"
                                    alignment="end"
                                    tone={campaignDetail.preActivation || campaignDetail.prePublish || campaignDetail.staged ? undefined : "success"}
                                  >
                                    {campaignDetail.preActivation || campaignDetail.prePublish || campaignDetail.staged
                                      ? row.scheduledPrice == null
                                        ? "-"
                                        : formatMoney(row.scheduledPrice, currencyCode)
                                      : formatMoney(row.revertTargetPrice, currencyCode)}
                                  </Text>
                                </div>
                                <InlineStack align="start" blockAlign="center">
                                  <Badge tone={detailStatusTone(row.status)}>
                                    {detailStatusLabel(row.status)}
                                  </Badge>
                                </InlineStack>
                              </div>
                            );
                          })}
                        </div>
                        {(campaignDetail.missingHistoricalRevertedFromCount ?? 0) > 0 && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            Some historical pre-revert values are unavailable. Restored values remain accurate.
                          </Text>
                        )}
                      </BlockStack>
                    </Box>
                  </BlockStack>
                </Box>
              </>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                No campaign detail data available.
              </Text>
            )}
            </BlockStack>
          </ModalScrollableSection>
        </Modal.Section>
      </Modal>

      <Modal
        open={revertPreviewOpen}
        onClose={() => {
          if (isProcessing) return;
          setRevertPreviewOpen(false);
          setSelectedCampaignForRevert(null);
          setRevertPreview(null);
          setRevertPreviewRetryFailedOnly(false);
          resetRevertPreviewViewState();
        }}
        title={`${revertPreviewRetryFailedOnly ? "Retry Failed Reverts" : "Revert Campaign"}${selectedCampaignForRevert ? `: ${selectedCampaignForRevert.title}` : ""}`}
        primaryAction={
          revertPreview?.terminal
            ? undefined
            : {
              content: revertPreviewRetryFailedOnly ? "Confirm Retry" : "Confirm Revert",
              onAction: () => { void confirmCampaignRevert(); },
              destructive: true,
              loading: isProcessing,
              disabled: isProcessing || revertPreviewLoading || !selectedCampaignForRevert,
            }
        }
        secondaryActions={[{
          content: t("common.cancel"),
          onAction: () => {
            setRevertPreviewOpen(false);
            setSelectedCampaignForRevert(null);
            setRevertPreview(null);
            setRevertPreviewRetryFailedOnly(false);
            resetRevertPreviewViewState();
          },
        }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            {revertPreviewLoading ? (
              showRevertPreviewLoader ? (
                <PricePolishLoader
                  title={PRICE_POLISH_LOADER_COPY.revertPreview.title}
                  subtitle={PRICE_POLISH_LOADER_COPY.revertPreview.subtitle}
                  minHeight={260}
                />
              ) : (
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="small" />
                </InlineStack>
              )
            ) : revertPreview ? (
              <>
                {revertPreview.message && (
                  <Banner tone={revertPreview.terminal ? "warning" : "info"}>
                    <p>{revertPreview.message}</p>
                  </Banner>
                )}
                <Text as="p" variant="bodySm" tone="subdued">
                  Review the current storefront prices against revert target prices before confirming.
                </Text>
                <InlineStack gap="300" wrap>
                  <Text as="p" variant="bodySm">
                    <strong>Campaign:</strong> {revertPreview.title}
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>Affected products:</strong>{" "}
                    {revertPreviewCounts.variantCount !== revertPreviewCounts.productCount
                      ? `${revertPreviewCounts.productCount} • ${revertPreviewCounts.variantCount} variants`
                      : revertPreviewCounts.productCount}
                  </Text>
                </InlineStack>
                <InlineStack gap="200" wrap>
                  <Badge
                    tone={
                      revertPreview.productCount >= VERY_LARGE_OPERATION_THRESHOLD
                        ? "warning"
                        : "info"
                    }
                  >
                    {revertPreviewCounts.variantCount !== revertPreviewCounts.productCount
                      ? `Affected products: ${revertPreviewCounts.productCount} • ${revertPreviewCounts.variantCount} variants`
                      : `Affected products: ${revertPreviewCounts.productCount}`}
                  </Badge>
                  <Badge tone="success">
                    {`Revert rows in preview: ${revertPreview.rows.length}`}
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
                      <InlineStack align="space-between" blockAlign="center" wrap>
                        <Text as="p" variant="bodySm" fontWeight="medium">
                          Operational safeguards
                        </Text>
                        <InlineStack gap="100" wrap>
                          <Badge tone="warning">
                            {`${revertSafeguardNotices.filter((notice) => notice.severity === "warning").length} Warning${
                              revertSafeguardNotices.filter((notice) => notice.severity === "warning").length === 1
                                ? ""
                                : "s"
                            }`}
                          </Badge>
                          <Badge tone="info">
                            {`${revertSafeguardNotices.filter((notice) => notice.severity === "informational").length} Info`}
                          </Badge>
                        </InlineStack>
                      </InlineStack>
                      <BlockStack gap="150">
                        {revertSafeguardNotices.map((notice) => (
                          <InlineStack key={notice.id} gap="200" blockAlign="center">
                            <Badge tone={notice.severity === "warning" ? "warning" : "info"}>
                              {notice.severity === "warning" ? "Warning" : "Info"}
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
                  <InlineStack gap="200" wrap align="space-between" blockAlign="end">
                    <div style={{ minWidth: 220, flex: "1 1 320px" }}>
                      <TextField
                        label="Search product"
                        value={revertPreviewSearchQuery}
                        onChange={setRevertPreviewSearchQuery}
                        placeholder="Search by product title"
                        autoComplete="off"
                        disabled={isProcessing}
                      />
                    </div>
                    <div style={{ minWidth: 210 }}>
                      <Select
                        label="Movement filter"
                        options={[
                          { label: `${SELECT_OPTION_PREFIX}All products`, value: "all" },
                          { label: `${SELECT_OPTION_PREFIX}Price increases`, value: "increase" },
                          { label: `${SELECT_OPTION_PREFIX}Price decreases`, value: "decrease" },
                          { label: `${SELECT_OPTION_PREFIX}Large movements`, value: "large_movement" },
                        ]}
                        value={revertPreviewMovementFilter}
                        onChange={(value) =>
                          setRevertPreviewMovementFilter(value as RevertPreviewMovementFilter)
                        }
                        disabled={isProcessing}
                      />
                    </div>
                    <div style={{ minWidth: 130 }}>
                      <Select
                        label="Rows per page"
                        options={OPERATIONAL_PAGE_SIZE_OPTIONS.map((size) => ({
                          label: `${SELECT_OPTION_PREFIX}${size}`,
                          value: String(size),
                        }))}
                        value={String(revertPreviewPageSize)}
                        onChange={(value) => setRevertPreviewPageSize(Number(value))}
                        disabled={isProcessing}
                      />
                    </div>
                  </InlineStack>
                </Box>
                <Box padding="200" background="bg-surface-secondary" borderRadius="200">
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
                      <Text as="p" variant="bodySm" fontWeight="medium">Product</Text>
                      <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                          Current
                        </Text>
                      </div>
                      <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                          Revert Target
                        </Text>
                      </div>
                    </div>
                    {revertPreviewPaginatedRows.map((row) => {
                      const subtitle = buildVariantSubtitle({
                        productTitle: row.productTitle ?? null,
                        variantTitle: row.variantTitle ?? null,
                        sku: row.sku ?? null,
                      });
                      return (
                        <div
                          key={`${row.variantId}-${row.revertTargetPrice}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: REVERT_PREVIEW_COMPARISON_GRID,
                            gap: "12px",
                            alignItems: "start",
                            padding: "12px 2px",
                            borderTop: "1px solid var(--p-color-border-secondary)",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <Text as="p" variant="bodySm" fontWeight="medium">
                              {row.productTitle}
                            </Text>
                            {subtitle && (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {subtitle}
                              </Text>
                            )}
                          </div>
                          <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            <Text as="p" variant="bodySm" fontWeight="medium" alignment="end">
                              {row.currentPrice == null ? "-" : formatMoney(row.currentPrice, currencyCode)}
                            </Text>
                          </div>
                          <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            <Text as="p" variant="bodySm" fontWeight="medium" alignment="end" tone="success">
                              {formatMoney(row.revertTargetPrice, currencyCode)}
                            </Text>
                          </div>
                        </div>
                      );
                    })}
                    <InlineStack align="end">
                      <Pagination
                        hasPrevious={revertPreviewPage > 1}
                        onPrevious={() => setRevertPreviewPage((prev) => Math.max(1, prev - 1))}
                        hasNext={revertPreviewPage < revertPreviewTotalPages}
                        onNext={() =>
                          setRevertPreviewPage((prev) =>
                            Math.min(revertPreviewTotalPages, prev + 1)
                          )
                        }
                        label={`Page ${revertPreviewPage} of ${revertPreviewTotalPages}`}
                      />
                    </InlineStack>
                  </BlockStack>
                </Box>
              </>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">
                No revert preview data available.
              </Text>
            )}
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
    </>
  );
}
