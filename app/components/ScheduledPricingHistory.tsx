import { useState, useEffect, useCallback } from "react";
import {
  Card,
  IndexTable,
  Badge,
  Text,
  BlockStack,
  Button,
  Modal,
  Box,InlineStack
} from "@shopify/polaris";
import { useAppFetch } from "../utils/fetch";
import { formatMoney } from "../utils/format";
import { Spinner } from "@shopify/polaris";

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

  const fetchJobs = useCallback(async () => {
    setLoading(true);
  
    try {
      const fetcher = await appFetch;
      const data = await fetcher("/api/schedule-history");
  
      if (data.jobs) {
        setJobs(data.jobs);
      }
    } catch (err) {
      console.error("Failed to load schedule history", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    // Poll every 30 seconds for status updates
    const interval = setInterval(fetchJobs, 30000);
    return () => clearInterval(interval);
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

  const rowMarkup = jobs.map(
    (job, index) => (
      <IndexTable.Row id={job.id} key={job.id} position={index}>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {job.title}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{formatDate(job.runAt)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Button
            variant="tertiary"
            onClick={() => setSelectedJob(job)}
          >
            {`${job.productCount} Products`}
          </Button>
        </IndexTable.Cell>
        <IndexTable.Cell>{getStatusBadge(job.status)}</IndexTable.Cell>
      </IndexTable.Row>
    )
  );

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
          <IndexTable
            resourceName={{
              singular: "schedule",
              plural: "schedules",
            }}
            itemCount={jobs.length}
            headings={[
              { title: "Title" },
              { title: "Run Time" },
              { title: "Product Count" },
              { title: "Status" },
            ]}
            selectable={false}
          >
            {rowMarkup}
          </IndexTable>
        )}

      </BlockStack>
    </Card>

      {/* Product Details Modal */}
      <Modal
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title={selectedJob?.title || "Scheduled Products"}
        size="large"
      >
        <Modal.Section>
          {selectedJob?.products && selectedJob.products.length > 0 ? (
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={selectedJob.products.length}
              headings={[
                { title: "Product" },
                { title: "Variant" },
                { title: "Old Price" },
                { title: "Scheduled Price" },
              ]}
              selectable={false}
            >
              {selectedJob.products.map((product, index) => (
                <IndexTable.Row id={product.variantId} key={product.variantId} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                      {product.title}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{product.variantTitle || "Default Title"}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone="subdued" textDecorationLine="line-through">
                      {formatMoney(Number(product.oldPrice), currencyCode)}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone="success" fontWeight="bold">
                      {formatMoney(Number(product.newPrice), currencyCode)}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
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
