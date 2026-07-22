import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import {
  Modal,
  DataTable,
  Badge,
  Text,
  BlockStack,
  Button,
  Box,
  InlineStack,
  Spinner,
  Select,
  TextField,
  Pagination,
} from "@shopify/polaris";
import { useAppFetch } from "../utils/fetch";
import { formatMoney } from "../utils/format";
import { CampaignConflictExplorerModal } from "./CampaignConflictExplorerModal";
import { ExpandableList } from "./ExpandableList";
import { ModalScrollableSection } from "./ModalScrollableSection";
import { BillingBlockModal, type BillingBlockModalCode } from "./BillingBlockModal";
import { DiscardChangesModal } from "../components/DiscardChangesModal";
import { computeConflictsForCandidateSchedule } from "../utils/campaign-conflicts";
import { t } from "../utils/i18n";
import type {
  OperationalSafeguardNotice,
  OperationalSafeguardSeverity,
  PricingPreviewItem,
  ScheduledProductSnapshot,
} from "../types/pricing";

interface ScheduledJob {
  id: string;
  campaignId?: string | null;
  title: string;
  runAt: string;
  mode?: "one-time" | "time-window" | string;
  windowEndAt?: string | null;
  activatedAt?: string | null;
  restoredAt?: string | null;
  status: string;
  productCount: number;
  products: ScheduledProductSnapshot[] | null;
}

type ScheduleScope = "none" | "all" | "selected" | "filtered";
type ScheduleMode = "one-time" | "time-window";

const LARGE_SCHEDULE_THRESHOLD = 100;
const VERY_LARGE_SCHEDULE_THRESHOLD = 250;
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

function computeProductVariantCounts(items: Array<{ productId?: string | null; variantId?: string | null; title?: string | null }>) {
  const productKeys = new Set<string>();
  const variantIds = new Set<string>();

  for (const item of items) {
    const productKey = (item.productId ?? item.title ?? "").trim();
    const variantId = (item.variantId ?? "").trim();
    if (productKey) productKeys.add(productKey);
    if (variantId) variantIds.add(variantId);
  }

  const variantCount = variantIds.size || items.length;
  const productCount = productKeys.size || Math.min(items.length, variantCount);
  return { productCount, variantCount };
}
const MAJOR_MOVEMENT_THRESHOLD = 40;
const OPERATIONAL_PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 25];
const SELECT_OPTION_PREFIX = "\u2002";

export interface ScheduledHistoryModalProps {
  open: boolean;
  onClose: () => void;
  currencyCode: string;
  shop: string;
  host: string;
  previews: PricingPreviewItem[];
  filteredPreviews: PricingPreviewItem[];
  selectedItems: Set<string>;
  collectionId: string;
  hasActivePlan: boolean;
  hasRules: boolean;
  existingCampaignTitles?: string[];
  onDirtyChange?: (isDirty: boolean) => void; // <--- ADD THIS
  shopify: {
    toast: {
      show: (message: string, options?: { isError?: boolean }) => void;
    };
  };
}

export function ScheduledHistoryModal({
  open,
  onClose,
  currencyCode,
  shop,
  host,
  previews,
  filteredPreviews,
  selectedItems,
  collectionId,
  hasActivePlan,
  hasRules,
  existingCampaignTitles = [],
  onDirtyChange,
  shopify,
}: ScheduledHistoryModalProps) {
  const scheduleDefaultedScopeRef = useRef(false);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [overlapWarningOpen, setOverlapWarningOpen] = useState(false);
  const overlapWarningBypassRef = useRef(false);
  const [overlapDetailTab, setOverlapDetailTab] = useState<"variants" | "windows">("windows");
  const [conflictExplorerOpen, setConflictExplorerOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const [selectedTab, setSelectedTab] = useState<"create" | "history">("create");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("one-time");
  const [scheduleApplyMode, setScheduleApplyMode] = useState<ScheduleScope>("none");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [windowEndTime, setWindowEndTime] = useState("");
  const [scheduleApplyModeError, setScheduleApplyModeError] = useState<string | undefined>();
  const [scheduleTitleError, setScheduleTitleError] = useState<string | undefined>();
  const [scheduleTimeError, setScheduleTimeError] = useState<string | undefined>();
  const [windowEndTimeError, setWindowEndTimeError] = useState<string | undefined>();
  const [scheduleConfirmOpen, setScheduleConfirmOpen] = useState(false);

  // Unsaved-change guard for the Create Schedule form.
  // `discardOpen` shows the DiscardChangesModal; `pendingActionRef` holds the close or
  // tab-switch the user attempted while the create form had unsaved edits, replayed on
  // confirm. Dirty is derived ONLY from the create-form inputs (title / start / window
  // end) against their empty-on-open baseline — never from loading, polling, history
  // refresh, or the read-only Schedule History tab.
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const isCreateFormDirty = useMemo(() => {
    // Only the Create Schedule tab holds editable values; guard it only when visible.
    if (selectedTab !== "create") return false;
    return (
      scheduleTitle.trim() !== "" ||
      scheduleTime.trim() !== "" ||
      windowEndTime.trim() !== ""
    );
  }, [selectedTab, scheduleTitle, scheduleTime, windowEndTime]);

  const runOrConfirm = useCallback(
    (action: () => void) => {
      if (isCreateFormDirty) {
        pendingActionRef.current = action;
        setDiscardOpen(true);
      } else {
        action();
      }
    },
    [isCreateFormDirty],
  );

  // Billing block modal state
  const [billingBlockModalOpen, setBillingBlockModalOpen] = useState(false);
  const [billingBlockModalCode, setBillingBlockModalCode] = useState<BillingBlockModalCode | null>(null);

  const [historyFilter, setHistoryFilter] = useState<
    "all" | "upcoming" | "active" | "completed" | "restored" | "failed" | "overdue"
  >("all");
  const [historyPageSize, setHistoryPageSize] = useState(15);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedJobPageSize, setSelectedJobPageSize] = useState(15);
  const [selectedJobPage, setSelectedJobPage] = useState(1);
  const appFetch = useAppFetch();

  const loadScheduleHistory = useCallback(
    async (mountedCheck?: () => boolean) => {
      try {
        const data = await appFetch("/api/schedule-history");
        if (mountedCheck && !mountedCheck()) return;
        setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      } catch (err) {
        console.error("Failed to load schedule history", err);
      } finally {
        if (!mountedCheck || mountedCheck()) {
          setLoading(false);
        }
      }
    },
    [appFetch]
  );

  useLayoutEffect(() => {
    if (open) {
      setLoading(true);
    }
  }, [open]);

  useEffect(() => {
    if (open && !scheduleDefaultedScopeRef.current) {
      scheduleDefaultedScopeRef.current = true;
      setScheduleApplyMode(selectedItems.size > 0 ? "selected" : "none");
    }
    if (!open) {
      scheduleDefaultedScopeRef.current = false;
      setJobs([]);
      setLoading(false);
      setIsScheduling(false);
      setOverlapWarningOpen(false);
      overlapWarningBypassRef.current = false;
      setOverlapDetailTab("windows");
      setConflictExplorerOpen(false);
      setScheduleConfirmOpen(false);
      setSelectedJob(null);
      setSelectedTab("create");
      setScheduleMode("one-time");
      setScheduleApplyMode("none");
      setScheduleTitle("");
      setScheduleTime("");
      setWindowEndTime("");
      setScheduleApplyModeError(undefined);
      setScheduleTitleError(undefined);
      setScheduleTimeError(undefined);
      setWindowEndTimeError(undefined);
      setHistoryFilter("all");
      setHistoryPage(1);
      setSelectedJobPageSize(15);
      setSelectedJobPage(1);
      setDiscardOpen(false);
      pendingActionRef.current = null;
      return;
    }

    let mounted = true;
    void loadScheduleHistory(() => mounted);

    return () => {
      mounted = false;
    };
  }, [open, loadScheduleHistory]);

  const scheduleCenterData = useMemo(() => {
    const nowMs = Date.now();
    const queueStatuses = new Set(["pending", "processing", "restoring"]);
    const activeWindowStatuses = new Set(["active-window"]);

    const parsedJobs = jobs
      .map((job) => {
        const runAtDate = new Date(job.runAt);
        const windowEndDate = job.windowEndAt ? new Date(job.windowEndAt) : null;
        return {
          ...job,
          isTimeWindow: job.mode === "time-window",
          runAtDate,
          runAtMs: runAtDate.getTime(),
          windowEndDate,
          windowEndMs: windowEndDate ? windowEndDate.getTime() : null,
          normalizedStatus: job.status.toLowerCase(),
        };
      })
      .filter((job) => !Number.isNaN(job.runAtMs));

    const upcoming = parsedJobs
      .filter(
        (job) =>
          queueStatuses.has(job.normalizedStatus) ||
          activeWindowStatuses.has(job.normalizedStatus) ||
          job.runAtMs >= nowMs
      )
      .sort((a, b) => a.runAtMs - b.runAtMs);

    const history = parsedJobs
      .filter((job) => !upcoming.some((upcomingJob) => upcomingJob.id === job.id))
      .sort((a, b) => b.runAtMs - a.runAtMs);

    const nextRun = upcoming[0] ?? null;
    const overdueCount = upcoming.filter(
      (job) => queueStatuses.has(job.normalizedStatus) && job.runAtMs < nowMs
    ).length;
    const upcomingProductCount = upcoming.reduce(
      (total, job) => total + (Number.isFinite(job.productCount) ? job.productCount : 0),
      0
    );

    return {
      upcoming,
      history,
      nextRun,
      overdueCount,
      upcomingProductCount,
      nowMs,
      queueStatuses,
      activeWindowStatuses,
    };
  }, [jobs]);

  const scopedItemsForSchedule = useMemo(() => {
    if (scheduleApplyMode === "none") {
      return [];
    }
    if (scheduleApplyMode === "selected") {
      return previews.filter((item) => selectedItems.has(String(item.variantId)));
    }
    if (scheduleApplyMode === "filtered") {
      return filteredPreviews;
    }
    return previews;
  }, [scheduleApplyMode, previews, selectedItems, filteredPreviews]);

  const selectedScopeCount = useMemo(() => {
    if (selectedItems.size === 0) return 0;
    return previews.filter((item) => selectedItems.has(String(item.variantId))).length;
  }, [previews, selectedItems]);

  const scheduleScopeLabel = useMemo(() => {
    if (scheduleApplyMode === "selected") return "Selected Products";
    if (scheduleApplyMode === "all") return "All Products";
    if (scheduleApplyMode === "filtered") return "Filtered Products";
    return "Select Scope";
  }, [scheduleApplyMode]);

  const scheduleScopeWarning = useMemo(() => {
    if (scheduleApplyMode !== "all") return null;
    const total = previews.length;
    if (total > 0) return `⚠ Affects entire catalog (${total} products)`;
    return "⚠ Affects entire catalog";
  }, [previews.length, scheduleApplyMode]);

  const normalizedExistingScheduleTitles = useMemo(() => {
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const set = new Set<string>();
    for (const title of existingCampaignTitles) {
      const normalized = normalize(String(title ?? ""));
      if (normalized) set.add(normalized);
    }
    for (const job of jobs) {
      const normalized = normalize(String(job?.title ?? ""));
      if (normalized) set.add(normalized);
    }
    return set;
  }, [existingCampaignTitles, jobs]);

  const scheduleOperationalSafeguards = useMemo<OperationalSafeguardNotice[]>(() => {
    if (scopedItemsForSchedule.length <= 1) return [];

    const notices: OperationalSafeguardNotice[] = [];
    const totalVisibleProducts = previews.length;
    const scopeCount = scopedItemsForSchedule.length;
    const affectsMostVisible =
      totalVisibleProducts > 0 &&
      scopeCount >= Math.max(25, Math.ceil(totalVisibleProducts * MOST_VISIBLE_SCOPE_RATIO));
    const storefrontWide = totalVisibleProducts > 0 && scopeCount >= Math.ceil(totalVisibleProducts * 0.95);
    let largestMovement = 0;

    for (const item of scopedItemsForSchedule) {
      const oldPrice = Number.parseFloat(item.oldPrice);
      const proposedRaw = item.overriddenPrice !== undefined ? item.overriddenPrice : item.newPrice;
      const proposedPrice = Number(proposedRaw);
      if (!Number.isFinite(oldPrice) || !Number.isFinite(proposedPrice) || oldPrice <= 0) continue;
      const deltaPercent = ((proposedPrice - oldPrice) / oldPrice) * 100;
      largestMovement = Math.max(largestMovement, Math.abs(deltaPercent));
    }

    if (scheduleApplyMode === "all" || scopeCount >= LARGE_SCHEDULE_THRESHOLD) {
      notices.push({
        id: "schedule-large-operation",
        severity: "informational",
        message: "Large pricing operation detected.",
      });
    }

    if (affectsMostVisible) {
      notices.push({
        id: "schedule-most-visible",
        severity: "informational",
        message: "This action affects most visible products.",
      });
    }

    if (largestMovement >= SIGNIFICANT_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "schedule-significant-movement",
        severity: "informational",
        message: "Some products contain significant pricing movement.",
      });
    }

    if (scopeCount >= VERY_LARGE_SCHEDULE_THRESHOLD) {
      notices.push({
        id: "schedule-very-large-operation",
        severity: "warning",
        message: "Extremely large scheduled operation detected.",
      });
    }

    if (storefrontWide && largestMovement >= MAJOR_MOVEMENT_THRESHOLD) {
      notices.push({
        id: "schedule-storefront-major-movement",
        severity: "warning",
        message: "Storefront-wide scheduled run includes major pricing movement.",
      });
    }

    if (scheduleMode === "time-window" && scheduleTime && windowEndTime) {
      const startMs = new Date(scheduleTime).getTime();
      const endMs = new Date(windowEndTime).getTime();
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs) {
        const durationHours = (endMs - startMs) / (1000 * 60 * 60);
        if (durationHours >= 24) {
          notices.push({
            id: "schedule-window-duration",
            severity: "informational",
            message: "This pricing window runs for more than one day before automatic restore.",
          });
        }
        if (storefrontWide && durationHours >= 12) {
          notices.push({
            id: "schedule-storefront-wide-window",
            severity: "warning",
            message: "Most storefront products will stay in this window until automatic restore.",
          });
        }
      }
    }

    return notices;
  }, [previews.length, scheduleApplyMode, scheduleMode, scheduleTime, scopedItemsForSchedule, windowEndTime]);

  const scheduleOverlapContext = useMemo(() => {
    if (!scheduleTime) {
      return {
        overlappingVariantCount: 0,
        overlappingWindowCount: 0,
        overlappingTitles: [] as string[],
        overlappingVariantIds: [] as string[],
        overlappingWindowJobs: [] as string[],
      };
    }

    const candidateStartMs = new Date(scheduleTime).getTime();
    if (Number.isNaN(candidateStartMs)) {
      return {
        overlappingVariantCount: 0,
        overlappingWindowCount: 0,
        overlappingTitles: [] as string[],
        overlappingVariantIds: [] as string[],
        overlappingWindowJobs: [] as string[],
      };
    }

    const rawCandidateEndMs =
      scheduleMode === "time-window" && windowEndTime
        ? new Date(windowEndTime).getTime()
        : candidateStartMs;
    if (Number.isNaN(rawCandidateEndMs)) {
      return {
        overlappingVariantCount: 0,
        overlappingWindowCount: 0,
        overlappingTitles: [] as string[],
        overlappingVariantIds: [] as string[],
        overlappingWindowJobs: [] as string[],
      };
    }

    const normalizeEnd = (startMs: number, endMs: number) => (endMs > startMs ? endMs : startMs + 1);
    const candidateEndMs = normalizeEnd(candidateStartMs, Math.max(candidateStartMs, rawCandidateEndMs));

    const candidateVariantIds = new Set(
      scopedItemsForSchedule
        .map((item) => String(item.variantId))
        .filter((variantId) => variantId.length > 0)
    );

    if (candidateVariantIds.size === 0) {
      return {
        overlappingVariantCount: 0,
        overlappingWindowCount: 0,
        overlappingTitles: [] as string[],
        overlappingVariantIds: [] as string[],
        overlappingWindowJobs: [] as string[],
      };
    }

    const overlappingVariantIds = new Set<string>();
    const overlappingWindowJobs = new Map<string, string>();

    for (const job of scheduleCenterData.upcoming) {
      const existingStart = job.runAtMs;
      const existingEnd = normalizeEnd(existingStart, job.mode === "time-window" && typeof job.windowEndMs === "number"
        ? job.windowEndMs
        : existingStart);

      const overlaps = candidateStartMs < existingEnd && candidateEndMs > existingStart;
      if (!overlaps) continue;

      const jobVariantIds = Array.isArray(job.products)
        ? new Set(
          job.products
            .map((product) => String((product as any)?.variantId ?? ""))
            .filter((variantId) => variantId.length > 0)
        )
        : new Set<string>();
      if (jobVariantIds.size === 0) continue;

      let hasIntersection = false;
      for (const variantId of candidateVariantIds) {
        if (jobVariantIds.has(variantId)) {
          overlappingVariantIds.add(variantId);
          hasIntersection = true;
        }
      }

      if (hasIntersection && job.mode === "time-window") {
        const windowLabel = job.windowEndAt
          ? `${formatDateTime(job.runAt)} → ${formatDateTime(job.windowEndAt)}`
          : `${formatDateTime(job.runAt)}`;
        overlappingWindowJobs.set(job.id, `${job.title || "Scheduled Campaign"} (${windowLabel})`);
      }
    }

    const windowJobs = [...overlappingWindowJobs.values()];
    return {
      overlappingVariantCount: overlappingVariantIds.size,
      overlappingWindowCount: overlappingWindowJobs.size,
      overlappingTitles: windowJobs.slice(0, 3),
      overlappingVariantIds: [...overlappingVariantIds],
      overlappingWindowJobs: windowJobs,
    };
  }, [scheduleMode, scheduleTime, scopedItemsForSchedule, scheduleCenterData.upcoming, windowEndTime]);

  const shouldShowOverlapWarningModal =
    scheduleOverlapContext.overlappingVariantCount > 0 && scheduleOverlapContext.overlappingWindowCount > 0;

  const candidateConflictExplorerTitle = useMemo(() => {
    const trimmed = scheduleTitle.trim();
    return trimmed.length > 0 ? trimmed : "Scheduled Campaign";
  }, [scheduleTitle]);

  const conflictExplorerConflicts = useMemo(() => {
    if (!scheduleTime) return [];
    const start = new Date(scheduleTime);
    if (Number.isNaN(start.getTime())) return [];
    const end = scheduleMode === "time-window" ? new Date(windowEndTime) : null;
    const endAt = scheduleMode === "time-window" && end && !Number.isNaN(end.getTime()) ? end.toISOString() : null;

    return computeConflictsForCandidateSchedule({
      title: candidateConflictExplorerTitle,
      status: "pending",
      mode: scheduleMode,
      runAt: start.toISOString(),
      windowEndAt: endAt,
      products: scopedItemsForSchedule.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
      })),
    }, scheduleCenterData.upcoming as any);
  }, [candidateConflictExplorerTitle, scheduleCenterData.upcoming, scheduleMode, scheduleTime, scopedItemsForSchedule, windowEndTime]);

  const conflictExplorerLabelMaps = useMemo(() => {
    const productLabelById = new Map<string, string>();
    const variantLabelById = new Map<string, string>();

    const add = (item: { productId?: string | null; variantId?: string | null; title?: string | null; variantTitle?: string | null }) => {
      const productId = String(item.productId ?? "").trim();
      const variantId = String(item.variantId ?? "").trim();
      const productTitle = String(item.title ?? "").trim();
      const variantTitle = normalizeMeaningfulVariantTitle(item.variantTitle ?? null, productTitle);

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
    };

    for (const item of scopedItemsForSchedule) {
      add(item as any);
    }

    for (const job of scheduleCenterData.upcoming) {
      const products = Array.isArray((job as any)?.products) ? ((job as any).products as any[]) : [];
      for (const product of products) {
        add(product);
      }
    }

    return { productLabelById, variantLabelById };
  }, [scheduleCenterData.upcoming, scopedItemsForSchedule]);

  const overlapWarningSecondaryActions = useMemo(() => {
    const actions = [
      {
        content: "Review selection",
        onAction: () => {
          setOverlapWarningOpen(false);
          setOverlapDetailTab("windows");
        },
      },
      {
        content: "Cancel",
        onAction: () => {
          setOverlapWarningOpen(false);
          setOverlapDetailTab("windows");
        },
      },
    ];

    if (conflictExplorerConflicts.length > 0) {
      actions.unshift({
        content: "View conflict details",
        onAction: () => {
          setOverlapWarningOpen(false);
          setOverlapDetailTab("windows");
          setConflictExplorerOpen(true);
        },
      });
    }

    return actions;
  }, [conflictExplorerConflicts.length]);

  const overlapVariantItems = useMemo(() => {
    if (scheduleOverlapContext.overlappingVariantIds.length === 0) return [];
    const set = new Set(scheduleOverlapContext.overlappingVariantIds);
    return scopedItemsForSchedule.filter((item) => set.has(String(item.variantId)));
  }, [scheduleOverlapContext.overlappingVariantIds, scopedItemsForSchedule]);

  const overlapProductLabels = useMemo(() => {
    const set = new Set<string>();
    for (const item of overlapVariantItems) {
      const title = String(item.title ?? "").trim();
      if (title) set.add(title);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [overlapVariantItems]);

  const overlapVariantLabels = useMemo(() => {
    return overlapVariantItems
      .map((item) => {
        const subtitle = buildVariantSubtitle({
          productTitle: item.title ?? null,
          variantTitle: item.variantTitle ?? null,
          sku: item.sku ?? null,
        });
        const productTitle = String(item.title ?? "").trim();
        if (!productTitle) return "";
        return subtitle ? `${productTitle} / ${subtitle}` : productTitle;
      })
      .filter((label) => label.length > 0);
  }, [overlapVariantItems]);

  const safeguardWarningCount = useMemo(
    () => scheduleOperationalSafeguards.filter((notice) => notice.severity === "warning").length,
    [scheduleOperationalSafeguards]
  );
  const safeguardInfoCount = useMemo(
    () =>
      scheduleOperationalSafeguards.filter((notice) => notice.severity === "informational").length,
    [scheduleOperationalSafeguards]
  );

  const historyRows = useMemo(() => {
    return jobs
      .map((job) => {
        const runAtDate = new Date(job.runAt);
        const runAtMs = runAtDate.getTime();
        const windowEndMs = job.windowEndAt ? new Date(job.windowEndAt).getTime() : null;
        const normalizedStatus = job.status.toLowerCase();
        const isQueueStatus = scheduleCenterData.queueStatuses.has(normalizedStatus);
        const isActiveWindow = scheduleCenterData.activeWindowStatuses.has(normalizedStatus);
        const isOverdue = isQueueStatus && runAtMs < scheduleCenterData.nowMs;
        const isUpcoming = isQueueStatus || isActiveWindow || runAtMs >= scheduleCenterData.nowMs;
        const isFailed = normalizedStatus === "failed" || normalizedStatus === "error";
        const isAutoRestored = normalizedStatus === "auto-restored";
        const isCompleted =
          normalizedStatus === "done" ||
          normalizedStatus === "completed" ||
          normalizedStatus === "success" ||
          isAutoRestored;
        return {
          ...job,
          runAtMs,
          windowEndMs,
          normalizedStatus,
          isActiveWindow,
          isOverdue,
          isUpcoming,
          isFailed,
          isAutoRestored,
          isCompleted,
        };
      })
      .filter((job) => !Number.isNaN(job.runAtMs));
  }, [jobs, scheduleCenterData.activeWindowStatuses, scheduleCenterData.nowMs, scheduleCenterData.queueStatuses]);

  const filteredHistoryRows = useMemo(() => {
    const sortedRows = [...historyRows].sort((a, b) => b.runAtMs - a.runAtMs);
    if (historyFilter === "all") return sortedRows;
    if (historyFilter === "upcoming") return sortedRows.filter((job) => job.isUpcoming);
    if (historyFilter === "active") return sortedRows.filter((job) => job.isActiveWindow);
    if (historyFilter === "overdue") return sortedRows.filter((job) => job.isOverdue);
    if (historyFilter === "failed") return sortedRows.filter((job) => job.isFailed);
    if (historyFilter === "restored") return sortedRows.filter((job) => job.isAutoRestored);
    if (historyFilter === "completed") {
      return sortedRows.filter((job) => job.isCompleted || (!job.isUpcoming && !job.isFailed));
    }
    return sortedRows;
  }, [historyRows, historyFilter]);

  const totalHistoryPages = Math.max(1, Math.ceil(filteredHistoryRows.length / historyPageSize));
  const paginatedHistoryRows = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return filteredHistoryRows.slice(start, start + historyPageSize);
  }, [filteredHistoryRows, historyPage, historyPageSize]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyFilter, historyPageSize]);

  useEffect(() => {
    if (historyPage > totalHistoryPages) {
      setHistoryPage(totalHistoryPages);
    }
  }, [historyPage, totalHistoryPages]);

  const selectedJobProducts = selectedJob?.products ?? [];
  const selectedJobCounts = useMemo(
    () => computeProductVariantCounts(selectedJobProducts),
    [selectedJobProducts]
  );
  const selectedJobTotalPages = Math.max(1, Math.ceil(selectedJobProducts.length / selectedJobPageSize));
  const selectedJobPaginatedProducts = useMemo(() => {
    const start = (selectedJobPage - 1) * selectedJobPageSize;
    return selectedJobProducts.slice(start, start + selectedJobPageSize);
  }, [selectedJobPage, selectedJobPageSize, selectedJobProducts]);

  useEffect(() => {
    setSelectedJobPage(1);
  }, [selectedJob, selectedJobPageSize]);

  useEffect(() => {
    if (selectedJobPage > selectedJobTotalPages) {
      setSelectedJobPage(selectedJobTotalPages);
    }
  }, [selectedJobPage, selectedJobTotalPages]);

  // Sync dirty status with Dashboard navigation guard
  useEffect(() => {
    onDirtyChange?.(open && isCreateFormDirty);
  }, [open, isCreateFormDirty, onDirtyChange]);

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "pending":
        return <Badge tone="warning">Pending</Badge>;
      case "processing":
        return <Badge tone="info">Processing</Badge>;
      case "missed-during-uninstall":
        return <Badge tone="attention">Missed During Uninstall</Badge>;
      case "active-window":
        return <Badge tone="attention">Active Window</Badge>;
      case "restoring":
        return <Badge tone="info">Restoring</Badge>;
      case "auto-restored":
        return <Badge tone="success">Auto Restored</Badge>;
      case "restore-failed":
        return <Badge tone="critical">Restore Failed</Badge>;
      case "done":
      case "success":
      case "completed":
        return <Badge tone="success">Completed</Badge>;
      case "failed":
      case "error":
        return <Badge tone="critical">Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const historyFilterOptions = [
    { label: `${SELECT_OPTION_PREFIX}All`, value: "all" },
    { label: `${SELECT_OPTION_PREFIX}Upcoming`, value: "upcoming" },
    { label: `${SELECT_OPTION_PREFIX}Active windows`, value: "active" },
    { label: `${SELECT_OPTION_PREFIX}Completed`, value: "completed" },
    { label: `${SELECT_OPTION_PREFIX}Auto restored`, value: "restored" },
    { label: `${SELECT_OPTION_PREFIX}Failed`, value: "failed" },
    { label: `${SELECT_OPTION_PREFIX}Overdue`, value: "overdue" },
  ];

  function formatDateTime(dateString: string) {
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return "Invalid date";
    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatRelativeTime(dateString: string) {
    const nowMs = Date.now();
    const targetMs = new Date(dateString).getTime();
    if (Number.isNaN(targetMs)) return "Unknown timing";

    const deltaMs = targetMs - nowMs;
    const absMinutes = Math.round(Math.abs(deltaMs) / (1000 * 60));

    if (absMinutes < 1) return "Now";
    if (absMinutes < 60) return deltaMs >= 0 ? `In ${absMinutes} min` : `${absMinutes} min ago`;

    const absHours = Math.round(absMinutes / 60);
    if (absHours < 24) return deltaMs >= 0 ? `In ${absHours} hr` : `${absHours} hr ago`;

    const absDays = Math.round(absHours / 24);
    return deltaMs >= 0
      ? `In ${absDays} day${absDays > 1 ? "s" : ""}`
      : `${absDays} day${absDays > 1 ? "s" : ""} ago`;
  }

  const formatScheduleWindow = (job: ScheduledJob) => {
    if (job.mode !== "time-window" || !job.windowEndAt) {
      return formatDateTime(job.runAt);
    }

    return `${formatDateTime(job.runAt)} to ${formatDateTime(job.windowEndAt)}`;
  };

  const formatScheduleTiming = (job: ScheduledJob & { normalizedStatus?: string }) => {
    if (job.mode === "time-window") {
      if (job.normalizedStatus === "active-window" && job.windowEndAt) {
        return `Restores ${formatRelativeTime(job.windowEndAt)}`;
      }
      if (job.normalizedStatus === "auto-restored") {
        return "Window completed";
      }
      return `Publishes ${formatRelativeTime(job.runAt)}`;
    }

    return formatRelativeTime(job.runAt);
  };

  const formatWindowDuration = () => {
    if (scheduleMode !== "time-window" || !scheduleTime || !windowEndTime) return null;
    const startMs = new Date(scheduleTime).getTime();
    const endMs = new Date(windowEndTime).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;

    const totalMinutes = Math.round((endMs - startMs) / (1000 * 60));
    if (totalMinutes < 60) return `${totalMinutes} min`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 24) return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;

    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0
      ? `${days} day${days === 1 ? "" : "s"} ${remainingHours} hr`
      : `${days} day${days === 1 ? "" : "s"}`;
  };

  const preflightSchedule = () => {
    if (scheduleApplyMode === "none") {
      setScheduleApplyModeError("Select a pricing scope before scheduling.");
      return;
    }

    if (scheduleApplyMode === "selected" && selectedScopeCount === 0) {
      setScheduleApplyModeError("Select products on the dashboard, or choose All Products.");
      return;
    }

    setScheduleApplyModeError(undefined);

    const normalizedTitle = scheduleTitle.trim();
    if (!normalizedTitle) {
      setScheduleTitleError("Campaign title is required for scheduled pricing.");
      return;
    }

    const normalizedKey = normalizedTitle.replace(/\s+/g, " ").toLowerCase();
    if (normalizedExistingScheduleTitles.has(normalizedKey)) {
      setScheduleTitleError("A campaign with this title already exists. Choose a unique title.");
      return;
    }

    setScheduleTitleError(undefined);

    if (!scheduleTime) {
      setScheduleTimeError(
        scheduleMode === "time-window"
          ? "Choose when pricing should publish."
          : "Choose when this schedule should run."
      );
      return;
    }

    const scheduleStartMs = new Date(scheduleTime).getTime();
    if (Number.isNaN(scheduleStartMs)) {
      setScheduleTimeError("Choose a valid publish time.");
      return;
    }
    if (scheduleStartMs <= Date.now()) {
      setScheduleTimeError("Choose a future start time before scheduling.");
      return;
    }

    setScheduleTimeError(undefined);

    if (scheduleMode === "time-window") {
      if (!windowEndTime) {
        setWindowEndTimeError("Choose when original pricing should restore.");
        return;
      }
      const scheduleEndMs = new Date(windowEndTime).getTime();
      if (Number.isNaN(scheduleEndMs)) {
        setWindowEndTimeError("Choose a valid restore time.");
        return;
      }
      if (scheduleEndMs === scheduleStartMs) {
        setWindowEndTimeError("Start and end times need to be different.");
        return;
      }
      if (scheduleEndMs <= scheduleStartMs) {
        setWindowEndTimeError("Window end must be after the start time.");
        return;
      }
      setWindowEndTimeError(undefined);
    }

    if (shouldShowOverlapWarningModal) {
      setOverlapDetailTab("windows");
      setOverlapWarningOpen(true);
      return;
    }

    setScheduleConfirmOpen(true);
  };

  const submitSchedule = async () => {
    const normalizedTitle = scheduleTitle.trim();
    if (!normalizedTitle) {
      setScheduleTitleError("Campaign title is required for scheduled pricing.");
      return;
    }

    const normalizedKey = normalizedTitle.replace(/\s+/g, " ").toLowerCase();
    if (normalizedExistingScheduleTitles.has(normalizedKey)) {
      setScheduleTitleError("A campaign with this title already exists. Choose a unique title.");
      return;
    }

    setScheduleTitleError(undefined);

    if (!scheduleTime) {
      setScheduleTimeError(
        scheduleMode === "time-window"
          ? "Choose when pricing should publish."
          : "Choose when this schedule should run."
      );
      return;
    }
    const scheduleStartMs = new Date(scheduleTime).getTime();
    if (Number.isNaN(scheduleStartMs)) {
      setScheduleTimeError("Choose a valid publish time.");
      return;
    }
    if (scheduleStartMs <= Date.now()) {
      setScheduleTimeError("Choose a future start time before scheduling.");
      return;
    }
    setScheduleTimeError(undefined);

    if (scheduleMode === "time-window") {
      if (!windowEndTime) {
        setWindowEndTimeError("Choose when original pricing should restore.");
        return;
      }
      const scheduleEndMs = new Date(windowEndTime).getTime();
      if (Number.isNaN(scheduleEndMs)) {
        setWindowEndTimeError("Choose a valid restore time.");
        return;
      }
      if (scheduleEndMs === scheduleStartMs) {
        setWindowEndTimeError("Start and end times need to be different.");
        return;
      }
      if (scheduleEndMs <= scheduleStartMs) {
        setWindowEndTimeError("Window end must be after the start time.");
        return;
      }
      setWindowEndTimeError(undefined);
    }

    if (overlapWarningBypassRef.current) {
      overlapWarningBypassRef.current = false;
    } else if (shouldShowOverlapWarningModal) {
      setOverlapDetailTab("windows");
      setOverlapWarningOpen(true);
      return;
    }

    if (!hasRules) {
      shopify.toast.show(t("toast.scheduleConfigureRules"), {
        isError: true,
      });
      return;
    }

    if (!hasActivePlan) {
      shopify.toast.show(t("toast.scheduleActivatePlan"), {
        isError: true,
      });
      return;
    }

    if (scopedItemsForSchedule.length === 0) {
      shopify.toast.show(t("toast.scheduleNoProductsForScope"), {
        isError: true,
      });
      return;
    }

    const products = scopedItemsForSchedule.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      title: item.title,
      variantTitle: item.variantTitle,
      sku: item.sku ?? null,
      image: item.image ?? null,
      oldPrice: item.oldPrice,
      newPrice: item.overriddenPrice !== undefined ? item.overriddenPrice : item.newPrice,
      originalBasePrice: item.originalBasePrice,
      compareAtPrice: item.compareAtPrice ?? null,
      storefrontVariantPrice: item.storefrontVariantPrice ?? item.oldPrice,
      originalVariantPrice: item.originalVariantPrice ?? item.originalBasePrice,
      scheduledPrice: item.overriddenPrice !== undefined ? item.overriddenPrice : item.newPrice,
      isManual: item.overriddenPrice !== undefined,
    }));

    setIsScheduling(true);
    try {
      const response = await fetch("/api/schedule-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: normalizedTitle,
          runAt: new Date(scheduleTime).toISOString(),
          mode: scheduleMode,
          ...(scheduleMode === "time-window"
            ? { windowEndAt: new Date(windowEndTime).toISOString() }
            : {}),
          products,
          applyMode: scheduleApplyMode,
          collectionId,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "BILLING_INACTIVE" || result.code === "BILLING_UNKNOWN") {
          setBillingBlockModalCode(result.code);
          setBillingBlockModalOpen(true);
        } else {
          shopify.toast.show(result.error || t("toast.schedulingFailed"), { isError: true });
        }
        return;
      }

      const count = result.stagedCount || scopedItemsForSchedule.length;
      shopify.toast.show(
        scheduleMode === "time-window"
          ? `${count} prices scheduled with automatic restore`
          : `${count} prices staged and scheduled successfully`
      );
      setScheduleTime("");
      setWindowEndTime("");
      setScheduleTitle("");
      setSelectedTab("history");
      setLoading(true);
      await loadScheduleHistory();
    } catch {
      shopify.toast.show(t("toast.schedulingFailed"), { isError: true });
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          runOrConfirm(() => {
            setSelectedJob(null);
            setOverlapWarningOpen(false);
            overlapWarningBypassRef.current = false;
            setOverlapDetailTab("windows");
            onClose();
          });
        }}
        title="Schedule Center"
        size="large"
      >
        <Modal.Section>
          <div
            style={{
              minHeight: "min(560px, 72vh)",
              height: "72vh",
              maxHeight: "72vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ flex: "0 0 auto" }}>
              <BlockStack gap="300">
                <Text variant="bodySm" as="p" tone="subdued">
                  Immediate operations run directly from the dashboard. Use Schedule Center for future
                  pricing operations.
                </Text>

                <Box
                  background="bg-surface-secondary"
                  padding="100"
                  borderRadius="200"
                  borderColor="border"
                  borderWidth="025"
                >
                  <InlineStack gap="100" wrap={false}>
                    <Button
                      size="slim"
                      fullWidth
                      pressed={selectedTab === "create"}
                      variant={selectedTab === "create" ? "primary" : "tertiary"}
                      onClick={() => runOrConfirm(() => setSelectedTab("create"))}
                    >
                      Create Schedule
                    </Button>
                    <Button
                      size="slim"
                      fullWidth
                      pressed={selectedTab === "history"}
                      variant={selectedTab === "history" ? "primary" : "tertiary"}
                      onClick={() => runOrConfirm(() => setSelectedTab("history"))}
                    >
                      Schedule History
                    </Button>
                  </InlineStack>
                </Box>
              </BlockStack>
            </div>

            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflowY: "auto",
                paddingRight: 4,
                paddingTop: 12,
              }}
            >
              {selectedTab === "create" ? (
                <div>
                    <BlockStack gap="400">
                      <BlockStack gap="150">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Set timing, scope, and campaign naming for future pricing operations.
                        </Text>
                        <InlineStack gap="200" wrap>
                          <Badge tone="info">{`Upcoming runs: ${scheduleCenterData.upcoming.length}`}</Badge>
                          <Badge tone="attention">{`Upcoming products: ${scheduleCenterData.upcomingProductCount}`}</Badge>
                          <Badge tone="success">
                            {scheduleCenterData.nextRun
                              ? `Next run: ${formatDateTime(scheduleCenterData.nextRun.runAt)}`
                              : "Next run: Not scheduled"}
                          </Badge>
                        </InlineStack>
                      </BlockStack>

                      <Box
                        padding="300"
                        background="bg-surface-secondary"
                        borderRadius="200"
                        borderColor="border"
                        borderWidth="025"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center" wrap>
                            <Text as="p" variant="bodySm" fontWeight="medium">
                              Scheduling mode
                            </Text>
                            <Badge tone={scheduleMode === "time-window" ? "attention" : "success"}>
                              {scheduleMode === "time-window" ? "Time Window" : "One-time Publish"}
                            </Badge>
                          </InlineStack>

                          <BlockStack gap="300">
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                              <Select
                                label="Schedule type"
                                options={[
                                  { label: `${SELECT_OPTION_PREFIX}One-time Publish`, value: "one-time" },
                                  { label: `${SELECT_OPTION_PREFIX}Time Window`, value: "time-window" },
                                ]}
                                value={scheduleMode}
                                onChange={(value) => {
                                  setScheduleMode(value as ScheduleMode);
                                  setScheduleTimeError(undefined);
                                  setWindowEndTimeError(undefined);
                                }}
                                disabled={isScheduling}
                              />

                              <div>
                                <Select
                                  label="Pricing scope"
                                  options={[
                                    { label: `${SELECT_OPTION_PREFIX}Select scope`, value: "none" },
                                    { label: `${SELECT_OPTION_PREFIX}Selected products (${selectedScopeCount})`, value: "selected" },
                                    { label: `${SELECT_OPTION_PREFIX}All products (${previews.length})`, value: "all" },
                                  ]}
                                  value={scheduleApplyMode}
                                  onChange={(value) => {
                                    setScheduleApplyMode(value as ScheduleScope);
                                    setScheduleApplyModeError(undefined);
                                  }}
                                  error={scheduleApplyModeError}
                                  disabled={isScheduling}
                                />
                                {scheduleApplyMode === "none" ? (
                                  <Box paddingBlockStart="100">
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      Select a scope to enable scheduling.
                                    </Text>
                                  </Box>
                                ) : scheduleApplyMode === "selected" && selectedScopeCount === 0 ? (
                                  <Box paddingBlockStart="100">
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      No products selected.
                                    </Text>
                                  </Box>
                                ) : null}
                                {scheduleScopeWarning ? (
                                  <Box paddingBlockStart="100">
                                    <Text as="p" variant="bodySm" tone="critical">
                                      {scheduleScopeWarning}
                                    </Text>
                                  </Box>
                                ) : null}
                              </div>
                            </div>

                            <TextField
                              label="Campaign title"
                              value={scheduleTitle}
                              onChange={(value) => {
                                setScheduleTitle(value);
                                if (scheduleTitleError && value.trim()) {
                                  setScheduleTitleError(undefined);
                                }
                              }}
                              autoComplete="off"
                              placeholder="e.g., Weekend Flash Schedule"
                              error={scheduleTitleError}
                              disabled={isScheduling}
                            />

                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: scheduleMode === "time-window" ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)",
                                gap: 16,
                              }}
                            >
                              <TextField
                                label={scheduleMode === "time-window" ? "Window Start" : "Publish at"}
                                type="datetime-local"
                                value={scheduleTime}
                                onChange={(value) => {
                                  setScheduleTime(value);
                                  if (scheduleTimeError && value) {
                                    setScheduleTimeError(undefined);
                                  }
                                }}
                                autoComplete="off"
                                error={scheduleTimeError}
                                disabled={isScheduling}
                              />
                              {scheduleMode === "time-window" && (
                                <TextField
                                  label="Window End"
                                  type="datetime-local"
                                  value={windowEndTime}
                                  onChange={(value) => {
                                    setWindowEndTime(value);
                                    if (windowEndTimeError && value) {
                                      setWindowEndTimeError(undefined);
                                    }
                                  }}
                                  autoComplete="off"
                                  error={windowEndTimeError}
                                  disabled={isScheduling}
                                />
                              )}
                            </div>
                          </BlockStack>
                        </BlockStack>
                      </Box>

                      {scheduleOperationalSafeguards.length > 0 && (
                        <Box
                          padding="300"
                          background="bg-surface-secondary"
                          borderRadius="200"
                          borderColor="border"
                          borderWidth="025"
                        >
                          <BlockStack gap="200">
                            <InlineStack gap="200" align="space-between" blockAlign="center" wrap>
                              <Text as="p" variant="bodySm" fontWeight="medium">
                                Operational safeguards
                              </Text>
                              <InlineStack gap="100" wrap>
                                <Badge tone="warning">
                                  {`${safeguardWarningCount} Warning${
                                    safeguardWarningCount === 1 ? "" : "s"
                                  }`}
                                </Badge>
                                <Badge tone="info">{`${safeguardInfoCount} Info`}</Badge>
                              </InlineStack>
                            </InlineStack>
                            <BlockStack gap="150">
                              {scheduleOperationalSafeguards.map((notice) => (
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

                    </BlockStack>
                </div>
              ) : (
                <div>
                  <BlockStack gap="300">
                    <InlineStack gap="200" wrap align="space-between" blockAlign="end">
                      <div style={{ minWidth: 220 }}>
                        <Select
                          label="History filter"
                          options={historyFilterOptions}
                          value={historyFilter}
                          onChange={(value) =>
                            setHistoryFilter(
                              value as "all" | "upcoming" | "active" | "completed" | "restored" | "failed" | "overdue"
                            )
                          }
                          disabled={loading}
                        />
                      </div>
                      <div style={{ minWidth: 140 }}>
                        <Select
                          label="Rows per page"
                          options={OPERATIONAL_PAGE_SIZE_OPTIONS.map((size) => ({
                            label: `${SELECT_OPTION_PREFIX}${size}`,
                            value: String(size),
                          }))}
                          value={String(historyPageSize)}
                          onChange={(value) => setHistoryPageSize(Number(value))}
                          disabled={loading}
                        />
                      </div>
                    </InlineStack>

                    {loading ? (
                      <Box paddingBlockStart="600" paddingBlockEnd="600">
                        <InlineStack align="center" blockAlign="center">
                          <Spinner size="small" accessibilityLabel="Loading schedule history" />
                        </InlineStack>
                      </Box>
                    ) : filteredHistoryRows.length === 0 ? (
                      <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="medium">
                            No schedule records for this filter
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Try a different filter, or create a new scheduled pricing run.
                          </Text>
                        </BlockStack>
                      </Box>
                    ) : (
                      <BlockStack gap="300">
                        {scheduleCenterData.overdueCount > 0 && (
                          <Box padding="300" background="bg-surface-warning" borderRadius="200">
                            <Text as="p" variant="bodySm">
                              {`${scheduleCenterData.overdueCount} scheduled run${
                                scheduleCenterData.overdueCount > 1 ? "s are" : " is"
                              } queued past the target time.`}
                            </Text>
                          </Box>
                        )}

                        <div>
                          <DataTable
                            columnContentTypes={["text", "text", "text", "text", "text"]}
                            headings={["Campaign", "Schedule", "Timing", "Products", "Status"]}
                            rows={paginatedHistoryRows.map((job) => [
                              <BlockStack key={`${job.id}-title`} gap="100">
                                <Text as="span" variant="bodySm">
                                  {job.title}
                                </Text>
                                {job.mode === "time-window" && (
                                  <Badge tone="attention">Time Window</Badge>
                                )}
                              </BlockStack>,
                              formatScheduleWindow(job),
                              formatScheduleTiming(job),
                              <Button
                                key={`${job.id}-history-products`}
                                variant="plain"
                                onClick={() => setSelectedJob(job)}
                              >
                                {`${job.productCount} Products`}
                              </Button>,
                              getStatusBadge(job.status),
                            ])}
                          />
                        </div>

                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`Showing ${
                              paginatedHistoryRows.length === 0
                                ? 0
                                : (historyPage - 1) * historyPageSize + 1
                            }-${
                              (historyPage - 1) * historyPageSize + paginatedHistoryRows.length
                            } of ${filteredHistoryRows.length}`}
                          </Text>
                          <Pagination
                            hasPrevious={historyPage > 1}
                            onPrevious={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                            hasNext={historyPage < totalHistoryPages}
                            onNext={() =>
                              setHistoryPage((prev) => Math.min(totalHistoryPages, prev + 1))
                            }
                            label={`Page ${historyPage} of ${totalHistoryPages}`}
                          />
                        </InlineStack>
                      </BlockStack>
                    )}
                  </BlockStack>
                </div>
              )}
            </div>
            {selectedTab === "create" && (
              <div style={{ flex: "0 0 auto" }}>
                <Box
                  background="bg-surface"
                  borderColor="border"
                  borderBlockStartWidth="025"
                  paddingBlockStart="300"
                  paddingBlockEnd="100"
                  paddingInlineEnd="100"
                >
                  <InlineStack align="end" gap="200">
                    <Button
                      onClick={() => runOrConfirm(onClose)}
                      disabled={isScheduling}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      tone="success"
                      onClick={() => {
                        preflightSchedule();
                      }}
                      loading={isScheduling}
                      disabled={
                        isScheduling ||
                        loading ||
                        !hasRules ||
                        !hasActivePlan ||
                        scopedItemsForSchedule.length === 0
                      }
                    >
                      {scheduleMode === "time-window" ? "Schedule Window" : "Schedule Pricing"}
                    </Button>
                  </InlineStack>
                </Box>
              </div>
            )}
          </div>
        </Modal.Section>
      </Modal>

      <Modal
        open={scheduleConfirmOpen}
        onClose={() => setScheduleConfirmOpen(false)}
        title="Confirm Schedule"
        primaryAction={{
          content: "Confirm Schedule",
          onAction: () => {
            setScheduleConfirmOpen(false);
            void submitSchedule();
          },
        }}
        secondaryActions={[
          {
            content: "Back",
            onAction: () => setScheduleConfirmOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <ModalScrollableSection>
            <BlockStack gap="300">
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200">
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Campaign
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="medium">
                        {scheduleTitle.trim() ? scheduleTitle.trim() : "Scheduled Campaign"}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Scope
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="medium">
                        {scheduleScopeLabel}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Products
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="medium">
                        {scopedItemsForSchedule.length}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Publish
                      </Text>
                      <Text as="p" variant="bodySm" fontWeight="medium">
                        {scheduleTime ? formatDateTime(scheduleTime) : "—"}
                      </Text>
                    </BlockStack>
                    {scheduleMode === "time-window" ? (
                      <>
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">
                            Restore
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="medium">
                            {windowEndTime ? formatDateTime(windowEndTime) : "—"}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">
                            Duration
                          </Text>
                          <Text as="p" variant="bodySm" fontWeight="medium">
                            {formatWindowDuration() ?? "—"}
                          </Text>
                        </BlockStack>
                      </>
                    ) : null}
                  </div>

                  {scheduleApplyMode === "all" ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      ⚠ This operation will update pricing across your entire catalog.
                    </Text>
                  ) : null}
                </BlockStack>
              </Box>
            </BlockStack>
          </ModalScrollableSection>
        </Modal.Section>
      </Modal>

      <Modal
        open={overlapWarningOpen}
        onClose={() => {
          setOverlapWarningOpen(false);
          setOverlapDetailTab("windows");
        }}
        title="Scheduling Overlap Detected"
        primaryAction={{
          content: "Continue scheduling",
          onAction: () => {
            overlapWarningBypassRef.current = true;
            setOverlapWarningOpen(false);
            setOverlapDetailTab("windows");
            void submitSchedule();
          },
        }}
        secondaryActions={overlapWarningSecondaryActions}
      >
        <Modal.Section>
          <ModalScrollableSection>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                Some selected products already belong to another scheduled pricing campaign during this time window.
              </Text>
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="150">
                  <Box
                    background="bg-surface"
                    padding="100"
                    borderRadius="200"
                    borderColor="border"
                    borderWidth="025"
                  >
                    <InlineStack gap="100" wrap={false}>
                      <Button
                        size="slim"
                        fullWidth
                        pressed={overlapDetailTab === "windows"}
                        variant={overlapDetailTab === "windows" ? "primary" : "tertiary"}
                        onClick={() => setOverlapDetailTab("windows")}
                      >
                        {`Overlapping windows (${scheduleOverlapContext.overlappingWindowCount})`}
                      </Button>
                      <Button
                        size="slim"
                        fullWidth
                        pressed={overlapDetailTab === "variants"}
                        variant={overlapDetailTab === "variants" ? "primary" : "tertiary"}
                        onClick={() => setOverlapDetailTab("variants")}
                      >
                        {`Overlapping variants (${scheduleOverlapContext.overlappingVariantCount})`}
                      </Button>
                    </InlineStack>
                  </Box>

                  {overlapDetailTab === "variants" && (
                    <Box padding="200" background="bg-surface" borderRadius="200">
                      <BlockStack gap="150">
                        <Text as="p" variant="bodySm" tone="subdued">
                          These selected items overlap with another scheduled window.
                        </Text>
                        <ExpandableList title="Overlapping products" items={overlapProductLabels} collapsedVisibleCount={5} />
                        <ExpandableList title="Overlapping variants" items={overlapVariantLabels} collapsedVisibleCount={5} />
                      </BlockStack>
                    </Box>
                  )}

                  {overlapDetailTab === "windows" && (
                    <Box padding="200" background="bg-surface" borderRadius="200">
                      <BlockStack gap="150">
                        <Text as="p" variant="bodySm" tone="subdued">
                          These scheduled windows overlap your selected time range.
                        </Text>
                        <ExpandableList
                          title="Overlapping windows"
                          items={scheduleOverlapContext.overlappingWindowJobs}
                          collapsedVisibleCount={5}
                        />
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                Continue to schedule anyway, or review your selection and timing to avoid operational overlap.
              </Text>
            </BlockStack>
          </ModalScrollableSection>
        </Modal.Section>
      </Modal>

      <CampaignConflictExplorerModal
        open={conflictExplorerOpen}
        onClose={() => setConflictExplorerOpen(false)}
        primaryTitle={candidateConflictExplorerTitle}
        conflicts={conflictExplorerConflicts}
        productLabelById={conflictExplorerLabelMaps.productLabelById}
        variantLabelById={conflictExplorerLabelMaps.variantLabelById}
      />

      <Modal
        open={!!selectedJob}
        onClose={() => {
          setSelectedJob(null);
          setSelectedJobPageSize(15);
          setSelectedJobPage(1);
        }}
        title={selectedJob?.title || "Scheduled Products"}
        size="large"
      >
        <Modal.Section>
          {selectedJobProducts.length > 0 ? (
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="end">
                <Text as="p" variant="bodySm" tone="subdued">
                  {`Showing ${
                    selectedJobPaginatedProducts.length === 0
                      ? 0
                      : (selectedJobPage - 1) * selectedJobPageSize + 1
                  }-${
                    (selectedJobPage - 1) * selectedJobPageSize + selectedJobPaginatedProducts.length
                  } of ${
                    selectedJobCounts.variantCount !== selectedJobCounts.productCount
                      ? `${selectedJobCounts.productCount} products • ${selectedJobCounts.variantCount} variants`
                      : `${selectedJobCounts.productCount} products`
                  }`}
                </Text>
                <div style={{ minWidth: 140 }}>
                  <Select
                    label="Rows per page"
                    options={OPERATIONAL_PAGE_SIZE_OPTIONS.map((size) => ({
                      label: `${SELECT_OPTION_PREFIX}${size}`,
                      value: String(size),
                    }))}
                    value={String(selectedJobPageSize)}
                    onChange={(value) => setSelectedJobPageSize(Number(value))}
                  />
                </div>
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["Product", "Variant", "Old Price", "Scheduled Price"]}
                rows={selectedJobPaginatedProducts.map((product) => [
                  product.title || "Untitled Product",
                  buildVariantSubtitle({
                    productTitle: product.title ?? null,
                    variantTitle: product.variantTitle ?? null,
                    sku: product.sku ?? null,
                  }) ?? "—",
                  formatMoney(Number(product.oldPrice), currencyCode),
                  formatMoney(Number(product.newPrice), currencyCode),
                ])}
              />
              <InlineStack align="end">
                <Pagination
                  hasPrevious={selectedJobPage > 1}
                  onPrevious={() => setSelectedJobPage((prev) => Math.max(1, prev - 1))}
                  hasNext={selectedJobPage < selectedJobTotalPages}
                  onNext={() => setSelectedJobPage((prev) => Math.min(selectedJobTotalPages, prev + 1))}
                  label={`Page ${selectedJobPage} of ${selectedJobTotalPages}`}
                />
              </InlineStack>
            </BlockStack>
            ) : (
            <Box padding="400">
              <Text as="p" tone="subdued" alignment="center">
                No product details available for this schedule.
              </Text>
            </Box>
          )}
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
        open={discardOpen}
        onDiscard={() => {
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          setDiscardOpen(false);
          if (typeof action === "function") action();
        }}
        onKeepEditing={() => {
          pendingActionRef.current = null;
          setDiscardOpen(false);
        }}
      />
    </>
  );
}
