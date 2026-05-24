import { useState, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
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
import type {
  OperationalSafeguardNotice,
  OperationalSafeguardSeverity,
  PricingPreviewItem,
} from "../types/pricing";

interface ProductSnapshot {
  productId: string;
  variantId: string;
  title: string;
  variantTitle?: string;
  oldPrice: string | number;
  newPrice: string | number;
}

interface ScheduledJob {
  id: string;
  title: string;
  runAt: string;
  mode?: "one-time" | "time-window" | string;
  windowEndAt?: string | null;
  activatedAt?: string | null;
  restoredAt?: string | null;
  status: string;
  productCount: number;
  products: ProductSnapshot[] | null;
}

type ScheduleScope = "all" | "selected" | "filtered";
type ScheduleMode = "one-time" | "time-window";

interface ScheduleConflictNotice {
  id: string;
  severity: OperationalSafeguardSeverity;
  message: string;
}

const CONFLICT_NEARBY_WINDOW_MS = 30 * 60 * 1000;
const LARGE_OVERLAP_COUNT_THRESHOLD = 25;
const LARGE_SCHEDULE_THRESHOLD = 100;
const VERY_LARGE_SCHEDULE_THRESHOLD = 250;
const MOST_VISIBLE_SCOPE_RATIO = 0.8;
const SIGNIFICANT_MOVEMENT_THRESHOLD = 25;
const MAJOR_MOVEMENT_THRESHOLD = 40;
const OPERATIONAL_PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 25];
const SELECT_OPTION_PREFIX = "\u2002";

export interface ScheduledHistoryModalProps {
  open: boolean;
  onClose: () => void;
  currencyCode: string;
  previews: PricingPreviewItem[];
  filteredPreviews: PricingPreviewItem[];
  selectedItems: Set<string>;
  collectionId: string;
  hasActivePlan: boolean;
  hasRules: boolean;
  existingCampaignTitles?: string[];
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
  previews,
  filteredPreviews,
  selectedItems,
  collectionId,
  hasActivePlan,
  hasRules,
  existingCampaignTitles = [],
  shopify,
}: ScheduledHistoryModalProps) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const [selectedTab, setSelectedTab] = useState<"create" | "history">("create");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("one-time");
  const [scheduleApplyMode, setScheduleApplyMode] = useState<ScheduleScope>("all");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [windowEndTime, setWindowEndTime] = useState("");
  const [scheduleTitleError, setScheduleTitleError] = useState<string | undefined>();
  const [scheduleTimeError, setScheduleTimeError] = useState<string | undefined>();
  const [windowEndTimeError, setWindowEndTimeError] = useState<string | undefined>();
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
    if (!open) {
      setJobs([]);
      setLoading(false);
      setIsScheduling(false);
      setSelectedJob(null);
      setSelectedTab("create");
      setScheduleMode("one-time");
      setScheduleApplyMode("all");
      setScheduleTitle("");
      setScheduleTime("");
      setWindowEndTime("");
      setScheduleTitleError(undefined);
      setScheduleTimeError(undefined);
      setWindowEndTimeError(undefined);
      setHistoryFilter("all");
      setHistoryPage(1);
      setSelectedJobPageSize(15);
      setSelectedJobPage(1);
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
    if (scheduleApplyMode === "selected") {
      return previews.filter((item) => selectedItems.has(String(item.variantId)));
    }
    if (scheduleApplyMode === "filtered") {
      return filteredPreviews;
    }
    return previews;
  }, [scheduleApplyMode, previews, selectedItems, filteredPreviews]);

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
      const proposedPrice = Number.parseFloat(proposedRaw);
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

  const scheduleConflictNotices = useMemo<ScheduleConflictNotice[]>(() => {
    if (!scheduleTime) return [];

    const publishAtMs = new Date(scheduleTime).getTime();
    if (Number.isNaN(publishAtMs)) return [];
    const restoreAtMs =
      scheduleMode === "time-window" && windowEndTime
        ? new Date(windowEndTime).getTime()
        : publishAtMs;
    if (Number.isNaN(restoreAtMs)) return [];
    const candidateEndMs = Math.max(publishAtMs, restoreAtMs);

    const candidateVariantIds = new Set(
      scopedItemsForSchedule
        .map((item) => String(item.variantId))
        .filter((variantId) => variantId.length > 0)
    );

    if (candidateVariantIds.size === 0) return [];

    const notices: ScheduleConflictNotice[] = [];
    const candidateMinute = Math.floor(publishAtMs / 60000);
    const catalogSize = previews.length;

    const getJobVariantIds = (job: ScheduledJob) => {
      if (!Array.isArray(job.products)) return new Set<string>();
      return new Set(
        job.products
          .map((product) => String(product.variantId))
          .filter((variantId) => variantId.length > 0)
      );
    };

    const likelyAllProductsJobs = scheduleCenterData.upcoming.filter((job) => {
      if (catalogSize <= 0) return false;
      if ((job.productCount ?? 0) >= catalogSize) return true;
      return getJobVariantIds(job).size >= catalogSize;
    });

    const getJobWindowEndMs = (job: ScheduledJob & { runAtMs: number; windowEndMs?: number | null }) => {
      if (job.mode === "time-window" && typeof job.windowEndMs === "number") {
        return job.windowEndMs;
      }
      return job.runAtMs;
    };

    const windowsOverlap = (job: ScheduledJob & { runAtMs: number; windowEndMs?: number | null }) => {
      const jobEndMs = getJobWindowEndMs(job);
      return publishAtMs <= jobEndMs && job.runAtMs <= candidateEndMs;
    };

    const exactPublishTimeOverlap = scheduleCenterData.upcoming.filter(
      (job) => Math.floor(job.runAtMs / 60000) === candidateMinute
    );
    const nearbyPublishTimeOverlap = scheduleCenterData.upcoming.filter((job) => {
      const deltaMs = Math.abs(job.runAtMs - publishAtMs);
      return deltaMs > 0 && deltaMs <= CONFLICT_NEARBY_WINDOW_MS;
    });

    const overlappingVariantIds = new Set<string>();
    let productOverlapJobCount = 0;
    let overlapScheduledLaterCount = 0;
    let activeWindowOverlapCount = 0;
    let restoreWindowOverlapCount = 0;

    for (const job of scheduleCenterData.upcoming) {
      const jobVariantIds = getJobVariantIds(job);
      if (jobVariantIds.size === 0) continue;
      const overlapsWindowTiming = windowsOverlap(job);

      let hasOverlap = false;
      for (const variantId of candidateVariantIds) {
        if (jobVariantIds.has(variantId)) {
          overlappingVariantIds.add(variantId);
          hasOverlap = true;
        }
      }

      if (hasOverlap) {
        productOverlapJobCount += 1;
        if (job.runAtMs > publishAtMs) {
          overlapScheduledLaterCount += 1;
        }
        if (overlapsWindowTiming && job.status.toLowerCase() === "active-window") {
          activeWindowOverlapCount += 1;
        }
        if (
          overlapsWindowTiming &&
          scheduleMode === "time-window" &&
          job.mode === "time-window" &&
          typeof job.windowEndMs === "number"
        ) {
          restoreWindowOverlapCount += 1;
        }
      }
    }

    if (exactPublishTimeOverlap.length > 0) {
      notices.push({
        id: "exact-time-overlap",
        severity: "warning",
        message: `${exactPublishTimeOverlap.length} existing run${
          exactPublishTimeOverlap.length === 1 ? "" : "s"
        } already target this publish time.`,
      });
    }

    if (likelyAllProductsJobs.length > 0) {
      notices.push({
        id: "all-products-overlap",
        severity: "warning",
        message: "An existing all-products schedule may overlap with this operation.",
      });
    }

    const hasLargeOverlap =
      overlappingVariantIds.size >= LARGE_OVERLAP_COUNT_THRESHOLD ||
      (overlappingVariantIds.size >= 10 &&
        overlappingVariantIds.size >= Math.ceil(candidateVariantIds.size * 0.6));

    if (hasLargeOverlap) {
      notices.push({
        id: "large-product-overlap",
        severity: "warning",
        message: `${overlappingVariantIds.size} selected products already participate in future pricing runs.`,
      });
    } else if (overlappingVariantIds.size > 0) {
      notices.push({
        id: "product-overlap",
        severity: "informational",
        message: `${overlappingVariantIds.size} selected product${
          overlappingVariantIds.size === 1 ? "" : "s"
        } already participate in future pricing runs.`,
      });
    }

    if (activeWindowOverlapCount > 0) {
      notices.push({
        id: "active-window-overlap",
        severity: "warning",
        message: `${activeWindowOverlapCount} active pricing window${
          activeWindowOverlapCount === 1 ? "" : "s"
        } may overlap this operation.`,
      });
    }

    if (restoreWindowOverlapCount > 0) {
      notices.push({
        id: "restore-window-overlap",
        severity: "informational",
        message: `${restoreWindowOverlapCount} time window${
          restoreWindowOverlapCount === 1 ? "" : "s"
        } include restore timing inside this window.`,
      });
    }

    if (nearbyPublishTimeOverlap.length > 0) {
      notices.push({
        id: "nearby-time-overlap",
        severity: "informational",
        message: `${nearbyPublishTimeOverlap.length} scheduled run${
          nearbyPublishTimeOverlap.length === 1 ? "" : "s"
        } are near this publish time.`,
      });
    }

    if (overlapScheduledLaterCount > 0) {
      notices.push({
        id: "later-overlap",
        severity: "informational",
        message: `${overlapScheduledLaterCount} overlapping run${
          overlapScheduledLaterCount === 1 ? "" : "s"
        } are scheduled later than this publish time.`,
      });
    }

    if (notices.length === 0 && scheduleCenterData.upcoming.length > 0) {
      notices.push({
        id: "future-queue-awareness",
        severity: "informational",
        message: `${scheduleCenterData.upcoming.length} future pricing run${
          scheduleCenterData.upcoming.length === 1 ? "" : "s"
        } already exist in the queue.`,
      });
    }

    return notices;
  }, [scheduleMode, scheduleTime, scopedItemsForSchedule, previews.length, scheduleCenterData.upcoming, windowEndTime]);

  const warningNoticeCount = useMemo(
    () => scheduleConflictNotices.filter((notice) => notice.severity === "warning").length,
    [scheduleConflictNotices]
  );
  const informationalNoticeCount = useMemo(
    () => scheduleConflictNotices.filter((notice) => notice.severity === "informational").length,
    [scheduleConflictNotices]
  );
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

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "pending":
        return <Badge tone="warning">Pending</Badge>;
      case "processing":
        return <Badge tone="info">Processing</Badge>;
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

  const formatDateTime = (dateString: string) => {
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return "Invalid date";
    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatRelativeTime = (dateString: string) => {
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
  };

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

    if (!hasRules) {
      shopify.toast.show("Configure pricing rules before scheduling.", {
        isError: true,
      });
      return;
    }

    if (!hasActivePlan) {
      shopify.toast.show("Activate a plan to schedule pricing operations.", {
        isError: true,
      });
      return;
    }

    if (scopedItemsForSchedule.length === 0) {
      shopify.toast.show("No products available for the selected scheduling scope.", {
        isError: true,
      });
      return;
    }

    const products = scopedItemsForSchedule.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      title: item.title,
      variantTitle: item.variantTitle,
      oldPrice: item.oldPrice,
      newPrice: item.overriddenPrice !== undefined ? item.overriddenPrice : item.newPrice,
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
        shopify.toast.show(result.error || "Scheduling failed", { isError: true });
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
      setSelectedTab("history");
      setLoading(true);
      await loadScheduleHistory();
    } catch {
      shopify.toast.show("Scheduling failed", { isError: true });
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          setSelectedJob(null);
          onClose();
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
                      onClick={() => setSelectedTab("create")}
                    >
                      Create Schedule
                    </Button>
                    <Button
                      size="slim"
                      fullWidth
                      pressed={selectedTab === "history"}
                      variant={selectedTab === "history" ? "primary" : "tertiary"}
                      onClick={() => setSelectedTab("history")}
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

                            <Select
                              label="Schedule pricing scope"
                              options={[
                                { label: `${SELECT_OPTION_PREFIX}All products`, value: "all" },
                                { label: `${SELECT_OPTION_PREFIX}Selected products`, value: "selected" },
                                { label: `${SELECT_OPTION_PREFIX}Filtered products`, value: "filtered" },
                              ]}
                              value={scheduleApplyMode}
                              onChange={(value) => setScheduleApplyMode(value as ScheduleScope)}
                              disabled={isScheduling}
                            />

                            <TextField
                              label="Campaign Title"
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
                          </BlockStack>
                        </BlockStack>
                      </Box>

                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`Scheduling pricing update for: ${scopedItemsForSchedule.length} product${
                              scopedItemsForSchedule.length === 1 ? "" : "s"
                            }.`}
                          </Text>
                          {scheduleMode === "time-window" && (
                            <>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {scheduleTime
                                  ? `Pricing will publish at ${formatDateTime(scheduleTime)}.`
                                  : "Pricing will publish at the window start."}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {windowEndTime
                                  ? `Original storefront pricing will automatically restore at ${formatDateTime(windowEndTime)}.`
                                  : "Original storefront pricing will automatically restore at the window end."}
                              </Text>
                              {formatWindowDuration() && (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {`Window duration: ${formatWindowDuration()}.`}
                                </Text>
                              )}
                            </>
                          )}
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

                      {scheduleConflictNotices.length > 0 && (
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
                                Conflict awareness
                              </Text>
                              <InlineStack gap="100" wrap>
                                <Badge tone="warning">
                                  {`${warningNoticeCount} Warning${
                                    warningNoticeCount === 1 ? "" : "s"
                                  }`}
                                </Badge>
                                <Badge tone="info">
                                  {`${informationalNoticeCount} Info`}
                                </Badge>
                              </InlineStack>
                            </InlineStack>
                            <BlockStack gap="150">
                              {scheduleConflictNotices.map((notice) => (
                                <InlineStack key={notice.id} gap="200" blockAlign="center">
                                  <Badge
                                    tone={notice.severity === "warning" ? "warning" : "info"}
                                  >
                                    {notice.severity === "warning" ? "Warning" : "Info"}
                                  </Badge>
                                  <Text as="p" variant="bodySm">
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
                    <Button onClick={onClose} disabled={isScheduling}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      tone="success"
                      onClick={() => {
                        void submitSchedule();
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
                  } of ${selectedJobProducts.length} products`}
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
                  product.variantTitle || "Default Title",
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
    </>
  );
}
