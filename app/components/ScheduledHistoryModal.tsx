import { useState, useEffect, useLayoutEffect } from "react";
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
} from "@shopify/polaris";
import { useAppFetch } from "../utils/fetch";
import { formatMoney } from "../utils/format";

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

export interface ScheduledHistoryModalProps {
  open: boolean;
  onClose: () => void;
  currencyCode: string;
}

export function ScheduledHistoryModal({
  open,
  onClose,
  currencyCode,
}: ScheduledHistoryModalProps) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const appFetch = useAppFetch();

  useLayoutEffect(() => {
    if (open) {
      setLoading(true);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setJobs([]);
      setLoading(false);
      setSelectedJob(null);
      return;
    }

    let mounted = true;

    async function fetchJobs() {
      try {
        const data = await appFetch("/api/schedule-history");
        if (mounted && data.jobs) {
          setJobs(data.jobs);
        }
      } catch (err) {
        console.error("Failed to load schedule history", err);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchJobs();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appFetch changes every render; fetch keyed by `open` only
  }, [open]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge tone="warning">Pending</Badge>;
      case "processing":
        return <Badge tone="info">Processing</Badge>;
      case "done":
        return <Badge tone="success">Done</Badge>;
      case "failed":
        return <Badge tone="critical">Failed</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          setSelectedJob(null);
          onClose();
        }}
        title="Scheduled Pricing History"
        size="large"
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text variant="bodySm" as="p" tone="subdued">
              View and manage your upcoming and past pricing campaigns.
            </Text>

            <Box minHeight="220px">
              {loading ? (
                <Box paddingBlockStart="600" paddingBlockEnd="600">
                  <InlineStack align="center" blockAlign="center">
                    <Spinner size="small" accessibilityLabel="Loading schedule history" />
                  </InlineStack>
                </Box>
              ) : jobs.length === 0 ? (
                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      No scheduled campaigns yet
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      When you schedule pricing from Pricing Actions, upcoming and completed runs appear here.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Title", "Run Time", "Product Count", "Status"]}
                  rows={jobs.map((job) => [
                    job.title,
                    formatDate(job.runAt),
                    <Button
                      key={`${job.id}-products`}
                      variant="plain"
                      onClick={() => setSelectedJob(job)}
                    >
                      {`${job.productCount} Products`}
                    </Button>,
                    getStatusBadge(job.status),
                  ])}
                />
              )}
            </Box>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title={selectedJob?.title || "Scheduled Products"}
        size="large"
      >
        <Modal.Section>
          {selectedJob?.products && selectedJob.products.length > 0 ? (
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={[
                "Product",
                "Variant",
                "Old Price",
                "Scheduled Price",
              ]}
              rows={selectedJob.products.map((product) => [
                product.title || "Untitled Product",
                product.variantTitle || "Default Title",
                formatMoney(Number(product.oldPrice), currencyCode),
                formatMoney(Number(product.newPrice), currencyCode),
              ])}
            />
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
