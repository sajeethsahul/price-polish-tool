import { useMemo, useState } from "react";
import { Button, BlockStack, Box, InlineStack, Text } from "@shopify/polaris";
import { ModalPagination } from "./ModalPagination";

export function ExpandableList({
  title,
  items,
  emptyMessage = "—",
  collapsedVisibleCount = 5,
}: {
  title: string;
  items: string[];
  emptyMessage?: string;
  collapsedVisibleCount?: number;
}) {
  const normalizedItems = useMemo(() => items.filter((item) => String(item ?? "").trim().length > 0), [items]);
  const [expanded, setExpanded] = useState(false);

  const needsScroll = normalizedItems.length > 10;
  const needsPagination = normalizedItems.length > 50;

  const [pageSize, setPageSize] = useState(15);
  const [page, setPage] = useState(1);

  const effectivePageSize = needsPagination ? pageSize : normalizedItems.length;
  const totalPages = Math.max(1, Math.ceil(normalizedItems.length / Math.max(1, effectivePageSize)));
  const normalizedPage = Math.min(Math.max(1, page), totalPages);

  const visibleItems = useMemo(() => {
    if (normalizedItems.length === 0) return [];

    if (!expanded) {
      return normalizedItems.slice(0, Math.max(1, collapsedVisibleCount));
    }

    if (!needsPagination) {
      return normalizedItems;
    }

    const start = (normalizedPage - 1) * effectivePageSize;
    return normalizedItems.slice(start, start + effectivePageSize);
  }, [collapsedVisibleCount, effectivePageSize, expanded, needsPagination, normalizedItems, normalizedPage]);

  const hiddenCount = Math.max(0, normalizedItems.length - visibleItems.length);

  const listContainerStyle = useMemo(() => {
    if (!needsScroll) return undefined;
    return { maxHeight: 300, overflowY: "auto" as const, paddingRight: 4 };
  }, [needsScroll]);

  return (
    <BlockStack gap="150">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <Text as="p" variant="bodySm" fontWeight="medium">
          {`${title} (${normalizedItems.length})`}
        </Text>
        {expanded ? (
          <Button
            variant="plain"
            onClick={() => {
              setExpanded(false);
              setPage(1);
            }}
          >
            ▲ Show less
          </Button>
        ) : hiddenCount > 0 ? (
          <Button
            variant="plain"
            onClick={() => {
              setExpanded(true);
              setPage(1);
            }}
          >
            {`+${hiddenCount} more ▼`}
          </Button>
        ) : null}
      </InlineStack>

      {normalizedItems.length === 0 ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {emptyMessage}
        </Text>
      ) : (
        <Box padding="200" background="bg-surface" borderRadius="200">
          <div style={listContainerStyle}>
            <BlockStack gap="050">
              {visibleItems.map((label, index) => (
                <Text key={`${index}-${label}`} as="p" variant="bodySm" tone="subdued">
                  {`• ${label}`}
                </Text>
              ))}
            </BlockStack>
          </div>

          {expanded && needsPagination ? (
            <Box paddingBlockStart="200">
              <ModalPagination
                totalCount={normalizedItems.length}
                page={normalizedPage}
                pageSize={effectivePageSize}
                onPageChange={(next) => setPage(next)}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setPage(1);
                }}
              />
            </Box>
          ) : null}
        </Box>
      )}
    </BlockStack>
  );
}

