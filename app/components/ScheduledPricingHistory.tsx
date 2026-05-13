import { useState, useEffect, useCallback } from "react";
import {
  Card,
  DataTable,
  Badge,
  Text,
  BlockStack,
  Button,
  Modal,
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

export function ScheduledPricingHistory({ currencyCode }: { currencyCode: string }) {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<ScheduledJob | null>(null);
  const appFetch = useAppFetch();

  useEffect(() => {
    let mounted = true;
  
    async function fetchJobs() {
      try {
        setLoading(true);
  
        const data = await appFetch("/api/schedule-history");
  
        if (mounted && data.jobs) {
          setJobs(data.jobs);
        }
      } catch (err) {
        console.error("Failed to load schedule history", err);
      } finally {
        if (mounted) {
          console.log("SETTING LOADING FALSE");
          setLoading(false);
        }
      }
    }
  
    fetchJobs();
  
    const interval = setInterval(fetchJobs, 30000);
  
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

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
      <Card>
        <BlockStack gap="400">
  
          <Box padding="400" paddingBlockEnd="0">
            <BlockStack gap="100">
              <Text variant="headingMd" as="h2">
                Scheduled Pricing History
              </Text>
  
              <Text variant="bodySm" as="p" tone="subdued">
                View and manage your upcoming and past pricing campaigns.
              </Text>
            </BlockStack>
          </Box>
  
          {loading ? (
            <Box padding="400">
              <InlineStack align="center">
                <Spinner size="small" />
              </InlineStack>
            </Box>
          ) : (
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "text",
                "text",
              ]}
              headings={[
                "Title",
                "Run Time",
                "Product Count",
                "Status",
              ]}
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
  
        </BlockStack>
      </Card>
  
      <Modal
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title={selectedJob?.title || "Scheduled Products"}
        size="large"
      >
        <Modal.Section>
  
          {selectedJob?.products &&
          selectedJob.products.length > 0 ? (
  
            <DataTable
              columnContentTypes={[
                "text",
                "text",
                "text",
                "text",
              ]}
              headings={[
                "Product",
                "Variant",
                "Old Price",
                "Scheduled Price",
              ]}
              rows={selectedJob.products.map((product) => [
                product.title,
                product.variantTitle || "Default Title",
  
                formatMoney(
                  Number(product.oldPrice),
                  currencyCode
                ),
  
                formatMoney(
                  Number(product.newPrice),
                  currencyCode
                ),
              ])}
            />
  
          ) : (
            <Box padding="400">
              <Text
                as="p"
                tone="subdued"
                alignment="center"
              >
                No product details available for this schedule.
              </Text>
            </Box>
          )}
  
        </Modal.Section>
      </Modal>
    </>
  );
}
