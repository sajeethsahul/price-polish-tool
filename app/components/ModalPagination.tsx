import { InlineStack, Pagination, Select, Text } from "@shopify/polaris";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 15, 25, 50];
const SELECT_OPTION_PREFIX = "\u2002";

export function ModalPagination({
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  pageSizeLabel = "Rows per page",
}: {
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextPageSize: number) => void;
  itemLabel?: string;
  pageSizeOptions?: number[];
  pageSizeLabel?: string;
}) {
  const normalizedTotal = Math.max(0, totalCount);
  const normalizedPageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize));
  const normalizedPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = normalizedTotal === 0 ? 0 : (normalizedPage - 1) * normalizedPageSize + 1;
  const endIndex = normalizedTotal === 0 ? 0 : Math.min(normalizedTotal, (normalizedPage - 1) * normalizedPageSize + normalizedPageSize);

  return (
    <InlineStack align="space-between" blockAlign="center" wrap>
      <Text as="p" variant="bodySm" tone="subdued">
        {itemLabel
          ? `Showing ${startIndex}-${endIndex} of ${normalizedTotal} ${itemLabel}`
          : `Showing ${startIndex}-${endIndex} of ${normalizedTotal}`}
      </Text>
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <div style={{ minWidth: 160 }}>
          <Select
            label={pageSizeLabel}
            options={pageSizeOptions.map((size) => ({
              label: `${SELECT_OPTION_PREFIX}${size}`,
              value: String(size),
            }))}
            value={String(normalizedPageSize)}
            onChange={(value) => onPageSizeChange(Number(value))}
          />
        </div>
        <Pagination
          hasPrevious={normalizedPage > 1}
          onPrevious={() => onPageChange(Math.max(1, normalizedPage - 1))}
          hasNext={normalizedPage < totalPages}
          onNext={() => onPageChange(Math.min(totalPages, normalizedPage + 1))}
          label={`Page ${normalizedPage} of ${totalPages}`}
        />
      </InlineStack>
    </InlineStack>
  );
}

