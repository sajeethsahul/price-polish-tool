import {
  Modal,
  BlockStack,
  InlineStack,
  Button,
  Select,
  TextField,
  Text,
  Divider,
} from "@shopify/polaris";

export type ApplyMode = "" | "all" | "selected" | "filtered";

/** Matches dashboard `PreviewItem` — full shape so `handleApplyBatch` types align. */
export type PricingActionsPreviewItem = {
  productId: string;
  title: string;
  image: string;
  variantId: string;
  oldPrice: string;
  newPrice: string;
  originalBasePrice: string;
  overriddenPrice?: string;
  variantTitle?: string;
};

export interface PricingActionsModalProps {
  open: boolean;
  onClose: () => void;
  applyMode: ApplyMode;
  onApplyModeChange: (mode: ApplyMode) => void;
  scheduleTitle: string;
  onScheduleTitleChange: (value: string) => void;
  scheduleTime: string;
  onScheduleTimeChange: (value: string) => void;
  previews: PricingActionsPreviewItem[];
  selectedItems: Set<string>;
  isProcessing: boolean;
  hasActivePlan: boolean;
  hasRules: boolean;
  collectionId: string;
  onApplyBatch: (
    items: PricingActionsPreviewItem[],
    options?: { bypassSelectedScope?: boolean }
  ) => void | Promise<void>;
  shopify: {
    toast: {
      show: (message: string, options?: { isError?: boolean }) => void;
    };
  };
}

export function PricingActionsModal({
  open,
  onClose,
  applyMode,
  onApplyModeChange,
  scheduleTitle,
  onScheduleTitleChange,
  scheduleTime,
  onScheduleTimeChange,
  previews,
  selectedItems,
  isProcessing,
  hasActivePlan,
  hasRules,
  collectionId,
  onApplyBatch,
  shopify,
}: PricingActionsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pricing Actions"
      size="medium"
    >
      <Modal.Section>
        <BlockStack gap="200">
          <InlineStack gap="200" blockAlign="end" wrap={false}>
            <div style={{ flex: 1 }}>
              <Select
                label="Apply pricing to"
                options={[
                  { label: "Select apply mode", value: "" },
                  { label: "All products", value: "all" },
                  { label: "Selected products", value: "selected" },
                  { label: "Filtered results", value: "filtered" },
                ]}
                value={applyMode}
                onChange={(value) => onApplyModeChange(value as ApplyMode)}
              />
            </div>
            <Button
              variant="primary"
              tone="success"
              loading={isProcessing}
              disabled={
                !applyMode ||
                !hasActivePlan ||
                isProcessing ||
                !hasRules ||
                (applyMode === "all" && previews.length === 0) ||
                (applyMode === "selected" && selectedItems.size === 0)
              }
              onClick={() => onApplyBatch(previews)}
            >
              {`Apply (${
                applyMode === "all"
                  ? previews.length
                  : applyMode === "selected"
                    ? selectedItems.size
                    : previews.length
              })`}
            </Button>
          </InlineStack>

          {applyMode === "selected" && (
            <Text as="p" tone="subdued">
              {selectedItems.size} products selected
            </Text>
          )}

          <Divider />

          <BlockStack gap="200">
            <TextField
              label="Campaign Title"
              value={scheduleTitle}
              onChange={onScheduleTitleChange}
              autoComplete="off"
              placeholder="e.g., Weekend Sale"
            />
            <InlineStack gap="200" blockAlign="end" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField
                  label="Schedule Time"
                  type="datetime-local"
                  value={scheduleTime}
                  onChange={onScheduleTimeChange}
                  autoComplete="off"
                />
              </div>
              <Button
                disabled={!applyMode}
                onClick={async () => {
                  if (!scheduleTime) {
                    shopify.toast.show("Select time", { isError: true });
                    return;
                  }

                  if (!hasRules) {
                    shopify.toast.show("Configure pricing rules first", {
                      isError: true,
                    });
                    return;
                  }

                  let scopedItems = previews;
                  if (applyMode === "selected") {
                    scopedItems = previews.filter((item) =>
                      selectedItems.has(String(item.variantId))
                    );
                  }

                  if (scopedItems.length === 0) {
                    shopify.toast.show("No products to schedule", {
                      isError: true,
                    });
                    return;
                  }

                  const products = scopedItems.map((item) => ({
                    productId: item.productId,
                    variantId: item.variantId,
                    title: item.title,
                    variantTitle: item.variantTitle,
                    oldPrice: item.oldPrice,
                    newPrice:
                      item.overriddenPrice !== undefined
                        ? item.overriddenPrice
                        : item.newPrice,
                    isManual: item.overriddenPrice !== undefined,
                  }));

                  try {
                    const response = await fetch("/api/schedule-pricing", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        title: scheduleTitle,
                        runAt: new Date(scheduleTime).toISOString(),
                        products,
                        applyMode,
                        collectionId,
                      }),
                    });

                    const result = await response.json();

                    if (!response.ok) {
                      shopify.toast.show(
                        result.error || "Scheduling failed",
                        { isError: true }
                      );
                      return;
                    }

                    const count = result.stagedCount || scopedItems.length;
                    shopify.toast.show(
                      `${count} prices staged and scheduled successfully`
                    );
                  } catch {
                    shopify.toast.show("Scheduling failed", { isError: true });
                  }
                }}
              >
                Schedule
              </Button>
            </InlineStack>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
