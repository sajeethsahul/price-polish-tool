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
  status: string;
  productCount: number;
  products: ProductSnapshot[] | null;
}

type ScheduleScope = "all" | "selected" | "filtered";

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
  shopify,
}: ScheduledHistoryModalProps) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const [selectedTab, setSelectedTab] = useState<"create" | "history">("create");
  const [scheduleApplyMode, setScheduleApplyMode] = useState<ScheduleScope>("all");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleTitleError, setScheduleTitleError] = useState<string | undefined>();
  const [scheduleTimeError, setScheduleTimeError] = useState<string | undefined>();
  const [historyFilter, setHistoryFilter] = useState<
    "all" | "upcoming" | "completed" | "failed" | "overdue"
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
      setScheduleTitleError(undefined);
      setScheduleTimeError(undefined);
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
    const queueStatuses = new Set(["pending", "processing"]);

    const parsedJobs = jobs
      .map((job) => {
        const runAtDate = new Date(job.runAt);
        return {
          ...job,
          runAtDate,
          runAtMs: runAtDate.getTime(),
          normalizedStatus: job.status.toLowerCase(),
        };
      })
      .filter((job) => !Number.isNaN(job.runAtMs));

    const upcoming = parsedJobs
      .filter((job) => queueStatuses.has(job.normalizedStatus) || job.runAtMs >= nowMs)
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

    return notices;
  }, [previews.length, scheduleApplyMode, scopedItemsForSchedule]);

  const scheduleConflictNotices = useMemo<ScheduleConflictNotice[]>(() => {
    if (!scheduleTime) return [];

    const publishAtMs = new Date(scheduleTime).getTime();
    if (Number.isNaN(publishAtMs)) return [];

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

    for (const job of scheduleCenterData.upcoming) {
      const jobVariantIds = getJobVariantIds(job);
      if (jobVariantIds.size === 0) continue;

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
  }, [scheduleTime, scopedItemsForSchedule, previews.length, scheduleCenterData.upcoming]);

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
        const normalizedStatus = job.status.toLowerCase();
        const isQueueStatus = scheduleCenterData.queueStatuses.has(normalizedStatus);
        const isOverdue = isQueueStatus && runAtMs < scheduleCenterData.nowMs;
        const isUpcoming = isQueueStatus || runAtMs >= scheduleCenterData.nowMs;
        const isFailed = normalizedStatus === "failed" || normalizedStatus === "error";
        const isCompleted =
          normalizedStatus === "done" ||
          normalizedStatus === "completed" ||
          normalizedStatus === "success";
        return {
          ...job,
          runAtMs,
          normalizedStatus,
          isOverdue,
          isUpcoming,
          isFailed,
          isCompleted,
        };
      })
      .filter((job) => !Number.isNaN(job.runAtMs));
  }, [jobs, scheduleCenterData.nowMs, scheduleCenterData.queueStatuses]);

  const filteredHistoryRows = useMemo(() => {
    const sortedRows = [...historyRows].sort((a, b) => b.runAtMs - a.runAtMs);
    if (historyFilter === "all") return sortedRows;
    if (historyFilter === "upcoming") return sortedRows.filter((job) => job.isUpcoming);
    if (historyFilter === "overdue") return sortedRows.filter((job) => job.isOverdue);
    if (historyFilter === "failed") return sortedRows.filter((job) => job.isFailed);
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
    { label: `${SELECT_OPTION_PREFIX}Completed`, value: "completed" },
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

  const submitSchedule = async () => {
    const normalizedTitle = scheduleTitle.trim();
    if (!normalizedTitle) {
      setScheduleTitleError("Campaign title is required for scheduled pricing.");
      return;
    }
    setScheduleTitleError(undefined);

    if (!scheduleTime) {
      setScheduleTimeError("Choose when this schedule should run.");
      return;
    }
    setScheduleTimeError(undefined);

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
      shopify.toast.show(`${count} prices staged and scheduled successfully`);
      setScheduleTime("");
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

            <div
              style={{
                minHeight: 560,
                maxHeight: "72vh",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {selectedTab === "create" ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                  }}
                >
                  <div style={{ flex: 1 }}>
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
                            <Badge tone="success">One-time Publish</Badge>
                          </InlineStack>

                          <BlockStack gap="300">
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
                              label="Publish at"
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
                          </BlockStack>
                        </BlockStack>
                      </Box>

                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`This schedule includes ${scopedItemsForSchedule.length} product${
                            scopedItemsForSchedule.length === 1 ? "" : "s"
                          } using the current ${scheduleApplyMode} scope.`}
                        </Text>
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

                  <div style={{ marginTop: "auto" }}>
                    <Box
                      borderColor="border"
                      borderBlockStartWidth="025"
                      paddingBlockStart="300"
                      paddingBlockEnd="100"
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
                          Schedule Pricing
                        </Button>
                      </InlineStack>
                    </Box>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", height: "100%", paddingRight: 4 }}>
                  <BlockStack gap="300">
                    <InlineStack gap="200" wrap align="space-between" blockAlign="end">
                      <div style={{ minWidth: 220 }}>
                        <Select
                          label="History filter"
                          options={historyFilterOptions}
                          value={historyFilter}
                          onChange={(value) =>
                            setHistoryFilter(
                              value as "all" | "upcoming" | "completed" | "failed" | "overdue"
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
                            headings={["Campaign", "Scheduled for", "Timing", "Products", "Status"]}
                            rows={paginatedHistoryRows.map((job) => [
                              job.title,
                              formatDateTime(job.runAt),
                              formatRelativeTime(job.runAt),
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
          </BlockStack>
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
